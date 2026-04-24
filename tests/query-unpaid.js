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

const query = "give me the user's name that have unpaid status";

async function runQuery() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;

  try {
    const registration = await connectionManager.register("default", url, key);
    const { config, supabase } = connectionManager.get("default");
    
    // Step 1: LLM to Plan
    const plan = await callLLM(query, config);
    
    // Step 2: Validate
    const validatedPlan = validatePlan(plan, config);

    // Step 3: SQL
    const { sql: rawSql, params } = buildSQL(validatedPlan, config);
    const sql = rawSql.trim().replace(/;+\s*$/, "");
    console.log("SQL:", sql);
    console.log("Params:", params);

    // Step 4: Safety & Execution
    ensureSqlSafety(sql);
    const rpcName = process.env.SUPABASE_SQL_RPC || "execute_sql";
    let { data, error } = await supabase.rpc(rpcName, { sql, params });

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
      if (retry.error) throw new Error(retry.error.message);
      data = retry.data;
    } else if (error) {
      throw new Error(error.message);
    }

    console.log("\nResults:");
    console.log(JSON.stringify(data, null, 2));
    
    console.log("\nInsights:", generateInsights(data, query));

  } catch (err) {
    console.error("Query failed:", err.message);
  }
}

runQuery();
