import { fileURLToPath } from "url";
import path from "path";
import { connectionManager } from "../connectionManager.js";
import dotenv from "dotenv";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

async function testPhase2() {
  console.log("--- Testing Phase 2: Connection Management ---");

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_KEY in .env");
    return;
  }

  try {
    // 1. Register a test database
    console.log("[1] Registering 'test_db'...");
    const summary = await connectionManager.register("test_db", url, key);
    console.log(`- Success! Discovered ${summary.tableCount} tables: ${summary.tables.join(", ")}`);

    // 2. List databases
    console.log("\n[2] Listing databases...");
    const list = connectionManager.list();
    console.log(JSON.stringify(list, null, 2));

    // 3. Get connection and check client
    console.log("\n[3] Verifying connection retrieval...");
    const { supabase, config } = connectionManager.get("test_db");
    console.log(`- Retrieved alias: test_db`);
    console.log(`- Tables in config: ${Object.keys(config.schema).length}`);

    // 4. Test missing alias
    console.log("\n[4] Testing invalid alias...");
    try {
      connectionManager.get("non_existent");
    } catch (e) {
      console.log(`- Caught expected error: ${e.message}`);
    }

    console.log("\n[SUCCESS] Phase 2 Implementation Verified!");
  } catch (error) {
    console.error(`\n[FAILED] Phase 2 Test: ${error.message}`);
  }
}

testPhase2();
