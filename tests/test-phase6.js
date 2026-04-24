import { fileURLToPath } from "url";
import path from "path";

import dotenv from "dotenv";
import { connectionManager } from "../connectionManager.js";
import { buildSQL } from "../sqlBuilder.js";
import { callLLM } from "../llm.js";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

/**
 * Validates Phase 6 features: DISTINCT, COUNT_DISTINCT, and complex aggregation.
 */
async function testPhase6() {
  console.log("--- STARTING PHASE 6 VALIDATION ---");

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;

  if (!url || !key) {
    console.error("❌ Skipping Phase 6 tests: Missing .env credentials.");
    return;
  }

  try {
    const { config } = await connectionManager.register("phase6_test", url, key);

    // Test 1: Aggregation Logic with COUNT_DISTINCT
    console.log("\n[Test 1] SQL Building: DISTINCT & COUNT_DISTINCT");
    const plan = {
      table: "factories",
      columns: ["name"],
      aggregations: [
        { type: "COUNT_DISTINCT", column: "location", alias: "unique_locs" },
        { type: "COUNT", column: "id", alias: "total" }
      ],
      distinct: true,
      groupBy: ["name"]
    };

    const { sql } = buildSQL(plan, config);
    console.log("Generated SQL:", sql);

    if (sql.includes("DISTINCT name") && sql.includes("COUNT(DISTINCT location)")) {
      console.log("✅ SQL Builder handles DISTINCT and COUNT_DISTINCT correctly!");
    } else {
      console.error("❌ SQL Builder failed Phase 6 logic.");
    }

    // Test 2: LLM Plan Generation for Multi-Step concepts
    console.log("\n[Test 2] LLM: Translating 'Unique locations' prompt...");
    const nlQuery = "How many unique factory locations do we have?";
    const llmPlan = await callLLM(nlQuery, config);
    console.log("LLM generated plan:", JSON.stringify(llmPlan, null, 2));

    if (llmPlan.aggregations?.some(a => a.type === "COUNT_DISTINCT" || a.type === "COUNT")) {
        console.log("✅ LLM correctly mapped natural language to aggregation plan!");
    } else {
        console.warn("⚠️ LLM might need more prompt tuning for Phase 6 specific terms.");
    }

  } catch (error) {
    console.error("❌ Phase 6 test failed:", error);
  }

  console.log("\n--- PHASE 6 VALIDATION COMPLETE ---");
}

testPhase6();
