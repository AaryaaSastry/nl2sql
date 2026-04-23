import { relations, schema, MAX_LIMIT } from "./planConfig.js";

const DEFAULT_MODEL = "gemini-1.5-flash";

function buildSystemPrompt() {
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
    "4. CUSTOMER ALIAS: If the user says 'users', treat that as 'customers' unless the query clearly means something else.",
    "5. AGGREGATION: If metrics from multiple tables are requested (e.g. data AND calls), group by the primary entity (e.g. customers.id or customers.name).",
    "6. FORMAT: Return ONLY the JSON object. No prose. No markdown unless wrapped in ```json.",
    `7. LIMIT: Always include a limit (default: 10, max: ${MAX_LIMIT}).`,
    "8. NO CLARIFICATION: Never ask the user where data is stored or for a file upload. Use the provided schema and tools.",
    "9. DATA SOURCE: The data is stored in a Supabase PostgreSQL database accessible via the tools you have.",
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
        aggregations: [{ type: "SUM|AVG|COUNT", column: "table.col", alias: "alias" }],
        groupBy: ["table.col1", "table.col2"],
        orderBy: { column: "alias_or_col", direction: "DESC|ASC" },
        limit: 10,
        joins: ["table2", "table3"]
      },
      null,
      2
    )
  ].join("\n");
}

function extractJson(text) {
  const trimmed = text.trim();
  console.error("DEBUG: LLM content to parse:", trimmed);

  // 1. Check if it's already a clean JSON object
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  // 2. Try to extract from Markdown code blocks
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch) {
    console.error("DEBUG: Extracted from code block.");
    return fencedMatch[1].trim();
  }

  // 3. Last ditch: find first { and last }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    console.error("DEBUG: Extracted using brace indices.");
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function buildBody(query, systemText, useSystem) {
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const userText = useSystem ? query : `${systemText}\n\nUser request: ${query}`;
  
  return {
    systemInstruction: useSystem
      ? {
          role: "system",
          parts: [{ text: systemText }]
        }
      : undefined,
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      maxOutputTokens: 800,
      temperature: 0
    }
  };
}

export async function callLLM(query, retryContext = null) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY in .env");
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const useSystem = String(process.env.GEMINI_USE_SYSTEM || "").toLowerCase() === "true";
  const systemText = buildSystemPrompt();
  
  // If this is a retry, append the error context to the user query
  const refinedQuery = retryContext 
    ? `${query}\n\nCRITICAL: Your previous response was invalid.\nError: ${retryContext.error}\nInvalid JSON: ${retryContext.invalidJson}\nPlease fix the JSON and ensure it strictly follows the schema.`
    : query;

  const body = buildBody(refinedQuery, systemText, useSystem);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM error: ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  const content = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    throw new Error("LLM returned empty content");
  }

  const jsonText = extractJson(content);
  try {
    return { plan: JSON.parse(jsonText), raw: jsonText };
  } catch (error) {
    console.error("DEBUG: Failed to parse LLM JSON. Raw content:", content);
    // Return both the error and the raw text so the repair loop can use it
    return { error: error.message, raw: content, isParseError: true };
  }
}
