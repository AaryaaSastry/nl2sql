import { createClient } from "@supabase/supabase-js";

/**
 * Fetches schema metadata from Supabase and formats it for the MCP server.
 * Replaces the need for a static planConfig.js.
 */
export async function discoverSchema(supabaseClient) {
  // 1. Fetch all tables, columns, and types from the public schema
  const { data: columnData, error: columnError } = await supabaseClient.rpc("execute_sql", {
    sql: `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`
  });

  if (columnError) {
    throw new Error(`Failed to fetch columns: ${columnError.message}`);
  }

  // 2. Fetch all foreign key relationships for join discovery
  const { data: fkData, error: fkError } = await supabaseClient.rpc("execute_sql", {
    sql: `SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name FROM information_schema.table_constraints AS tc JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`
  });

  if (fkError) {
    throw new Error(`Failed to fetch foreign keys: ${fkError.message}`);
  }

  // 3. Process Columns and Types
  const schema = {};
  const types = {};
  columnData.forEach(row => {
    if (!schema[row.table_name]) {
      schema[row.table_name] = [];
      types[row.table_name] = {};
    }
    schema[row.table_name].push(row.column_name);
    types[row.table_name][row.column_name] = row.data_type;
  });

  // 4. Process Relations (Bidirectional)
  const relations = {};
  // Initialize all tables in relations object
  Object.keys(schema).forEach(table => {
    relations[table] = {};
  });

  fkData.forEach(row => {
    const table = row.table_name;
    const foreignTable = row.foreign_table_name;
    const forwardCondition = `${table}.${row.column_name} = ${foreignTable}.${row.foreign_column_name}`;
    const reverseCondition = `${foreignTable}.${row.foreign_column_name} = ${table}.${row.column_name}`;

    // A -> B
    if (relations[table]) {
      relations[table][foreignTable] = forwardCondition;
    }
    // B -> A (Required by joinResolver BFS)
    if (relations[foreignTable]) {
      relations[foreignTable][table] = reverseCondition;
    }
  });

  // 5. Default safety configs
  const allowedAggregations = ["SUM", "AVG", "COUNT", "COUNT_DISTINCT", "MIN", "MAX"];
  const allowedOperators = ["=", "!=", ">", "<", ">=", "<=", "LIKE", "ILIKE", "IN", "IS NULL", "IS NOT NULL"];
  const MAX_LIMIT = 50;

  return {
    schema,
    types,
    relations,
    allowedAggregations,
    allowedOperators,
    MAX_LIMIT
  };
}