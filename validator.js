export { estimatePlanConfidence, validatePlan } from "./src/core/validator.js";

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