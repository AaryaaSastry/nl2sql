import dotenv from "dotenv";

const DEFAULT_MODEL = "gemini-2.0-flash";
const DEFAULT_TIMEOUT = 30000; // 30 seconds

dotenv.config();

/**
 * Utility for robust API fetching with retries and timeouts
 */
async function fetchWithRetry(url, options, maxRetries = 3) {
  let lastError;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, { 
        ...options, 
        signal: controller.signal 
      });

      if (response.status === 429 || response.status >= 500) {
        const delay = Math.pow(2, i) * 1000;
        console.error(`[LLM] API Error ${response.status}. Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      const result = await response.json();
      
      // Check for Gemini internal errors
      if (result.error) {
        throw new Error(`Gemini API Error: ${result.error.message} (${result.error.status})`);
      }

      clearTimeout(timeoutId);
      return result;
    } catch (e) {
      lastError = e;
      if (e.name === 'AbortError') throw new Error(`LLM Request timed out after ${DEFAULT_TIMEOUT}ms`);
      if (i === maxRetries - 1) break;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  clearTimeout(timeoutId);
  throw lastError;
}

/**
 * Validates the project configuration
 */
function validateConfig(config) {
  if (!config || !config.schema) throw new Error("Invalid Config: Missing database schema.");
  if (!process.env.GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY in .env");
  return true;
}

/**
 * Intelligently trims the schema to relevant tables to save tokens
 */
function trimSchema(query, config) {
  const { schema, relations } = config;
  const queryLower = query.toLowerCase();
  const tables = Object.keys(schema);
  const relevantTables = new Set();

  tables.forEach(table => {
    const tableLower = table.toLowerCase();
    const singular = tableLower.endsWith("s") ? tableLower.slice(0, -1) : tableLower;
    const plural = tableLower.endsWith("s") ? tableLower : tableLower + "s";
    
    if (queryLower.includes(tableLower) || queryLower.includes(singular) || queryLower.includes(plural)) {
      relevantTables.add(table);
    }
  });

  // If no tables found, fallback to top 15 tables instead of entire DB
  if (relevantTables.size === 0) {
    if (tables.length <= 15) return config;
    return { ...config, schema: Object.fromEntries(Object.entries(schema).slice(0, 15)) };
  }

  // 1-hop expansion for joins
  const expandedTables = new Set(relevantTables);
  relevantTables.forEach(table => {
    if (relations[table]) {
      Object.keys(relations[table]).forEach(related => {
        if (schema[related]) expandedTables.add(related);
      });
    }
  });

  return {
    ...config,
    schema: Object.fromEntries(Object.entries(schema).filter(([k]) => expandedTables.has(k))),
    relations: Object.fromEntries(Object.entries(relations).filter(([k]) => expandedTables.has(k)))
  };
}

function buildSystemPrompt(config) {
  const { schema, relations, MAX_LIMIT = 50 } = config;
  
  const tables = Object.entries(schema)
    .map(([table, columns]) => `${table}(${columns.join(", ")})`)
    .join("\n");

  const joinLines = Object.entries(relations)
    .flatMap(([base, joins]) =>
      Object.entries(joins).map(([joinTable, condition]) =>
        `${base} -> ${joinTable} ON ${condition}`
      )
    )
    .join("\n");

  return [
    "Role: Expert Database Query Architect.",
    "Goal: Convert natural language into a structured JSON query plan.",
    "",
    "CRITICAL RULES:",
    "1. ONE QUERY, ONE TRUTH: Join all necessary tables into a single plan.",
    "2. NO HALLUCINATIONS: Use ONLY the provided schema. Do not invent columns.",
    "3. AGGREGATIONS: Support SUM, AVG, COUNT, COUNT_DISTINCT, MIN, and MAX.",
    "4. FORMAT: Return ONLY the JSON object. No prose. No markdown unless wrapped in ```json.",
    `5. LIMIT: Always include a limit (default: 10, max: ${MAX_LIMIT}).`,
    "6. COLUMN NAMES: Use 'table.column' format.",
    "7. AGGREGATIONS ONLY: All calculations MUST go into the 'aggregations' array.",
    "8. GROUP BY REQUIREMENT: Use 'groupBy' ONLY when 'aggregations' are present.",
    "9. Prefer the smallest correct plan. If the question is ambiguous, choose the simplest valid interpretation without inventing joins.",
    "10. For ranking questions like top/highest/lowest/most/least, include orderBy and a tight limit.",
    "11. For count/total/average questions, use aggregations instead of putting functions in columns.",
    "12. Use 'having' for post-aggregation filters such as 'at least 2', 'more than 10', or 'only groups with'.",
    "13. Use aggregation.condition for conditional counts or sums instead of filtering out the joined rows.",
    `14. CURRENT DATE: Today is ${new Date().toISOString().split('T')[0]}.`,
    "",
    "Schema:",
    tables,
    "",
    "Joins:",
    joinLines || "(none)",
    "",
    "Example Output Patterns:",
    JSON.stringify([
      {
        question: "List customers",
        plan: {
          table: "customers",
          columns: ["customers.id", "customers.name"],
          limit: 10
        }
      },
      {
        question: "What is total revenue by region?",
        plan: {
          table: "orders",
          columns: ["regions.name"],
          aggregations: [{ type: "SUM", column: "orders.revenue", alias: "total_revenue" }],
          groupBy: ["regions.name"],
          joins: ["regions"],
          limit: 10
        }
      },
      {
        question: "Top 5 customers by usage",
        plan: {
          table: "customers",
          columns: ["customers.name"],
          aggregations: [{ type: "SUM", column: "usage.amount", alias: "total_usage" }],
          joins: ["usage"],
          orderBy: { column: "total_usage", direction: "DESC" },
          limit: 5
        }
      },
      {
        question: "Factories with at least 2 faulty sensors",
        plan: {
          table: "factories",
          columns: ["factories.name"],
          aggregations: [{
            type: "COUNT",
            column: "sensors.id",
            alias: "faulty_sensors",
            condition: { column: "sensors.status", operator: "=", value: "faulty" }
          }],
          joins: ["sensors"],
          groupBy: ["factories.name"],
          having: [{ column: "faulty_sensors", operator: ">=", value: 2 }],
          limit: 10
        }
      }
    ], null, 2)
  ].join("\n");
}

function extractJson(text) {
  const trimmed = text.trim();
  
  // Try clean JSON first
  try {
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      JSON.parse(trimmed);
      return trimmed;
    }
  } catch (e) {}

  // Try fenced blocks
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch) {
    const extracted = fencedMatch[1].trim();
    try {
      JSON.parse(extracted);
      return extracted;
    } catch (e) {}
  }

  // Final fallback: find braces
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const slice = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      JSON.parse(slice);
      return slice;
    } catch (e) {}
  }

  throw new Error("Failed to extract valid JSON from LLM response.");
}

function buildBody(query, systemText, useSystem, maxTokens = 800) {
  const userText = useSystem ? query : `${systemText}\n\nUser request: ${query}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0
    }
  };

  if (useSystem) {
    body.systemInstruction = {
      role: "system",
      parts: [{ text: systemText }]
    };
  }

  return body;
}

/**
 * Analyst Layer: Generates strategic reports from data
 */
export async function analyzeResults(query, results, config) {
  if (!Array.isArray(results) || results.length === 0) return null;
  
  try {
    validateConfig(config);
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
    const isGemma = model.toLowerCase().includes("gemma");

    const systemPrompt = `
      Role: Senior Strategic Data Analyst & Visualization Expert.
      Task: Analyze results and create a COMPREHENSIVE visualization suite and executive report.
      
      Structure:
      1. 🚀 Introduction: Start EXACTLY with: "I'll create additional detailed charts for you. Let me load the visualization system: Now let me create comprehensive detailed charts: I've created a comprehensive suite of detailed charts analyzing your database:"
      2. 📊 Visualization Suite: Create 4-8 DETAILED CHARTS. 
      
      FORMATTING RULE (CRITICAL):
      Each chart MUST be wrapped in \`\`\`chartjs code fences.
      Example:
      \`\`\`chartjs
      {
        "type": "pie",
        "data": {
          "labels": ["A", "B"],
          "datasets": [{
            "data": [10, 20],
            "backgroundColor": ["#3b82f6", "#10b981"]
          }]
        },
        "title": "Sample Chart"
      }
      \`\`\`

      CRITICAL RULES FOR CHARTS:
      - NEVER place chart JSON outside a \`\`\`chartjs block.
      - NEVER mix explanation text inside the code block.
      - VALID JSON ONLY: Triple-check for unclosed quotes (e.g., "#3b82f6" NOT "#3b82f6]).
      - DATA: ALWAYS populate labels and data arrays with ACTUAL values from results.
      - TYPES: Use ONLY "pie", "bar", "line", or "doughnut".
      - Generate ONLY ONE code block per visualization.
      - Use professional palettes: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'].

      3. 🧠 Strategic Insights: 3-5 deep business insights.
      4. 📈 Summary Statistics: Totals and counts at the bottom.
    `;

    const userPrompt = `
      User Question: "${query}"
      Database Results (Limited to top 100): ${JSON.stringify(results.slice(0, 100))}
    `;

    const body = buildBody(userPrompt, systemPrompt, !isGemma, 2500);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const result = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    return result.candidates[0].content.parts[0].text;
  } catch (e) {
    console.error("[LLM] Analyst Layer failed:", e.message);
    return null;
  }
}

/**
 * Planner Layer: Generates SQL Query Plan from Natural Language
 */
export async function callLLM(query, config) {
  validateConfig(config);
  
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const isGemma = model.toLowerCase().includes("gemma");
  const useSystem = isGemma ? false : (process.env.GEMINI_USE_SYSTEM === "true");

  const trimmedConfig = trimSchema(query, config);
  const systemText = buildSystemPrompt(trimmedConfig);
  const body = buildBody(query, systemText, useSystem, 1000);

  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const result = await fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const text = result.candidates[0].content.parts[0].text;
  
  try {
    const jsonStr = extractJson(text);
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error("[LLM] JSON Parsing failed. Raw response:", text);
    throw new Error(`LLM generated invalid query plan: ${e.message}`);
  }
}