import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load environment variables from the directory of this file
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

import { connectionManager } from "./connectionManager.js";
import { buildSQL } from "./sqlBuilder.js";
import { validatePlan } from "./validator.js";
import { callLLM } from "./llm.js";
import { ensureSqlSafety } from "./safety.js";
import { generateInsights } from "./insightGenerator.js";
import { McpError, logger } from "./errors.js";

// Load default connection if provided in .env
async function initializeDefault() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (url && key) {
    try {
      await connectionManager.register("default", url, key);
      logger.info(`Default database connection established with URL: ${url}`);
    } catch (e) {
      logger.error("Default connection failed", e);
    }
  }
}

const server = new McpServer(
  {
    name: "universal-db-mcp",
    version: "1.2.0"
  },
  {
    instructions:
      "CRITICAL: You are connected to live databases via dynamic schema discovery. " +
      "Use 'register_db' to connect to a new Supabase project. " +
      "Use 'list_databases' to see available connections. " +
      "Always specify the 'db' alias (default is 'default') for queries."
  }
);

server.registerTool(
  "register_db",
  {
    title: "Register a new database",
    description: "Connect to a new Supabase project and discover its schema.",
    inputSchema: z.object({
      alias: z.string().describe("Short name for this connection (e.g., 'prod', 'staging')"),
      url: z.string().describe("Supabase Project URL"),
      key: z.string().describe("Supabase Service Role Key or Anon Key")
    })
  },
  async ({ alias, url, key }) => {
    try {
      // Pre-flight check for execute_sql RPC
      const tempClient = (await import("@supabase/supabase-js")).createClient(url, key);
      const { error: rpcError } = await tempClient.rpc("execute_sql", { sql: "SELECT 1" });
      
      if (rpcError && rpcError.message.includes("could not find the function")) {
        return {
          content: [{ 
            type: "text", 
            text: `Error: The "execute_sql" RPC function is missing from this database.\n\n` +
                  `Please run the following SQL in the Supabase SQL Editor to enable this server:\n\n` +
                  `CREATE OR REPLACE FUNCTION execute_sql(sql text)\n` +
                  `RETURNS jsonb\n` +
                  `LANGUAGE plpgsql\n` +
                  `SECURITY DEFINER\n` +
                  `AS $$\n` +
                  `BEGIN\n` +
                  `  RETURN (SELECT jsonb_agg(t) FROM (EXECUTE sql) t);\n` +
                  `END;\n` +
                  `$$;`
          }],
          isError: true
        };
      }

      const summary = await connectionManager.register(alias, url, key);
      return {
        content: [{ 
          type: "text", 
          text: `Successfully registered "${alias}". Tables discovered: ${summary.tables.join(", ")}` 
        }]
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: error.message }],
        isError: true
      };
    }
  }
);

server.registerTool(
  "list_databases",
  {
    title: "List registered databases",
    description: "List all active database connections and their discovered table names.",
    inputSchema: z.object({})
  },
  async () => {
    const list = connectionManager.connections;
    if (list.size === 0) return { content: [{ type: "text", text: "No databases registered." }] };
    
    const summary = Array.from(list.entries()).map(([alias, { config }]) => {
      return `Database: ${alias}\nTables: ${Object.keys(config.schema).join(", ")}`;
    }).join("\n---\n");

    return {
      content: [{ type: "text", text: summary }]
    };
  }
);

server.registerTool(
  "query_database",
  {
    title: "Simple fetch from database",
    description: "Fetch data from a specific table with simple filters.",
    inputSchema: z.object({
      db: z.string().optional().default("default").describe("Database alias"),
      table: z.string().describe("The table to query"),
      limit: z.number().optional().default(10)
    })
  },
  async ({ db, table, limit }) => {
    try {
      const { supabase, config } = connectionManager.get(db);
      
      if (!config.schema[table]) {
        return {
          content: [{ type: "text", text: `Error: Table '${table}' not found in database '${db}'.` }],
          isError: true
        };
      }

      const { data, error } = await supabase.from(table).select("*").limit(limit);

      if (error) return { content: [{ type: "text", text: error.message }], isError: true };

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
      };
    } catch (e) {
      return { content: [{ type: "text", text: e.message }], isError: true };
    }
  }
);

const planSchema = z
  .object({
    table: z.string(),
    columns: z.array(z.string()).optional(),
    filters: z
      .array(
        z.object({
          column: z.string(),
          operator: z.string(),
          value: z.union([z.string(), z.number(), z.boolean(), z.null()])
        })
      )
      .optional(),
    aggregations: z
      .array(
        z.object({
          type: z.string(),
          column: z.string(),
          alias: z.string().optional()
        })
      )
      .optional(),
    groupBy: z.array(z.string()).optional(),
    orderBy: z
      .object({
        column: z.string(),
        direction: z.string().optional()
      })
      .optional(),
    limit: z.number().optional(),
    joins: z.array(z.string()).optional(),
    distinct: z.boolean().optional()
  })
  .strict();

server.registerTool(
  "query_plan",
  {
    title: "Execute query plan",
    description: "Validate and execute a structured query plan.",
    inputSchema: z.object({
      db: z.string().optional().default("default").describe("Database alias"),
      plan: planSchema,
      execute: z.boolean().optional().default(true)
    })
  },
  async ({ db, plan, execute }) => {
    try {
      const { supabase, config } = connectionManager.get(db);
      
      let validatedPlan;
      try {
        validatedPlan = validatePlan(plan, config);
      } catch (error) {
        return { content: [{ type: "text", text: error.message }], isError: true };
      }

      const { sql, params } = buildSQL(validatedPlan, config);
      const safeSql = sql.trim().replace(/;+\s*$/, "");

      if (!execute) {
        return { content: [{ type: "text", text: sql }] };
      }

      ensureSqlSafety(safeSql);

      const rpcName = process.env.SUPABASE_SQL_RPC || "execute_sql";
      let { data, error } = await supabase.rpc(rpcName, { sql: safeSql, params });

      if (error && (error.message.toLowerCase().includes("too many arguments") || error.message.toLowerCase().includes("could not find the function"))) {
        let hydratedSql = safeSql;
        if (params && params.length > 0) {
          params.forEach((val, i) => {
            const escaped = typeof val === 'string' ? `'${val.replace(/'/g, "''")}'` : (val === null ? 'NULL' : val);
            const regex = new RegExp(`\\$${i + 1}(?![0-9])`, 'g');
            hydratedSql = hydratedSql.replace(regex, escaped);
          });
        }
        const retry = await supabase.rpc(rpcName, { sql: hydratedSql });
        if (retry.error) return { content: [{ type: "text", text: retry.error.message }], isError: true };
        data = retry.data;
      } else if (error) {
        return { content: [{ type: "text", text: error.message }], isError: true };
      }

      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: e.message }], isError: true };
    }
  }
);

server.registerTool(
  "query_nl",
  {
    title: "Natural language query",
    description: "The primary tool for answering any natural language questions about the database. " +
                 "It automatically discovers schema, handles joins, and performs aggregations to answer complex business questions.",
    inputSchema: z.object({
      db: z.string().optional().default("default").describe("Database alias (default is 'default')"),
      query: z.string().describe("The user's natural language question (e.g., 'Who are the top 5 customers by data usage?')")
    })
  },
  async ({ db, query }) => {
    try {
      const { supabase, config } = connectionManager.get(db);
      
      // Step 1: LLM to Plan
      const plan = await callLLM(query, config);
      
      // Step 2: Validate
      const validatedPlan = validatePlan(plan, config);
      
      // Step 3: SQL
      const { sql: rawSql, params } = buildSQL(validatedPlan, config);
      const sql = rawSql.trim().replace(/;+\s*$/, "");
      
      // Step 4: Safety & Execution
      ensureSqlSafety(sql);
      
      // Execute query
      const rpcName = process.env.SUPABASE_SQL_RPC || "execute_sql";
      
      let finalData;
      let { data, error } = await supabase.rpc(rpcName, { sql, params });

      if (error && (error.message.toLowerCase().includes("too many arguments") || error.message.toLowerCase().includes("could not find the function"))) {
        // Fallback: Hydrate SQL locally for older RPCs that only accept a single 'sql' argument
        let hydratedSql = sql;
        if (params && params.length > 0) {
          params.forEach((val, i) => {
            const escaped = typeof val === 'string' ? `'${val.replace(/'/g, "''")}'` : (val === null ? 'NULL' : val);
            // Replace $1, $2, etc. with escaped values. 
            // Using a regex to ensure we don't replace parts of other numbers (e.g. $11)
            const regex = new RegExp(`\\$${i + 1}(?![0-9])`, 'g');
            hydratedSql = hydratedSql.replace(regex, escaped);
          });
        }
        
        const retry = await supabase.rpc(rpcName, { sql: hydratedSql });
        if (retry.error) {
          logger.error("Hydrated fallback query failed", retry.error);
          throw new Error(retry.error.message);
        }
        finalData = retry.data;
      } else if (error) {
        logger.error("RPC Query Failed", { error, sql, params });
        throw new Error(error.message);
      } else {
        finalData = data;
      }

      const insights = generateInsights(finalData, query);

      return {
        content: [
          { type: "text", text: insights }
        ]
      };
    } catch (e) {
      if (e instanceof McpError) {
        logger.warn("Request Blocked", { code: e.code, message: e.message });
        return { content: [{ type: "text", text: `Blocked: ${e.message}` }], isError: true };
      }
      logger.error("Query NL failed", e);
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.registerTool(
  "refresh_schema",
  {
    title: "Refresh database schema",
    description: "Re-introspect the database to pick up new tables or columns.",
    inputSchema: z.object({
      db: z.string().optional().default("default").describe("Database alias")
    })
  },
  async ({ db }) => {
    try {
      const { supabase } = connectionManager.get(db);
      const url = supabase.supabaseUrl;
      const key = supabase.supabaseKey;
      await connectionManager.register(db, url, key);
      return {
        content: [{ type: "text", text: `Schema for "${db}" refreshed successfully.` }]
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Failed to refresh schema: ${e.message}` }],
        isError: true
      };
    }
  }
);

async function main() {
  await initializeDefault();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Universal DB MCP Server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
