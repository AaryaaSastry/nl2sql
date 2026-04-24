import { fileURLToPath } from "url";
import path from "path";

import { connectionManager } from "../connectionManager.js";
import { callLLM } from "../llm.js";
import { validatePlan } from "../validator.js";
import { buildSQL } from "../sqlBuilder.js";
import { ensureSqlSafety } from "../safety.js";
import { generateInsights } from "../insightGenerator.js";
import dotenv from "dotenv";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const queries = [
  "Show me the top 3 customers who have spent the most on billing.",
  "List all calls made in the last 7 days.",
  "Calculate the average data usage for each city.",
  "Find a customer where the name is '; DROP TABLE billing; --'"
];

async function runTests() {
  const url = process.env.SUPABASE_URL || "https://yehdtfwzqcofenlbwvlv.supabase.co";
  const key = process.env.SUPABASE_KEY || "sb_publishable_WOl1CKk3qVB6qvTM-RQ2GQ_q2gRlPxl";

  console.log("Connecting to:", url);
  
  try {
    const registration = await connectionManager.register("default", url, key);
    const { config, supabase } = connectionManager.get("default");
    
    console.log("Schema discovered. Tables:", registration.tables.join(", "));

    for (const query of queries) {
      console.log(`\n--- Testing Query: "${query}" ---`);
      try {
        // Step 1: LLM to Plan
        const plan = await callLLM(query, config);
        console.log("Generated Plan:", JSON.stringify(plan, null, 2));

        // Step 2: Validate
        const validatedPlan = validatePlan(plan, config);

        // Step 3: SQL
        const { sql, params } = buildSQL(validatedPlan, config);
        console.log("Generated SQL:", sql);
        console.log("Params:", params);

        // Step 4: Safety
        ensureSqlSafety(sql);

        // Step 5: Execution
        const rpcName = process.env.SUPABASE_SQL_RPC || "execute_sql";
        let { data, error } = await supabase.rpc(rpcName, { sql, params });

        if (error && (error.message.toLowerCase().includes("too many arguments") || error.message.toLowerCase().includes("could not find the function"))) {
          console.log("RPC Error (fallback triggered):", error.message);
          let hydratedSql = sql;
          if (params && params.length > 0) {
            params.forEach((val, i) => {
              const escaped = typeof val === 'string' ? `'${val.replace(/'/g, "''")}'` : (val === null ? 'NULL' : val);
              const regex = new RegExp(`\\$${i + 1}(?![0-9])`, 'g');
              hydratedSql = hydratedSql.replace(regex, escaped);
            });
          }
          console.log("Retrying with hydrated SQL:", hydratedSql);
          const retry = await supabase.rpc(rpcName, { sql: hydratedSql });
          if (retry.error) throw new Error(retry.error.message);
          data = retry.data;
        } else if (error) {
          throw new Error(error.message);
        }

        console.log("Results:", data);
        console.log("Insights:", generateInsights(data, query));
      } catch (e) {
        console.error("Test failed:", e.message);
      }
    }
  } catch (err) {
    console.error("Registration failed:", err.message);
  }
}

runTests();
