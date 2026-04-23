import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { supabase } from "./db.js";
import { buildSQL } from "./sqlBuilder.js";
import { validatePlan } from "./validator.js";
import { callLLM } from "./llm.js";
import { ensureSqlSafety } from "./safety.js";
import { generateInsights } from "./insightGenerator.js";

const server = new McpServer(
  {
    name: "telecom-db",
    version: "1.0.0"
  },
  {
    instructions:
      "CRITICAL: You are connected to a live telecom database via the provided tools. " +
      "NEVER ask the user where data is stored, and NEVER ask for file uploads (CSV, Excel, etc.). " +
      "If the user asks for 'customers', 'users', 'calls', or 'data usage', you MUST use the tools immediately. " +
      "Use 'query_database' for simple fetches (e.g., 'list customer names'). " +
      "Use 'query_nl' for complex questions (e.g., 'who has the highest usage?'). " +
      "The database contains tables: customers, plans, data_usage, calls, and billing."
  }
);

server.registerTool(
  "query_database",
  {
    title: "Query telecom database",
    description:
      "Fetch telecom data for customers/users, data usage, or calls. Use this for requests like 'show customers' or 'customers starting with A'.",
    inputSchema: z.object({
      query: z.string()
    })
  },
  async ({ query }) => {
    const normalized = query.toLowerCase();
    let data;
    let error;

    // Enhanced simple name pattern matching in query_database
    const nameMatch = query.match(/(?:customers|users) (starting with|ending with|named) (?:['"]?)(.*?)(?:['"]?)$/i);
    
    // Support for "show all X" or "list X" where X is a table name
    const tableMatch = query.match(/(?:show|list|all) (customers|users|data_usage|calls|billing)/i);

    if (nameMatch) {
      const type = nameMatch[1].toLowerCase();
      const pattern = nameMatch[2];
      let queryBuilder = supabase.from("customers").select("*");
      
      if (type === "starting with") {
        queryBuilder = queryBuilder.ilike("name", `${pattern}%`);
      } else if (type === "ending with") {
        queryBuilder = queryBuilder.ilike("name", `%${pattern}`);
      } else {
        queryBuilder = queryBuilder.eq("name", pattern);
      }
      
      ({ data, error } = await queryBuilder.limit(10));
    } else if (tableMatch) {
      let targetTable = tableMatch[1].toLowerCase();
      if (targetTable === "users") targetTable = "customers";
      ({ data, error } = await supabase.from(targetTable).select("*").limit(10));
    } else if (normalized.includes("customers") || normalized.includes("users")) {
      ({ data, error } = await supabase.from("customers").select("*").limit(10));
    } else if (normalized.includes("data usage") || normalized.includes("data_usage")) {
      ({ data, error } = await supabase.from("data_usage").select("*").limit(10));
    } else if (normalized.includes("calls")) {
      ({ data, error } = await supabase.from("calls").select("*").limit(10));
    } else {
      return {
        content: [{ type: "text", text: "Unknown query" }]
      };
    }

    if (error) {
      return {
        content: [{ type: "text", text: error.message }],
        isError: true
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
    };
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
    joins: z.array(z.string()).optional()
  })
  .strict();

server.registerTool(
  "query_plan",
  {
    title: "Execute query plan",
    description:
      "Validate a structured query plan, build SQL, and optionally execute it via a Supabase RPC function.",
    inputSchema: z.object({
      plan: planSchema,
      execute: z.boolean().optional()
    })
  },
  async ({ plan, execute }) => {
    let validatedPlan;

    try {
      validatedPlan = validatePlan(plan);
    } catch (error) {
      return {
        content: [{ type: "text", text: error.message }],
        isError: true
      };
    }

    const { sql } = buildSQL(validatedPlan);
    const safeSql = sql.trim().replace(/;+\s*$/, "");

    if (!execute) {
      return {
        content: [{ type: "text", text: sql }]
      };
    }

    if (!/^select\b/i.test(safeSql)) {
      return {
        content: [{ type: "text", text: "Only SELECT queries are allowed." }],
        isError: true
      };
    }

    const rpcName = process.env.SUPABASE_SQL_RPC;
    if (!rpcName) {
      return {
        content: [
          {
            type: "text",
            text:
              "SUPABASE_SQL_RPC is not set. Configure a SQL RPC function or call without execute to get SQL only."
          }
        ],
        isError: true
      };
    }

    const { data, error } = await supabase.rpc(rpcName, { sql: safeSql });

    if (error) {
      return {
        content: [{ type: "text", text: error.message }],
        isError: true
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
    };
  }
);

server.registerTool(
  "query_nl",
  {
    title: "Query with natural language",
    description:
      "Convert a natural language request into a query plan with auto-repair capability.",
    inputSchema: z.object({
      query: z.string(),
      execute: z.boolean().optional()
    })
  },
  async ({ query, execute }) => {
    let result;
    let attempts = 0;
    const MAX_ATTEMPTS = 2;
    let lastError = null;
    let lastInvalidJson = null;

    while (attempts < MAX_ATTEMPTS) {
      attempts++;
      try {
        // Step 1: LLM Draft
        const llmResponse = await callLLM(query, lastError ? { error: lastError, invalidJson: lastInvalidJson } : null);
        
        if (llmResponse.isParseError) {
          lastError = llmResponse.error;
          lastInvalidJson = llmResponse.raw;
          continue;
        }

        const plan = llmResponse.plan;

        // Step 2: Deterministic Validator
        let validatedPlan;
        try {
          validatedPlan = validatePlan(plan);
        } catch (valError) {
          lastError = valError.message;
          lastInvalidJson = JSON.stringify(plan);
          continue;
        }

        // Step 3: SQL Generation
        const { sql, params } = buildSQL(validatedPlan);

        if (!execute) {
          return { content: [{ type: "text", text: sql }] };
        }

        // Step 4: Execution Safety
        ensureSqlSafety(sql);

        const rpcName = process.env.SUPABASE_SQL_RPC;
        if (!rpcName) {
          throw new Error("SUPABASE_SQL_RPC not configured");
        }

        let hydratedSql = sql;
        params.forEach((val, i) => {
          const escaped = typeof val === 'string' ? `'${val.replace(/'/g, "''")}'` : val;
          hydratedSql = hydratedSql.replace(`$${i + 1}`, escaped);
        });

        const { data, error } = await supabase.rpc(rpcName, { sql: hydratedSql });
        if (error) throw new Error(error.message);

        const insights = generateInsights(data, query);
        
        // Metrics hook (Mental placeholder for observability)
        console.error(`METRIC: Query success on attempt ${attempts}`);

        return {
          content: [
            { type: "text", text: insights },
            { type: "text", text: `\n\nRaw Data:\n${JSON.stringify(data, null, 2)}` }
          ]
        };

      } catch (err) {
        if (attempts >= MAX_ATTEMPTS) {
          console.error(`METRIC: Query failed after ${attempts} attempts. Final error: ${err.message}`);
          return {
            content: [{ type: "text", text: `I cannot answer this safely right now. Error: ${err.message}` }],
            isError: true
          };
        }
        lastError = err.message;
      }
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
