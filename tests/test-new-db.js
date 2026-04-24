import { fileURLToPath } from "url";
import path from "path";

import { createClient } from '@supabase/supabase-js';
import { connectionManager } from "../connectionManager.js";
import { callLLM } from "../llm.js";
import { validatePlan } from "../validator.js";
import { buildSQL } from "../sqlBuilder.js";
import { ensureSqlSafety } from "../safety.js";
import { generateInsights } from "../insightGenerator.js";
import dotenv from "dotenv";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const url = "https://fictrsumqogxezkpmrtv.supabase.co";
const key = "sb_publishable_XIAHhR6Fu_WHiDLNnt788w_CW0cyKw1";
const query = "name of all the factories";

async function runTest() {
  console.log("--- TESTING NEW DATABASE ---");
  
  try {
    const supabase = createClient(url, key);
    
    console.log("\n[0/5] Inspecting RPC 'execute_sql'...");
    const { data: rpcDef, error: rpcError } = await supabase.rpc('execute_sql', { 
        sql: "SELECT routine_definition FROM information_schema.routines WHERE routine_name = 'execute_sql'" 
    });
    
    if (rpcError) {
        console.error("Error inspecting RPC:", rpcError.message);
    } else {
        console.log("RPC Definition found.");
        // console.log(rpcDef[0].routine_definition);
    }

    // 1. Register and Discover
    console.log("\n[1/5] Registering database and discovering schema...");
    const registration = await connectionManager.register("new_db", url, key);
    const { config } = connectionManager.get("new_db");
    console.log("✅ Success! Tables discovered:", registration.tables.join(", "));

    // 2. LLM Plan
    console.log("\n[2/5] Generating query plan via LLM...");
    const plan = await callLLM(query, config);
    
    // 3. Validate and Build SQL
    console.log("\n[3/5] Validating and building SQL...");
    const validatedPlan = validatePlan(plan, config);
    const { sql, params } = buildSQL(validatedPlan, config);
    console.log("SQL:", sql);

    // 4. Execute
    console.log("\n[4/5] Executing query...");
    ensureSqlSafety(sql);
    
    // Manual retry with semicolon removed just in case
    const cleanSql = sql.replace(/;\s*$/, "");
    console.log("Clean SQL:", cleanSql);

    const { data, error } = await supabase.rpc("execute_sql", { sql: cleanSql });

    if (error) {
      throw new Error(error.message);
    }

    // 5. Results
    console.log("\n[5/5] Final Results:");
    console.log(JSON.stringify(data, null, 2));
    console.log("\nInsights:", generateInsights(data, query));

  } catch (err) {
    console.error("\n❌ TEST FAILED:", err.message);
  }
}

runTest();
