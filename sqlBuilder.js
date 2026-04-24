import { findJoinPath } from "./joinResolver.js";

/**
 * Generates SQL from a structured plan.
 * Returns { sql, params }
 */
export function buildSQL(plan, config) {
  const {
    table,
    columns = [],
    filters = [],
    aggregations = [],
    joins = [],
    groupBy = [],
    orderBy,
    limit,
    distinct = false
  } = plan;

  const MAX_LIMIT = config?.MAX_LIMIT || 50;
  const relations = config?.relations || {};

  const selectParts = [];
  const params = [];

  for (const col of columns) {
    selectParts.push(col);
  }

  for (const agg of aggregations) {
    const aggAlias = agg.alias || `${agg.type.toLowerCase().replace(/\./g, '_')}_${agg.column.replace(/\./g, '_')}`;
    const aggType = agg.type.toUpperCase();
    
    if (aggType === "COUNT_DISTINCT") {
      selectParts.push(`COUNT(DISTINCT ${agg.column}) AS ${aggAlias}`);
    } else {
      selectParts.push(`COALESCE(${aggType}(${agg.column}), 0) AS ${aggAlias}`);
    }
  }

  let selectClause = selectParts.length ? selectParts.join(", ") : "*";
  if (distinct) {
    selectClause = `DISTINCT ${selectClause}`;
  }

  let joinClause = "";
  if (joins.length > 0) {
    const fullPathStrings = [];
    const visited = new Set();
    
    for (const joinTarget of joins) {
      if (visited.has(joinTarget)) continue;

      const path = findJoinPath(table, joinTarget, relations);
      
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
      const val = String(f.value);
      // Check if value looks like a PostgreSQL expression (NOW(), INTERVAL, etc.)
      const isSqlExpression = /^(NOW\(\)|CURRENT_DATE|INTERVAL\s+)/i.test(val) || val.includes("INTERVAL");
      
      if (isSqlExpression) {
        // Direct injection (sanitized) for SQL expressions
        // Only allow specific safe words to prevent full SQL injection
        const safeRegex = /^[A-Z0-9()., '\-]+$/i;
        if (!safeRegex.test(val)) {
            throw new Error(`Unsafe SQL expression in filter: ${val}`);
        }
        return `${f.column} ${f.operator} ${val}`;
      } else {
        // Standard parameterization
        params.push(f.value);
        return `${f.column} ${f.operator} $${params.length}`;
      }
    });
    whereClause = `WHERE ${filterStrings.join(" AND ")}`;
  }

  // Automatic GROUP BY for non-aggregated columns if aggregations are present
  let finalGroupBy = [...groupBy];
  if (aggregations.length > 0) {
    for (const col of columns) {
      if (!finalGroupBy.includes(col)) {
        finalGroupBy.push(col);
      }
    }
  }

  const groupByClause = finalGroupBy.length > 0 ? `GROUP BY ${finalGroupBy.join(", ")}` : "";

  let orderByClause = "";
  if (orderBy && orderBy.column) {
    orderByClause = `ORDER BY ${orderBy.column} ${orderBy.direction || "ASC"}`;
  }

  const safeLimit = Math.min(limit || 10, MAX_LIMIT);
  const limitClause = `LIMIT ${safeLimit}`;

  const sql = `SELECT ${selectClause} FROM ${table} ${joinClause} ${whereClause} ${groupByClause} ${orderByClause} ${limitClause};`.replace(/\s+/g, " ").trim();

  return { sql, params };
}
