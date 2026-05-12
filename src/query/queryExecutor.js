import { connectionManager } from "../core/connectionManager.js";
import {
  generateVisualization,
  generateSummaryStats,
  formatStatsAsMarkdown
} from "../../visualizationService.js";
import { buildSQL } from "../core/sqlBuilder.js";
import { estimatePlanConfidence, validatePlan } from "../core/validator.js";
import { callLLM, analyzeResults } from "../../llm.js";
import { ensureSqlSafety } from "../core/safety.js";
import { generateInsights } from "../../insightGenerator.js";
import { McpError, logger } from "../../errors.js";

export async function executeNaturalLanguageQuery(db, query) {
  try {
    const MAX_QUERY_LENGTH = 500;
    if (query.length > MAX_QUERY_LENGTH) {
      throw new Error(`Query too long (${query.length} chars, max ${MAX_QUERY_LENGTH}). Please ask a more specific question.`);
    }

    const { supabase, config } = connectionManager.get(db);

    const q = query.toLowerCase();
    const metaKeywords = ["schema", "tables", "list all", "what is in", "db structure", "database structure"];
    const isMetaQuery = metaKeywords.some(k => q.includes(k)) ||
                        (q.includes("details") && (q.includes("db") || q.includes("database"))) ||
                        (q.includes("info") && (q.includes("db") || q.includes("database")));

    if (isMetaQuery) {
      const tableCount = Object.keys(config.schema).length;
      const schemaSummary = Object.entries(config.schema)
        .map(([table, cols]) => {
          const tableTypes = config.types && config.types[table] ? config.types[table] : {};
          return `#### 📁 ${table}\n| Column | Type |\n| :--- | :--- |\n${cols.map(c => `| ${c} | *${tableTypes[c] || 'unknown'}* |`).join("\n")}`;
        })
        .join("\n\n");

      const suggestions = [
        "Show me database relationships",
        "Give me a summary of data in the largest table",
        "Analyze high-priority entities"
      ];

      const text = `## 📊 Database Schema: ${db}\n` +
                   `Discovered **${tableCount} tables** in the public schema.\n\n` +
                   schemaSummary +
                   `\n\n---\n### 💡 Recommended Questions\n` +
                   suggestions.map(s => `* [${s}](query://${s})`).join("\n");

      return {
        content: [{ type: "text", text }],
        data: config.schema,
        sql: "INTERNAL_METADATA_QUERY"
      };
    }

    let plan;
    let validatedPlan;
    let retryCount = 0;
    const maxRetries = 2;
    let lastError = null;

    while (retryCount <= maxRetries) {
      try {
        const currentQuery = lastError
          ? `${query}\n\nPREVIOUS ATTEMPT FAILED WITH ERROR: "${lastError}"\nPlease fix the plan to resolve this database error.`
          : query;

        plan = await callLLM(currentQuery, config);
        validatedPlan = validatePlan(plan, config);

        const confidence = estimatePlanConfidence(query, validatedPlan, config);
        if (confidence < 0.6) {
          throw new McpError(
            "I could not confidently map your question to the schema. Please name the table, add a filter, or narrow the request.",
            "LOW_CONFIDENCE",
            { confidence, plan: validatedPlan }
          );
        }

        const { sql: rawSql, params } = buildSQL(validatedPlan, config);
        const sql = rawSql.trim().replace(/;+\s*$/, "");

        ensureSqlSafety(sql);

        const rpcName = process.env.SUPABASE_SQL_RPC || "execute_sql";
        let { data, error } = await supabase.rpc(rpcName, { sql, params });

        if (error && (error.message.toLowerCase().includes("too many arguments") || error.message.toLowerCase().includes("could not find the function"))) {
          let hydratedSql = sql;
          if (params && params.length > 0) {
            params.forEach((val, i) => {
              const escaped = typeof val === 'string' ? `'${val.replace(/'/g, "''")}'` : (val === null ? 'NULL' : val);
              const regex = new RegExp(`\\$${i + 1}(?![0-9])`, 'g');
              hydratedSql = hydratedSql.replace(regex, escaped);
            });
          }
          const retry = await supabase.rpc(rpcName, { sql: hydratedSql });
          data = retry.data;
          error = retry.error;
        }

        if (error) {
          logger.warn("Database error detected, initiating self-healing retry", { error: error.message, retryCount });
          lastError = error.message;
          retryCount++;
          continue;
        }

        data = Array.isArray(data) ? data : (data ? [data] : []);

        const insights = generateInsights(data, query);
        const analystReport = await analyzeResults(query, data, config);

        const autoChart = generateVisualization(query, data);
        const autoStats = generateSummaryStats(data);
        const autoStatsMd = autoStats ? formatStatsAsMarkdown(autoStats) : "";

        let finalContent = analystReport || insights;
        if (analystReport) {
          finalContent = `${analystReport}\n\n${autoStatsMd}\n\n---\n### 📄 Raw Data Records\n${insights}`;
        }

        return {
          content: [{ type: "text", text: finalContent }],
          data: data,
          sql: sql,
          chart: autoChart
        };
      } catch (e) {
        logger.warn("Query processing error, retrying", { error: e.message, retryCount });
        lastError = e.message;
        retryCount++;
        if (retryCount > maxRetries) {
          throw e;
        }
      }
    }
  } catch (e) {
    if (e instanceof McpError) {
      throw e;
    }
    throw new Error(e.message);
  }
}