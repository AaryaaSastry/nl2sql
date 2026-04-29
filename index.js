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
import { 
  generateVisualization, 
  generateSummaryStats, 
  formatStatsAsMarkdown 
} from "./visualizationService.js";
import { buildSQL } from "./sqlBuilder.js";
import { estimatePlanConfidence, validatePlan } from "./validator.js";
import { callLLM, analyzeResults } from "./llm.js";
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
      logger.info(`Default database connection established`, { url });
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
  "health_check",
  {
    title: "Health check",
    description: "Check server status, version, and registered databases.",
    inputSchema: z.object({})
  },
  async () => {
    try {
      const dbList = connectionManager.list();
      const hasGeminiKey = !!process.env.GEMINI_API_KEY;

      return {
        content: [{
          type: "text",
          text: `
Server Status: HEALTHY
Version: 1.2.0
Databases Registered: ${dbList.length}
${dbList.map(db => `  - ${db.alias}: ${db.tables} tables`).join("\n")}
Gemini API: ${hasGeminiKey ? "✓ Configured" : "✗ Missing"}
          `.trim()
        }]
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Health check failed: ${e.message}` }],
        isError: true
      };
    }
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
      const summary = await connectionManager.register(alias, url, key);
      return {
        content: [{
          type: "text",
          text: `Successfully registered "${alias}". Tables discovered: ${summary.tables.join(", ")}`
        }]
      };
    } catch (error) {
      if (error.message.includes("execute_sql")) {
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
          alias: z.string().optional(),
          condition: z
            .object({
              column: z.string(),
              operator: z.string(),
              value: z.union([z.string(), z.number(), z.boolean(), z.null()])
            })
            .optional()
        })
      )
      .optional(),
    groupBy: z.array(z.string()).optional(),
    having: z
      .array(
        z.object({
          column: z.string(),
          operator: z.string(),
          value: z.union([z.string(), z.number(), z.boolean(), z.null()])
        })
      )
      .optional(),
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

/**
 * Core logic for natural language queries, extracted for reuse in MCP and REST API.
 */
async function executeNaturalLanguageQuery(db, query) {
  try {
    // Step 0: Input validation
    const MAX_QUERY_LENGTH = 500;
    if (query.length > MAX_QUERY_LENGTH) {
      throw new Error(`Query too long (${query.length} chars, max ${MAX_QUERY_LENGTH}). Please ask a more specific question.`);
    }

    const { supabase, config } = connectionManager.get(db);

    // Step 1: Detect Meta Queries (Schema/DB Info)
    const q = query.toLowerCase();
    const metaKeywords = ["schema", "tables", "list all", "what is in", "db structure", "database structure"];
    const isMetaQuery = metaKeywords.some(k => q.includes(k)) || 
                        (q.includes("details") && (q.includes("db") || q.includes("database"))) ||
                        (q.includes("info") && (q.includes("db") || q.includes("database")));

    if (isMetaQuery) {
      const tableCount = Object.keys(config.schema).length;
      const schemaSummary = Object.entries(config.schema)
        .map(([table, cols]) => {
          const tableTypes = config.types && config.types[table] ? config.types[table] : {};
          return `#### 📁 ${table}\n| Column | Type |\n| :--- | :--- |\n${cols.map(c => `| ${c} | *${tableTypes[c] || 'unknown'}* |`).join("\n")}`;
        })
        .join("\n\n");
      
      const suggestions = [
        "Show me database relationships",
        "Give me a summary of data in the largest table",
        "Analyze high-priority entities"
      ];

      const text = `## 📊 Database Schema: ${db}\n` +
                   `Discovered **${tableCount} tables** in the public schema.\n\n` +
                   schemaSummary +
                   `\n\n---\n### 💡 Recommended Questions\n` +
                   suggestions.map(s => `* [${s}](query://${s})`).join("\n");
      
      return {
        content: [{ type: "text", text }],
        data: config.schema,
        sql: "INTERNAL_METADATA_QUERY"
      };
    }

    // --- Step 2 & 3: LLM to Plan & Execution (with Self-Healing Retry Loop) ---
    let plan;
    let validatedPlan;
    let retryCount = 0;
    const maxRetries = 2; // Allow 2 retries for self-healing
    let lastError = null;

    while (retryCount <= maxRetries) {
      try {
        // If we have a previous error, include it in the prompt for self-healing
        const currentQuery = lastError 
          ? `${query}\n\nPREVIOUS ATTEMPT FAILED WITH ERROR: "${lastError}"\nPlease fix the plan to resolve this database error.`
          : query;

        plan = await callLLM(currentQuery, config);
        validatedPlan = validatePlan(plan, config);

        const confidence = estimatePlanConfidence(query, validatedPlan, config);
        if (confidence < 0.6) {
          throw new McpError(
            "I could not confidently map your question to the schema. Please name the table, add a filter, or narrow the request.",
            "LOW_CONFIDENCE",
            { confidence, plan: validatedPlan }
          );
        }
        
        // Step 3: SQL Generation
        const { sql: rawSql, params } = buildSQL(validatedPlan, config);
        const sql = rawSql.trim().replace(/;+\s*$/, "");

        // Step 4: Safety & Execution
        ensureSqlSafety(sql);

        const rpcName = process.env.SUPABASE_SQL_RPC || "execute_sql";
        let { data, error } = await supabase.rpc(rpcName, { sql, params });

        // Handle specific RPC argument mismatch fallback
        if (error && (error.message.toLowerCase().includes("too many arguments") || error.message.toLowerCase().includes("could not find the function"))) {
          let hydratedSql = sql;
          if (params && params.length > 0) {
            params.forEach((val, i) => {
              const escaped = typeof val === 'string' ? `'${val.replace(/'/g, "''")}'` : (val === null ? 'NULL' : val);
              const regex = new RegExp(`\\$${i + 1}(?![0-9])`, 'g');
              hydratedSql = hydratedSql.replace(regex, escaped);
            });
          }
          const retry = await supabase.rpc(rpcName, { sql: hydratedSql });
          data = retry.data;
          error = retry.error;
        }

        if (error) {
          // This is where Self-Healing kicks in!
          logger.warn("Database error detected, initiating self-healing retry", { error: error.message, retryCount });
          lastError = error.message;
          retryCount++;
          continue; // Try again with the error context
        }

        // If we reached here, query was successful
        data = Array.isArray(data) ? data : (data ? [data] : []);
        
        const insights = generateInsights(data, query);
        const analystReport = await analyzeResults(query, data, config);
        
        // Standalone Visualization Service (Deterministic)
        const autoChart = generateVisualization(query, data);
        const autoStats = generateSummaryStats(data);
        const autoStatsMd = autoStats ? formatStatsAsMarkdown(autoStats) : "";

        let finalContent = analystReport || insights;
        
        // Prioritize the analyst report but ensure stats and charts are included
        if (analystReport) {
          finalContent = `${analystReport}\n\n${autoStatsMd}\n\n---\n### 📄 Raw Data Records\n${insights}`;
        }

        return {
          content: [{ type: "text", text: finalContent }],
          data: data,
          sql: sql,
          chart: autoChart
        };

      } catch (e) {
        logger.warn("Query processing error, retrying", { error: e.message, retryCount });
        lastError = e.message;
        retryCount++;
        if (retryCount > maxRetries) {
          throw e; // Final failure after max retries
        }
      }
    }
  } catch (e) {
    if (e instanceof McpError) {
      throw e;
    }
    throw new Error(e.message);
  }
}

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
      const result = await executeNaturalLanguageQuery(db, query);
      return { content: result.content };
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
      const conn = connectionManager.get(db);
      const { url, key } = conn;

      if (!url || !key) {
        return {
          content: [{
            type: "text",
            text: `Error: Cannot refresh schema for "${db}". Connection credentials not found.`
          }],
          isError: true
        };
      }

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

/**
 * Middleware to protect routes with an API Key
 */
function apiKeyAuth(req, res, next) {
  const apiKey = process.env.MCP_API_KEY;
  if (!apiKey) {
    // If no key is configured, allow for now but warn (or block in production)
    logger.warn("MCP_API_KEY is not set in environment. Running without API key protection.");
    return next();
  }

  const clientKey = req.headers["x-api-key"] || req.query.apiKey;
  if (clientKey !== apiKey) {
    logger.warn(`Unauthorized access attempt from ${req.ip}`);
    return res.status(401).json({ error: "Unauthorized: Invalid or missing API Key" });
  }
  next();
}

async function main() {
  await initializeDefault();

  // Claude Desktop uses stdio transport. Keep the server process attached to the client.
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Universal DB MCP Server running on stdio");
}

main().catch((err) => {
  logger.error("Fatal error during startup", err);
  process.exit(1);
});