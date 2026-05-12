import { McpError } from "../../errors.js";

/**
 * Validates that the query is a SELECT statement and contains no destructive keywords.
 * @param {string} sql
 */
export function ensureSqlSafety(sql) {
  const normalized = sql.trim().toUpperCase();

  if (!normalized.startsWith("SELECT")) {
    throw new McpError("Only SELECT statements are allowed.", "SQL_INJECTION", { type: "non_select" });
  }

  const destructive = ["DROP", "DELETE", "UPDATE", "ALTER", "INSERT", "TRUNCATE", "GRANT", "REVOKE"];
  for (const keyword of destructive) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(sql)) {
      throw new McpError(`Forbidden keyword '${keyword}' detected.`, "SQL_INJECTION", { keyword });
    }
  }

  if (sql.includes(";")) {
    const parts = sql.split(";").filter(p => p.trim() !== "");
    if (parts.length > 1) {
      throw new McpError("Multiple statements detected.", "SQL_INJECTION", { type: "multi_statement" });
    }
  }
}

/**
 * Validates SQL expressions used in filter values.
 */
export function validateSqlExpression(value) {
  const val = String(value).trim();

  const safePatterns = [
    /^NOW\(\)$/i,
    /^CURRENT_DATE$/i,
    /^CURRENT_TIMESTAMP$/i,
    /^INTERVAL\s+'[0-9]+ (days?|hours?|minutes?|seconds?|months?|years?)'/i,
    /^NULL$/i
  ];

  for (const pattern of safePatterns) {
    if (pattern.test(val)) {
      return true;
    }
  }

  return false;
}

export function parameterizeFilters(filters, startIndex = 1) {
  const params = [];
  const filterStrings = filters.map((f, i) => {
    params.push(f.value);
    return `${f.column} ${f.operator} $${startIndex + i}`;
  });

  return {
    filterString: filterStrings.join(" AND "),
    params
  };
}