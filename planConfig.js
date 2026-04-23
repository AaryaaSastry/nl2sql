export const MAX_LIMIT = 50;

export const schema = {
  customers: ["id", "name", "phone", "city"],
  plans: ["id", "name", "price"],
  data_usage: ["id", "customer_id", "data_used_mb", "timestamp"],
  calls: ["id", "customer_id", "duration", "timestamp"],
  billing: ["id", "customer_id", "amount", "status", "billing_date"]
};

export const relations = {
  customers: {
    data_usage: "data_usage.customer_id = customers.id",
    billing: "billing.customer_id = customers.id",
    calls: "calls.customer_id = customers.id"
  },
  data_usage: {
    customers: "data_usage.customer_id = customers.id"
  },
  calls: {
    customers: "calls.customer_id = customers.id"
  },
  billing: {
    customers: "billing.customer_id = customers.id"
  }
};

export const allowedAggregations = ["SUM", "COUNT", "AVG", "MAX", "MIN"];
export const allowedOperators = ["=", ">", "<", ">=", "<=", "!=", "LIKE", "ILIKE"];
