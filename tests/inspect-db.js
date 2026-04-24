import { fileURLToPath } from "url";
import path from "path";

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const url = process.env.SUPABASE_URL || "https://yehdtfwzqcofenlbwvlv.supabase.co";
const key = process.env.SUPABASE_KEY || "sb_publishable_WOl1CKk3qVB6qvTM-RQ2GQ_q2gRlPxl";

const supabase = createClient(url, key);

async function inspect() {
    console.log("Inspecting RPC 'execute_sql'...");
    const { data, error } = await supabase.rpc('execute_sql', { 
        sql: "SELECT routine_name, routine_definition FROM information_schema.routines WHERE routine_name = 'execute_sql'" 
    });
    
    if (error) {
        console.error("Error inspecting RPC:", error.message);
    } else {
        console.log("RPC Definition:", JSON.stringify(data, null, 2));
    }

    console.log("\nInspecting Arguments...");
    const { data: args, error: argsError } = await supabase.rpc('execute_sql', {
        sql: "SELECT parameter_name, data_type, parameter_mode FROM information_schema.parameters WHERE specific_name IN (SELECT specific_name FROM information_schema.routines WHERE routine_name = 'execute_sql')"
    });

    if (argsError) {
        console.error("Error inspecting Arguments:", argsError.message);
    } else {
        console.log("Arguments:", JSON.stringify(args, null, 2));
    }
}

inspect();
