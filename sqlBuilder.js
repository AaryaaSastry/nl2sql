import { findJoinPath } from "./joinResolver.js";
import { validateSqlExpression } from "./safety.js";

function buildOperandSql(column, value, params) {
  if (validateSqlExpression(value)) {
    return `${column} ${value}`;
  }

  params.push(value);
  return `${column} $${params.length}`;
}

function buildPredicateSql(clause, params) {
  if (clause.operator === "IS NULL" || clause.operator === "IS NOT NULL") {
    return `${clause.column} ${clause.operator}`;
  }

  return buildOperandSql(`${clause.column} ${clause.operator}`, clause.value, params);
}

function buildAggregationExpression(agg, params) {
  const aggAlias = agg.alias || `${agg.type.toLowerCase().replace(/\./g, '_')}_${agg.column.replace(/\./g, '_')}`;
  const aggType = agg.type.toUpperCase();
  const hasCondition = !!agg.condition;
  const predicateSql = hasCondition ? buildPredicateSql(agg.condition, params) : null;

  if (aggType === "COUNT_DISTINCT") {
    const distinctValue = agg.column === "*" ? null : agg.column;
    if (!distinctValue) {
      throw new Error("COUNT_DISTINCT requires a concrete column.");
    }

    if (hasCondition) {
      return {
        alias: aggAlias,
        expression: `COUNT(DISTINCT CASE WHEN ${predicateSql} THEN ${distinctValue} END)`
      };
    }

    return {
      alias: aggAlias,
      expression: `COUNT(DISTINCT ${distinctValue})`
    };
  }

  if (aggType === "COUNT") {
    if (hasCondition) {
      return {
        alias: aggAlias,
        expression: `SUM(CASE WHEN ${predicateSql} THEN 1 ELSE 0 END)`
      };
    }

    return {
      alias: aggAlias,
      expression: agg.column === "*" ? "COUNT(*)" : `COUNT(${agg.column})`
    };
  }

  if (hasCondition) {
    const valueExpr = aggType === "SUM" ? agg.column : agg.column;
    const fallback = aggType === "SUM" ? "0" : "NULL";
    return {
      alias: aggAlias,
      expression: `${aggType}(CASE WHEN ${predicateSql} THEN ${valueExpr} ELSE ${fallback} END)`
    };
  }

  if (aggType === "SUM") {
    return {
      alias: aggAlias,
      expression: `COALESCE(SUM(${agg.column}), 0)`
    };
  }

  return {
    alias: aggAlias,
    expression: `${aggType}(${agg.column})`
  };
}

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
    having = [],
    orderBy,
    limit,
    distinct = false
  } = plan;

  const MAX_LIMIT = config?.MAX_LIMIT || 50;
  const relations = config?.relations || {};

  const selectParts = [];
  const params = [];
  const aggregateExpressionsByAlias = new Map();

  for (const col of columns) {
    selectParts.push(col);
  }

  for (const agg of aggregations) {
    const { alias, expression } = buildAggregationExpression(agg, params);
    aggregateExpressionsByAlias.set(alias, expression);
    selectParts.push(`${expression} AS ${alias}`);
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
      if (f.operator === "IS NULL" || f.operator === "IS NOT NULL") {
        return `${f.column} ${f.operator}`;
      }

      const isSqlExpression = validateSqlExpression(f.value);

      if (isSqlExpression) {
        // Direct injection for whitelisted SQL expressions
        return `${f.column} ${f.operator} ${f.value}`;
      } else {
        // Standard parameterization for literals
        params.push(f.value);
        return `${f.column} ${f.operator} $${params.length}`;
      }
    });
    whereClause = `WHERE ${filterStrings.join(" AND ")}`;
  }

  let havingClause = "";
  if (having.length > 0) {
    const havingStrings = having.map((clause) => {
      const target = aggregateExpressionsByAlias.get(clause.column) || clause.column;

      if (clause.operator === "IS NULL" || clause.operator === "IS NOT NULL") {
        return `${target} ${clause.operator}`;
      }

      const isSqlExpression = validateSqlExpression(clause.value);
      if (isSqlExpression) {
        return `${target} ${clause.operator} ${clause.value}`;
      }

      params.push(clause.value);
      return `${target} ${clause.operator} $${params.length}`;
    });

    havingClause = `HAVING ${havingStrings.join(" AND ")}`;
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
    const orderTarget = aggregateExpressionsByAlias.get(orderBy.column) || orderBy.column;
    orderByClause = `ORDER BY ${orderTarget} ${orderBy.direction || "ASC"}`;
  }

  const safeLimit = Math.min(limit || 10, MAX_LIMIT);
  const limitClause = `LIMIT ${safeLimit}`;

  const sql = `SELECT ${selectClause} FROM ${table} ${joinClause} ${whereClause} ${groupByClause} ${havingClause} ${orderByClause} ${limitClause};`.replace(/\s+/g, " ").trim();

  return { sql, params };
}