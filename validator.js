import { McpError } from "./errors.js";
import { findJoinPath, resolveAllJoins } from "./joinResolver.js";

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

function isWildcardColumn(column) {
  const value = String(column).trim();
  return value === "*" || value.endsWith(".*");
}

function getReferencedTable(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed === "*" || trimmed.includes("(") || trimmed.includes(")")) {
    return null;
  }

  if (!trimmed.includes(".")) {
    return null;
  }

  return trimmed.split(".")[0];
}

function buildAggregationAlias(agg) {
  return agg.alias || `${agg.type.toLowerCase().replace(/\./g, '_')}_${agg.column.replace(/\./g, '_')}`;
}

function getAggregationAliasSet(plan) {
  return new Set((plan.aggregations || []).map(buildAggregationAlias));
}

function isKnownAggregationReference(plan, column) {
  return getAggregationAliasSet(plan).has(column);
}

function validateClauseOperand(config, baseTable, clause, label) {
  if (!clause || typeof clause.column !== "string") {
    throw new McpError(`Invalid ${label}: missing column`, "VALIDATION_FAILED", { clause });
  }

  const resolved = splitQualified(clause.column, baseTable);
  ensureColumn(config, resolved.table, resolved.column);

  if (!config.allowedOperators.includes(clause.operator)) {
    throw new McpError(`Invalid operator in ${label}: ${clause.operator}`, "VALIDATION_FAILED", { operator: clause.operator });
  }
}

function collectReferencedTables(plan, baseTable) {
  const referencedTables = new Set();

  for (const column of plan.columns || []) {
    const table = getReferencedTable(column);
    if (table && table !== baseTable) referencedTables.add(table);
  }

  for (const filter of plan.filters || []) {
    const table = getReferencedTable(filter.column);
    if (table && table !== baseTable) referencedTables.add(table);
  }

  for (const agg of plan.aggregations || []) {
    const table = getReferencedTable(agg.column);
    if (table && table !== baseTable) referencedTables.add(table);
    if (agg.condition) {
      const conditionTable = getReferencedTable(agg.condition.column);
      if (conditionTable && conditionTable !== baseTable) referencedTables.add(conditionTable);
    }
  }

  for (const groupColumn of plan.groupBy || []) {
    const table = getReferencedTable(groupColumn);
    if (table && table !== baseTable) referencedTables.add(table);
  }

  if (plan.orderBy?.column) {
    const table = getReferencedTable(plan.orderBy.column);
    if (table && table !== baseTable) referencedTables.add(table);
  }

  for (const clause of plan.having || []) {
    const table = getReferencedTable(clause.column);
    if (table && table !== baseTable) referencedTables.add(table);
  }

  return referencedTables;
}

function expandAndValidateJoins(plan, config) {
  const baseTable = plan.table;
  const explicitJoins = Array.isArray(plan.joins) ? plan.joins : [];
  const inferredJoins = Array.from(collectReferencedTables(plan, baseTable));
  const uniqueTargets = new Set([...explicitJoins, ...inferredJoins]);

  uniqueTargets.delete(baseTable);

  for (const joinTable of uniqueTargets) {
    ensureTable(config, joinTable);

    try {
      findJoinPath(baseTable, joinTable, config.relations);
    } catch (e) {
      throw new McpError(
        `No join path found between ${baseTable} and ${joinTable}. Please check database relationships.`,
        "INVALID_JOIN",
        { baseTable, joinTable }
      );
    }
  }

  return resolveAllJoins(baseTable, Array.from(uniqueTargets), config.relations);
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
    if (isWildcardColumn(column)) {
      const tableName = column === "*" ? baseTable : splitQualified(column, baseTable).table;
      ensureTable(config, tableName);
      continue;
    }

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
    validateClauseOperand(config, baseTable, filter, "filter");
  }
}

function validateAggregations(config, baseTable, aggregations) {
  for (const agg of aggregations) {
    if (!config.allowedAggregations.includes(agg.type)) {
      throw new McpError(`Invalid aggregation: ${agg.type}`, "VALIDATION_FAILED", { aggregation: agg.type });
    }
    const resolved = splitQualified(agg.column, baseTable);
    ensureColumn(config, resolved.table, resolved.column);

    if (agg.condition) {
      validateClauseOperand(config, baseTable, agg.condition, "aggregation condition");
    }
  }
}

function validateGroupBy(config, baseTable, groupBy) {
  for (const column of groupBy) {
    if (isWildcardColumn(column)) {
      throw new McpError(
        `Wildcard column "${column}" cannot be used in groupBy. Use explicit columns instead.`,
        "VALIDATION_FAILED",
        { column }
      );
    }

    const resolved = splitQualified(column, baseTable);
    ensureColumn(config, resolved.table, resolved.column);
  }
}

function validateHaving(config, baseTable, having, plan) {
  if (!having || having.length === 0) {
    return;
  }

  if (!plan.aggregations || plan.aggregations.length === 0) {
    throw new McpError(
      "HAVING requires at least one aggregation.",
      "VALIDATION_FAILED"
    );
  }

  for (const clause of having) {
    if (!clause || typeof clause.column !== "string") {
      throw new McpError("Invalid having clause: missing column", "VALIDATION_FAILED", { clause });
    }

    const isAggregationReference = isKnownAggregationReference(plan, clause.column);
    if (!isAggregationReference) {
      const resolved = splitQualified(clause.column, baseTable);
      ensureColumn(config, resolved.table, resolved.column);
    }

    if (!config.allowedOperators.includes(clause.operator)) {
      throw new McpError(`Invalid operator in having: ${clause.operator}`, "VALIDATION_FAILED", { operator: clause.operator });
    }
  }
}

function validateConsistency(plan) {
  const hasAggregations = plan.aggregations && plan.aggregations.length > 0;
  const hasGroupBy = plan.groupBy && plan.groupBy.length > 0;

  if (hasAggregations && (plan.columns || []).some(isWildcardColumn)) {
    throw new McpError(
      "Wildcard columns cannot be combined with aggregations. Use explicit columns or remove aggregations.",
      "VALIDATION_FAILED"
    );
  }

  // If we have aggregations OR a manual groupBy, we MUST ensure all selected columns are grouped
  if (hasAggregations || hasGroupBy) {
    if (!plan.groupBy) plan.groupBy = [];
    const groupSet = new Set(plan.groupBy);

    for (const col of plan.columns || []) {
      if (isWildcardColumn(col)) {
        continue;
      }

      if (!groupSet.has(col)) {
        plan.groupBy.push(col);
        groupSet.add(col);
      }
    }
  }
}

function validateOrderBy(config, baseTable, plan) {
  if (!plan.orderBy) {
    return;
  }

  if (!isKnownAggregationReference(plan, plan.orderBy.column)) {
    const resolved = splitQualified(plan.orderBy.column, baseTable);
    ensureColumn(config, resolved.table, resolved.column);
  }

  plan.orderBy.direction = normalizeDirection(plan.orderBy.direction);
}

export function estimatePlanConfidence(query, plan, config) {
  const q = String(query || "").toLowerCase();
  let score = 1;

  const hasColumns = Array.isArray(plan.columns) && plan.columns.length > 0;
  const hasAggregations = Array.isArray(plan.aggregations) && plan.aggregations.length > 0;
  const hasJoins = Array.isArray(plan.joins) && plan.joins.length > 0;
  const hasGroupBy = Array.isArray(plan.groupBy) && plan.groupBy.length > 0;
  const hasOrderBy = !!plan.orderBy;

  if (!hasColumns && !hasAggregations) {
    score -= 0.35;
  }

  if (/\b(top|highest|lowest|most|least|largest|smallest|rank|sorted)\b/.test(q) && !hasOrderBy) {
    score -= 0.25;
  }

  if (/\b(count|total|sum|average|avg|unique|distinct|how many)\b/.test(q) && !hasAggregations) {
    score -= 0.25;
  }

  if (/\b(by|per|each)\b/.test(q) && hasAggregations && !hasGroupBy) {
    score -= 0.2;
  }

  if (/\b(with|related|joined|across|between|and)\b/.test(q) && !hasJoins && Object.keys(config.relations || {}).length > 0) {
    score -= 0.15;
  }

  if (!plan.limit) {
    score -= 0.1;
  }

  return Math.max(0, Math.min(1, score));
}

export function validatePlan(plan, config) {
  const baseTable = plan.table;
  ensureTable(config, baseTable);

  validateColumns(config, baseTable, plan.columns || []);
  validateFilters(config, baseTable, plan.filters || []);
  validateAggregations(config, baseTable, plan.aggregations || []);
  validateHaving(config, baseTable, plan.having || [], plan);
  plan.joins = expandAndValidateJoins(plan, config);
  validateConsistency(plan);
  validateGroupBy(config, baseTable, plan.groupBy || []);
  validateOrderBy(config, baseTable, plan);

  if (plan.limit && plan.limit > config.MAX_LIMIT) {
    plan.limit = config.MAX_LIMIT;
  }

  return plan;
}