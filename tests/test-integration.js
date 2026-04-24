import { fileURLToPath } from "url";
import path from "path";
import { connectionManager } from "../connectionManager.js";
import dotenv from "dotenv";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

async function scenarioTest() {
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
    
    const summary = await connectionManager.register("default", url, key);
    const { config } = connectionManager.get("default");
    
    console.log(JSON.stringify(config.schema, null, 2));
  } catch (error) {
    console.error(`\n[FAILED] Test failed: ${error.message}`);
  }
}

scenarioTest();
