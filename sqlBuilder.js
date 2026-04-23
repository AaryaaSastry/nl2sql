import { MAX_LIMIT, relations } from "./planConfig.js";
import { findJoinPath } from "./joinResolver.js";

/**
 * Generates SQL from a structured plan.
 * Returns { sql, params }
 */
export function buildSQL(plan) {
  const {
    table,
    columns = [],
    filters = [],
    aggregations = [],
    joins = [],
    groupBy = [],
    orderBy,
    limit = MAX_LIMIT
  } = plan;

  const selectParts = [];
  const params = [];

  for (const col of columns) {
    selectParts.push(col);
  }

  for (const agg of aggregations) {
    const aggAlias = agg.alias || `${agg.type.toLowerCase().replace(/\./g, '_')}_${agg.column.replace(/\./g, '_')}`;
    selectParts.push(`COALESCE(${agg.type}(${agg.column}), 0) AS ${aggAlias}`);
  }

  const selectClause = selectParts.length ? selectParts.join(", ") : "*";

  let joinClause = "";
  if (joins.length > 0) {
    // Current simple resolver: supports single-hop joins to the primary table
    const fullPathStrings = [];
    const visited = new Set();
    
    // Process each target table join separately to find its path from our base table
    for (const joinTarget of joins) {
      if (visited.has(joinTarget)) continue;

      const path = findJoinPath(table, joinTarget);
      
      let prevTable = table;
      for (const nextTable of path) {
        if (!visited.has(nextTable)) {
          const condition = relations[prevTable]?.[nextTable];
          if (!condition) {
            throw new Error(`Missing relation: ${prevTable} -> ${nextTable}`);
          }
          fullPathStrings.push(`LEFT JOIN ${nextTable} ON ${condition}`);
          visited.add(nextTable);
        }
        prevTable = nextTable;
      }
    }
    joinClause = fullPathStrings.join(" ");
  }

  let whereClause = "";
  if (filters.length > 0) {
    const filterStrings = filters.map((f, i) => {
      params.push(f.value);
      // PostgreSQL parameters follow $1, $2, etc.
      return `${f.column} ${f.operator} $${params.length}`;
    });
    whereClause = `WHERE ${filterStrings.join(" AND ")}`;
  }

  const groupByClause = groupBy.length > 0 ? `GROUP BY ${groupBy.join(", ")}` : "";

  let orderByClause = "";
  if (orderBy) {
    orderByClause = `ORDER BY ${orderBy.column} ${orderBy.direction}`;
  }

  const safeLimit = Math.min(limit, MAX_LIMIT);
  const limitClause = `LIMIT ${safeLimit}`;

  const sql = `SELECT ${selectClause} FROM ${table} ${joinClause} ${whereClause} ${groupByClause} ${orderByClause} ${limitClause};`;

  return { 
    sql: sql.replace(/\s+/g, " ").trim(),
    params 
  };
}
