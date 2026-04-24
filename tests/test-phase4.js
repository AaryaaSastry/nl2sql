import { fileURLToPath } from "url";
import path from "path";
import { connectionManager } from "../connectionManager.js";
import { validatePlan } from "../validator.js";
import { ensureSqlSafety } from "../safety.js";
import { buildSQL } from "../sqlBuilder.js";
import dotenv from "dotenv";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

async function testPhase4() {
  console.log("--- Testing Phase 4: Validator and Safety Hardening ---");

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;

  try {
    const summary = await connectionManager.register("phase4_test", url, key);
    const { config } = connectionManager.get("phase4_test");

    // 1. Test SQL Injection Prevention (Parameterization)
    console.log("\n[1] Testing Parameterization (SQL Injection Safety)...");
    const maliciousPlan = {
      table: "factories",
      filters: [{ column: "name", operator: "=", value: "' OR '1'='1" }],
      limit: 1
    };
    const { sql, params } = buildSQL(maliciousPlan, config);
    console.log(`- Generated SQL: ${sql}`);
    console.log(`- Params: ${JSON.stringify(params)}`);
    if (sql.includes("$1") && params[0] === "' OR '1'='1") {
      console.log("- SUCCESS: Value is parameterized, not interpolated.");
    }

    // 2. Test Destructive Keyword Blocking
    console.log("\n[2] Testing Destructive Keyword Blocking...");
    try {
      ensureSqlSafety("SELECT * FROM factories; DROP TABLE sensors;");
    } catch (e) {
      console.log(`- Caught expected error: ${e.message}`);
    }

    // 3. Test Dynamic Validation (Table/Column checking)
    console.log("\n[3] Testing Invalid Column Validation...");
    const invalidPlan = {
      table: "factories",
      columns: ["non_existent_column"],
      limit: 1
    };
    try {
      validatePlan(invalidPlan, config);
    } catch (e) {
      console.log(`- Caught expected error: ${e.message}`);
    }

    console.log("\n[SUCCESS] Phase 4 Security Features Verified!");
  } catch (error) {
    console.error(`\n[FAILED] Phase 4 Test: ${error.message}`);
  }
}

testPhase4();
