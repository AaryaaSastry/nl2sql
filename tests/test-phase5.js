import { fileURLToPath } from "url";
import path from "path";

import dotenv from "dotenv";
import { connectionManager } from "../connectionManager.js";
import { validatePlan } from "../validator.js";
import { buildSQL } from "../sqlBuilder.js";
import { generateInsights } from "../insightGenerator.js";
import { McpError } from "../errors.js";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

async function runTest() {
  console.log("--- STARTING PHASE 5 VALIDATION ---");

  // 1. Test Insight Truncation & Formatting
  console.log("\n[Test 1] Insight Generation Truncation & Prettifying...");
  const fakeData = Array.from({ length: 60 }, (_, i) => ({
    factory_id: i + 1,
    status: i % 2 === 0 ? "active" : "maintenance",
    alert_count: null
  }));
  const insights = generateInsights(fakeData, "List factories");
  console.log("Insight Sample Output:");
  console.log(insights.split('\n').slice(0, 5).join('\n'));
  if (insights.includes("Showing first 50 results") && insights.includes("Alert Count: N/A")) {
    console.log("✅ Insight truncation and N/A handling working!");
  } else {
    console.error("❌ Insight truncation failed!");
  }

  // 2. Test Custom Error Catching (McpError)
  console.log("\n[Test 2] Custom McpError Validation...");
  try {
    const invalidPlan = { table: "non_existent_table" };
    // We need a config to validate against
    const mockConfig = { schema: { real_table: ["id"] }, relations: {} };
    validatePlan(invalidPlan, mockConfig);
  } catch (e) {
    if (e instanceof McpError) {
      console.log(`✅ Caught expected McpError: ${e.message} (Code: ${e.code})`);
    } else {
      console.error("❌ Caught generic error instead of McpError:", e);
    }
  }

  // 3. Test Log Format (Manual Observation)
  console.log("\n[Test 3] Observability - Checking logger output...");
  import('./errors.js').then(({ logger }) => {
    logger.info("Test Info Log", { user: "test-bot" });
    logger.warn("Test Warn Log", { code: "WARN_001" });
    logger.error("Test Error Log", new Error("System Crash Simulation"));
  });

  // 4. Connection Manager Fallback (Logic Check)
  console.log("\n[Test 4] Connection Check...");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (url && key) {
    try {
      await connectionManager.register("phase5_test", url, key);
      console.log("✅ Connection registration works.");
    } catch (e) {
      console.log("❌ Connection failed (Check your .env):", e.message);
    }
  } else {
    console.log("⚠️ Skipping live connection test (missing .env vars)");
  }

  console.log("\n--- PHASE 5 VALIDATION COMPLETE ---");
}

runTest();
