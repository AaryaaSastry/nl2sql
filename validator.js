import { McpError } from "./errors.js";
import { findJoinPath } from "./joinResolver.js";

function normalizeDirection(direction) {
  if (!direction) {
    return "ASC";
  }

  const upper = String(direction).toUpperCase();
  if (upper !== "ASC" && upper !== "DESC") {
    throw new McpError("Invalid order direction", "VALIDATION_FAILED", { direction });
  }

  return upper;
}

function splitQualified(column, baseTable) {
  const parts = column.split(".");
  if (parts.length === 1) {
    return { table: baseTable, column: parts[0] };
  }

  return { table: parts[0], column: parts[1] };
}

function ensureTable(config, table) {
  if (!config.schema[table]) {
    throw new McpError(`Invalid table: ${table}`, "INVALID_TABLE", { table });
  }
}

function resolveTable(table) {
  return table;
}

function ensureColumn(config, table, column) {
  const actualTable = resolveTable(table);
  ensureTable(config, actualTable);
  if (!config.schema[actualTable].includes(column)) {
    throw new McpError(`Invalid column: ${actualTable}.${column}`, "INVALID_COLUMN", { table: actualTable, column });
  }
}

// REMOVED ensureJoin entirely to prevent any accidental usage

function validateColumns(config, baseTable, columns) {
  for (const column of columns) {
    if (column.toUpperCase().includes("COUNT(") || column.toUpperCase().includes("SUM(") || column.toUpperCase().includes(" AS ")) {
      throw new McpError(
        `SQL functions detected in columns list: "${column}". All aggregations MUST be placed in the 'aggregations' array, not in 'columns'.`,
        "VALIDATION_FAILED",
        { column }
      );
    }
    
    const resolved = splitQualified(column, baseTable);
    ensureColumn(config, resolved.table, resolved.column);
  }
}

function validateFilters(config, baseTable, filters) {
  for (const filter of filters) {
    const resolved = splitQualified(filter.column, baseTable);
    ensureColumn(config, resolved.table, resolved.column);
    if (!config.allowedOperators.includes(filter.operator)) {
      throw new McpError(`Invalid operator: ${filter.operator}`, "VALIDATION_FAILED", { operator: filter.operator });
    }
  }
}

function validateAggregations(config, baseTable, aggregations) {
  for (const agg of aggregations) {
    if (!config.allowedAggregations.includes(agg.type)) {
      throw new McpError(`Invalid aggregation: ${agg.type}`, "VALIDATION_FAILED", { aggregation: agg.type });
    }
    const resolved = splitQualified(agg.column, baseTable);
    ensureColumn(config, resolved.table, resolved.column);
  }
}

function validateConsistency(plan) {
  const hasAggregations = plan.aggregations && plan.aggregations.length > 0;
  const hasGroupBy = plan.groupBy && plan.groupBy.length > 0;

  // If we have aggregations OR a manual groupBy, we MUST ensure all selected columns are grouped
  if (hasAggregations || hasGroupBy) {
    if (!plan.groupBy) plan.groupBy = [];
    const groupSet = new Set(plan.groupBy);

    for (const col of plan.columns || []) {
      if (!groupSet.has(col)) {
        plan.groupBy.push(col);
        groupSet.add(col);
      }
    }
  }
}

function validateOrderBy(plan) {
  if (!plan.orderBy) {
    return;
  }

  plan.orderBy.direction = normalizeDirection(plan.orderBy.direction);
}

export function validatePlan(plan, config) {
  const baseTable = plan.table;
  ensureTable(config, baseTable);

  if (plan.joins) {
    const uniqueJoins = new Set();
    const validatedJoins = [];

    for (const joinTable of plan.joins) {
      const actualBase = resolveTable(baseTable);
      const actualJoin = resolveTable(joinTable);

      if (actualJoin === actualBase) continue;
      if (uniqueJoins.has(actualJoin)) continue;

      try {
        // Use the transitive path resolver
        findJoinPath(actualBase, actualJoin, config.relations);
      } catch (e) {
        throw new McpError(`No join path found between ${actualBase} and ${actualJoin}. Please check database relationships.`, "INVALID_JOIN", { baseTable: actualBase, joinTable: actualJoin });
      }
      uniqueJoins.add(actualJoin);
      validatedJoins.push(joinTable);
    }
    plan.joins = validatedJoins;
  }

  validateColumns(config, baseTable, plan.columns || []);
  validateFilters(config, baseTable, plan.filters || []);
  validateAggregations(config, baseTable, plan.aggregations || []);
  validateConsistency(plan);
  validateOrderBy(plan);

  if (plan.limit && plan.limit > config.MAX_LIMIT) {
    plan.limit = config.MAX_LIMIT;
  }

  return plan;
}