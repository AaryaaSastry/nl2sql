import { fileURLToPath } from "url";
import path from "path";

import { buildSQL } from "../sqlBuilder.js";
import { callLLM } from "../llm.js";
import { connectionManager } from "../connectionManager.js";
import dotenv from "dotenv";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

async function testPhase7() {
  console.log("--- STARTING PHASE 7 VALIDATION ---");

  const mockConfig = {
    schema: {
        incidents: ["id", "factory_id", "status", "created_at"]
    },
    relations: {
        incidents: {}
    }
  };

  // 1. Test SQL Expression Detection
  console.log("\n[Test 1] SQL Building: Temporal Expressions");
  const plan = {
    table: "incidents",
    filters: [
        { column: "created_at", operator: ">", value: "NOW() - INTERVAL '30 days'" }
    ]
  };

  try {
    const { sql, params } = buildSQL(plan, mockConfig);
    console.log("SQL:", sql);
    console.log("Params:", params);

    if (sql.includes("NOW() - INTERVAL '30 days'") && params.length === 0) {
        console.log("✅ SQL Builder correctly handles temporal expressions without parameterization!");
    } else {
        console.error("❌ SQL Builder failed temporal injection.");
    }
  } catch (e) {
    console.error("❌ SQL Building Error:", e.message);
  }

  // 2. Test Security Filter
  console.log("\n[Test 2] Security: SQL Expression Sanitization");
  const badPlan = {
    table: "incidents",
    filters: [
        { column: "status", operator: "=", value: "NOW(); DROP TABLE users; --" }
    ]
  };

  try {
    buildSQL(badPlan, mockConfig);
    console.error("❌ FAILED: Should have rejected malicious SQL expression.");
  } catch (e) {
    console.log("✅ Correctly blocked unsafe expression:", e.message);
  }

  // 3. LLM Reasoning for Temporal Prompts
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (url && key) {
    console.log("\n[Test 3] LLM: Translating 'Last 7 days' prompt...");
    try {
        const { config } = await connectionManager.register("phase7_test", url, key);
        const nlQuery = "Get incidents created in the last 7 days";
        const llmPlan = await callLLM(nlQuery, config);
        console.log("LLM Generated Plan:", JSON.stringify(llmPlan, null, 2));

        if (llmPlan.filters?.some(f => String(f.value).includes("INTERVAL") || String(f.value).includes("NOW"))) {
            console.log("✅ LLM correctly uses relative time expressions!");
        } else {
            console.warn("⚠️ LLM might have used a static date. Check output.");
        }
    } catch (e) {
        console.error("LLM Test Failed:", e.message);
    }
  }

  console.log("\n--- PHASE 7 VALIDATION COMPLETE ---");
}

testPhase7();
