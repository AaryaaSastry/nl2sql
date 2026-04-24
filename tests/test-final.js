import dotenv from "dotenv";
import { connectionManager } from "../connectionManager.js";
import { callLLM, analyzeResults } from "../llm.js";
import { validatePlan } from "../validator.js";
import { buildSQL } from "../sqlBuilder.js";
import { generateInsights } from "../insightGenerator.js";

dotenv.config({ path: "../.env" });

async function runDynamicTest() {
    const query = process.argv.slice(2).join(" "); // Take query from command line

    try {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

        if (!url || !key) {
            throw new Error("Missing credentials in .env file.");
        }

        console.log("🔍 Initializing Connection...");
        const summary = await connectionManager.register("default", url, key);
        console.log(`✅ Connected. Found ${summary.tableCount} tables: ${summary.tables.join(", ")}`);

        if (!query) {
            console.log("\n💡 TIP: Run with a query like: node test-local.js 'How many patients are there?'");
            return;
        }

        console.log(`\n🚀 Processing Query: "${query}"`);
        const { config } = connectionManager.get("default");

        // Logic Chain
        const plan = await callLLM(query, config);
        const validatedPlan = validatePlan(plan, config);
        const { sql, params } = buildSQL(validatedPlan, config);

        console.log("\n📦 Generated SQL:");
        console.log(`SQL: ${sql}`);

        // 3. Execution
        console.log("\n⏳ Executing Query...");
        const { data, error } = await connectionManager.get("default").supabase.rpc("execute_sql", { sql, params });
        
        if (error) throw error;

        // 4. Insights
        const insights = generateInsights(data, query);
        const analystReport = await analyzeResults(query, data, config);
        
        console.log("\n💡 AI Analyst Insight:");
        console.log("--------------------------------------------------");
        if (analystReport) {
            console.log("\n🧠 ANALYST REPORT:");
            console.log(analystReport);
            console.log("\n--------------------------------------------------");
        }
        console.log(insights);
        console.log("--------------------------------------------------");

    } catch (error) {
        console.error(`\n❌ Error: ${error.message}`);
        process.exit(1);
    }
}

runDynamicTest();
