import {
  MAX_LIMIT,
  allowedAggregations,
  allowedOperators,
  relations,
  schema
} from "./planConfig.js";

function normalizeDirection(direction) {
  if (!direction) {
    return "ASC";
  }

  const upper = String(direction).toUpperCase();
  if (upper !== "ASC" && upper !== "DESC") {
    throw new Error("Invalid order direction");
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

function ensureTable(table) {
  if (table === "users") return; // Support 'users' as alias for 'customers'
  if (!schema[table]) {
    throw new Error(`Invalid table: ${table}`);
  }
}

function resolveTable(table) {
  return table === "users" ? "customers" : table;
}

function ensureColumn(table, column) {
  const actualTable = resolveTable(table);
  ensureTable(actualTable);
  if (!schema[actualTable].includes(column)) {
    throw new Error(`Invalid column: ${actualTable}.${column}`);
  }
}

function ensureJoin(baseTable, joinTable) {
  const actualBase = resolveTable(baseTable);
  const actualJoin = resolveTable(joinTable);
  if (!relations[actualBase] || !relations[actualBase][actualJoin]) {
    throw new Error(`Invalid join: ${actualBase} -> ${actualJoin}`);
  }
}

function validateColumns(baseTable, columns) {
  for (const column of columns) {
    const resolved = splitQualified(column, baseTable);
    ensureColumn(resolved.table, resolved.column);
  }
}

function validateFilters(baseTable, filters) {
  for (const filter of filters) {
    const resolved = splitQualified(filter.column, baseTable);
    ensureColumn(resolved.table, resolved.column);
    if (!allowedOperators.includes(filter.operator)) {
      throw new Error(`Invalid operator: ${filter.operator}`);
    }
  }
}

function validateAggregations(baseTable, aggregations) {
  for (const agg of aggregations) {
    if (!allowedAggregations.includes(agg.type)) {
      throw new Error(`Invalid aggregation: ${agg.type}`);
    }
    const resolved = splitQualified(agg.column, baseTable);
    ensureColumn(resolved.table, resolved.column);
  }
}

function validateConsistency(plan) {
  // If aggregations exist, columns either must be in groupBy or be part of an aggregation
  if (plan.aggregations && plan.aggregations.length > 0) {
    const groupSet = new Set(plan.groupBy || []);
    for (const col of plan.columns || []) {
      if (!groupSet.has(col)) {
        throw new Error(`Column ${col} must appear in GROUP BY clause when using aggregations`);
      }
    }
  }
}

function validateOrderBy(plan) {
  if (!plan.orderBy) {
    return;
  }

  const allowed = new Set();
  
  // Columns selected are always valid for order by
  for (const column of plan.columns || []) {
    allowed.add(column);
    // Also allow raw column name if it was qualified
    if (column.includes(".")) allowed.add(column.split(".")[1]);
  }
  
  for (const column of plan.groupBy || []) {
    allowed.add(column);
  }
  
  for (const agg of plan.aggregations || []) {
    const alias = agg.alias || `${agg.type.toLowerCase().replace(/\./g, '_')}_${agg.column.replace(/\./g, '_')}`;
    allowed.add(alias);
    if (agg.alias) allowed.add(agg.alias);
  }

  if (!allowed.has(plan.orderBy.column)) {
    throw new Error(`Invalid orderBy column: ${plan.orderBy.column}. Must be a selected column, group by column, or aggregation alias.`);
  }
}

export function validatePlan(plan) {
  const allowedKeys = new Set([
    "table",
    "columns",
    "filters",
    "aggregations",
    "groupBy",
    "orderBy",
    "limit",
    "joins"
  ]);

  for (const key of Object.keys(plan)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unknown field: ${key}`);
    }
  }

  // Normalize 'users' to 'customers' at the root
  if (plan.table === "users") {
    plan.table = "customers";
  }

  ensureTable(plan.table);

  const joins = plan.joins || [];
  for (let i = 0; i < joins.length; i++) {
    if (joins[i] === "users") joins[i] = "customers";
    ensureJoin(plan.table, joins[i]);
  }

  // Helper to normalize table references within columns/filters
  const normalizeRefs = (items, base) => {
    if (!items) return;
    return items.map(item => {
      if (typeof item === 'string') {
        return item.replace(/^users\./, "customers.");
      }
      if (item.column) {
        item.column = item.column.replace(/^users\./, "customers.");
      }
      return item;
    });
  };

  plan.columns = normalizeRefs(plan.columns, plan.table);
  plan.groupBy = normalizeRefs(plan.groupBy, plan.table);
  
  if (plan.filters) {
    plan.filters.forEach(f => f.column = f.column.replace(/^users\./, "customers."));
  }
  if (plan.aggregations) {
    plan.aggregations.forEach(a => a.column = a.column.replace(/^users\./, "customers."));
  }
  if (plan.orderBy) {
    plan.orderBy.column = plan.orderBy.column.replace(/^users\./, "customers.");
  }

  validateColumns(plan.table, plan.columns || []);
  validateFilters(plan.table, plan.filters || []);
  validateAggregations(plan.table, plan.aggregations || []);
  validateColumns(plan.table, plan.groupBy || []);
  validateConsistency(plan);

  if (plan.orderBy) {
    plan.orderBy.direction = normalizeDirection(plan.orderBy.direction);
  }

  validateOrderBy(plan);

  if (plan.limit === undefined || plan.limit > MAX_LIMIT || plan.limit <= 0) {
    plan.limit = MAX_LIMIT;
  }

  return plan;
}
