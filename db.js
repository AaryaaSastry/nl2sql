import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const moduleDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(moduleDir, ".env") });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_KEY in .env");
}

export const supabase = createClient(supabaseUrl, supabaseKey);
