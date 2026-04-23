/**
 * Safety layer for final SQL execution.
 */

/**
 * Validates that the query is a SELECT statement and contains no destructive keywords.
 * @param {string} sql 
 */
export function ensureSqlSafety(sql) {
  const normalized = sql.trim().toUpperCase();

  if (!normalized.startsWith("SELECT")) {
    throw new Error("Security violation: Only SELECT statements are allowed.");
  }

  const destructive = ["DROP", "DELETE", "UPDATE", "ALTER", "INSERT", "TRUNCATE", "GRANT", "REVOKE"];
  for (const keyword of destructive) {
    // Look for keywords as whole words
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(sql)) {
      throw new Error(`Security violation: Forbidden keyword '${keyword}' detected.`);
    }
  }

  if (sql.includes(";")) {
    // Check if there is anything after the first semicolon
    const parts = sql.split(";").filter(p => p.trim() !== "");
    if (parts.length > 1) {
      throw new Error("Security violation: Multiple statements detected.");
    }
  }
}

/**
 * Helper to generate placeholders for parameterized filters.
 * Returns { filterString, params }
 */
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
