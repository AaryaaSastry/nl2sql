import dotenv from "dotenv";

const DEFAULT_MODEL = "gemini-2.0-flash-exp";

dotenv.config();

function trimSchema(query, config) {
  const { schema, relations } = config;
  const queryLower = query.toLowerCase();

  // 1. Simple keyword matching for tables
  const tables = Object.keys(schema);
  const relevantTables = new Set();

  tables.forEach(table => {
    // If table name is in query
    if (queryLower.includes(table.toLowerCase().replace(/_/g, " "))) {
      relevantTables.add(table);
    }
    // If table name (singular/plural) is in query
    const singular = table.endsWith("s") ? table.slice(0, -1) : table;
    if (queryLower.includes(singular.toLowerCase())) {
      relevantTables.add(table);
    }
  });

  // 2. If no tables found, use all (small schema) or top 10 (large schema)
  if (relevantTables.size === 0) {
    if (tables.length <= 15) return config;
    // For large schemas, we'd need better logic, but for now take all to be safe
    return config;
  }

  // 3. Add 1-hop related tables to allow for joins
  const expandedTables = new Set(relevantTables);
  relevantTables.forEach(table => {
    if (relations[table]) {
      Object.keys(relations[table]).forEach(related => expandedTables.add(related));
    }
  });

  // 4. Construct trimmed config
  const trimmedSchema = {};
  const trimmedRelations = {};

  expandedTables.forEach(table => {
    if (schema[table]) {
      trimmedSchema[table] = schema[table];
      trimmedRelations[table] = relations[table] || {};
    }
  });

  console.error(`[LLM] Trimmed schema from ${tables.length} to ${expandedTables.size} tables for query: "${query}"`);

  return {
    ...config,
    schema: trimmedSchema,
    relations: trimmedRelations
  };
}

function buildSystemPrompt(config, query) {
  const trimmedConfig = query ? trimSchema(query, config) : config;
  const { schema, relations, MAX_LIMIT } = trimmedConfig;
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
    "1. ONE QUERY, ONE TRUTH: Join all necessary tables into a single plan. Do not rely on multiple calls for a single insight.",
    "2. NO HALLUCINATIONS: Use ONLY the provided schema. Do not invent columns like 'customer_name' or 'minutes'.",
    "3. STICK TO FACTS: If the user asks for 'active' or 'overdue', and there is no 'is_active' or 'is_overdue' column, filter by available columns (e.g., status='unpaid').",
    "4. AGGREGATION: If metrics from multiple tables are requested, group by the primary entity (e.g. table.id or table.name).",
    "5. FORMAT: Return ONLY the JSON object. No prose. No markdown unless wrapped in ```json.",
    "7. LIMIT: Always include a limit (default: 10, max: ${MAX_LIMIT}).",
    "8. JOINS: In the 'joins' array, include ONLY the names of tables to join with the primary 'table'. DO NOT repeat the primary 'table' name in the 'joins' array. Do not create self-joins unless explicitly required.",
    "9. NO CLARIFICATION: Never ask the user where data is stored or for a file upload. Use the provided schema and tools.",
    "10. DISTINCT: Set 'distinct: true' if the user asks for unique or distinct values.",
    "11. AGGREGATIONS: Support SUM, AVG, COUNT, COUNT_DISTINCT, MIN, and MAX.",
    "12. DATES: For relative dates (e.g. 'last 30 days', 'today'), use PostgreSQL syntax in the 'value' field (e.g. \"NOW() - INTERVAL '30 days'\").",
    "13. INTERACTIVE VISUALS: If a query involves grouping and counts (e.g., 'by factory'), always include the category name and the numeric value in the 'columns' list. The server will proactively recommend a chart if appropriate.",
    `14. CURRENT DATE: Today is ${new Date().toISOString().split('T')[0]}.`,
    "",
    "Schema:",
    tables,
    "",
    "Joins:",
    joinLines || "(none)",
    "",
    "Required Plan Structure:",
    JSON.stringify(
      {
        table: "primaryTable",
        columns: ["table1.col1", "table2.col2"],
        filters: [{ column: "table.col", operator: "=", value: "val" }],
        aggregations: [{ type: "SUM|AVG|COUNT|COUNT_DISTINCT|MIN|MAX", column: "table.col", alias: "alias" }],
        groupBy: ["table.col1", "table.col2"],
        orderBy: { column: "alias_or_col", direction: "DESC|ASC" },
        limit: 10,
        joins: ["table2", "table3"],
        distinct: false
      },
      null,
      2
    )
  ].join("\n");
}

function extractJson(text) {
  const trimmed = text.trim();
  console.error("DEBUG: LLM content to parse:", trimmed);

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function buildBody(query, systemText, useSystem) {
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const userText = useSystem ? query : `${systemText}\n\nUser request: ${query}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      maxOutputTokens: 800,
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

export async function analyzeResults(query, results, config) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || results.length === 0) return null;

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const isGemma = model.toLowerCase().includes("gemma");
  
  const systemPrompt = `
    Role: Senior Data Analyst.
    Task: Analyze the provided database results and write a professional report.
    
    Structure:
    1. Executive Summary: 1-2 sentences answering the user's question directly.
    2. Key Insights: 3-4 bullet points highlighting trends, anomalies, or important facts.
    3. Recommendations: What should the user do next based on this data?
    4. Follow-up: 2 suggested questions the user might want to ask next.

    Rules:
    - Be concise and professional.
    - If there are outliers, point them out.
    - Use a confident, analytical tone.
    - Keep the response under 250 words.
  `;

  const userPrompt = `
    User Question: "${query}"
    Database Results: ${JSON.stringify(results.slice(0, 20))}
    
    Please provide the analytical report.
  `;

  const body = buildBody(userPrompt, systemPrompt, !isGemma);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) return null;

    const result = await response.json();
    return result.candidates[0].content.parts[0].text;
  } catch (e) {
    console.error("Analyst Layer failed:", e);
    return null;
  }
}

export async function callLLM(query, config) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not found in .env");
  }

  // Detect model type - Gemma does not support system instructions
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const isGemma = model.toLowerCase().includes("gemma");
  const useSystem = isGemma ? false : (process.env.GEMINI_USE_SYSTEM === "true");

  const systemText = buildSystemPrompt(config, query);
  const body = buildBody(query, systemText, useSystem);

  console.error(`DEBUG: Using model ${model}, useSystem=${useSystem}`);
  console.error(`DEBUG: Request Body Keys: ${Object.keys(body).join(", ")}`);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`LLM Error: ${response.status} - ${err}`);
  }

  const result = await response.json();
  const text = result.candidates[0].content.parts[0].text;

  try {
    const jsonStr = extractJson(text);
    return JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Failed to parse LLM response as JSON: ${text}`);
  }
}