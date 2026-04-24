import { fileURLToPath } from "url";
import path from "path";
import dotenv from 'dotenv';
import { callLLM } from './llm.js';
import { validatePlan } from './validator.js';
import { buildSQL } from './sqlBuilder.js';
import { ensureSqlSafety } from './safety.js';
import { supabase } from './db.js';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

/**
 * Mocks the logic within query_nl to detect where it fails.
 */
async function simulateQueryNL(query, execute = true) {
  console.log(`\n--- Simulating query_nl for: "${query}" ---`);
  
  try {
    // 1. LLM call
    console.log("Step 1: Calling LLM...");
    const llmResponse = await callLLM(query);
    if (llmResponse.isParseError) {
      console.error("LLM parse error:", llmResponse.error);
      console.error("Raw response:", llmResponse.raw);
      return;
    }
    console.log("LLM Success. Plan:", JSON.stringify(llmResponse.plan, null, 2));

    // 2. Validation
    console.log("Step 2: Validating plan...");
    const validatedPlan = validatePlan(llmResponse.plan);
    console.log("Validation Success.");

    // 3. SQL Building
    console.log("Step 3: Building SQL...");
    const { sql, params } = buildSQL(validatedPlan);
    console.log("SQL generated:", sql);
    console.log("Params:", params);

    if (!execute) {
      console.log("Skipping execution as requested.");
      return;
    }

    // 4. Safety Check
    console.log("Step 4: Checking SQL safety...");
    ensureSqlSafety(sql);
    console.log("Safety Check passed.");

    // 5. Hydration
    console.log("Step 5: Hydrating SQL...");
    const rpcName = process.env.SUPABASE_SQL_RPC;
    if (!rpcName) {
      throw new Error("SUPABASE_SQL_RPC not configured in .env");
    }
    
    let hydratedSql = sql;
    params.forEach((val, i) => {
      const escaped = typeof val === 'string' ? `'${val.replace(/'/g, "''")}'` : val;
      hydratedSql = hydratedSql.replace(`$${i + 1}`, escaped);
    });
    console.log("Hydrated SQL:", hydratedSql);

    // 6. Execution via Supabase RPC
    console.log(`Step 6: Executing via Supabase RPC (${rpcName})...`);
    const { data, error } = await supabase.rpc(rpcName, { sql: hydratedSql });
    
    if (error) {
      console.error("Supabase RPC Error:", error);
      return;
    }

    console.log("Success! Results Count:", data ? data.length : 0);
    console.log("Sample Data:", JSON.stringify(data?.[0], null, 2));

  } catch (err) {
    console.error("Simulation failed with error:", err.message);
    if (err.stack) {
        console.error(err.stack);
    }
  }
}

// Default run with a common complex query
const testQuery = process.argv[2] || "Who has the highest usage?";
simulateQueryNL(testQuery);
