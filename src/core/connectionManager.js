import { createClient } from "@supabase/supabase-js";
import { discoverSchema } from "../../schemaDiscoverer.js";

class ConnectionManager {
  constructor() {
    this.connections = new Map();
  }

  async register(alias, url, key) {
    const supabase = createClient(url, key);

    const { error } = await supabase.rpc("execute_sql", {
      sql: "SELECT 1"
    });

    if (error) {
      throw new Error(
        `Failed to connect to "${alias}". Ensure the "execute_sql" RPC exists. Error: ${error.message}`
      );
    }

    const config = await discoverSchema(supabase);
    this.connections.set(alias, { supabase, config, url, key });

    return {
      config,
      tableCount: Object.keys(config.schema).length,
      tables: Object.keys(config.schema)
    };
  }

  get(alias) {
    const conn = this.connections.get(alias);
    if (!conn) {
      throw new Error(`Database alias "${alias}" not found. Use "register_db" first.`);
    }
    return conn;
  }

  list() {
    return Array.from(this.connections.entries()).map(([alias, { config }]) => ({
      alias,
      tables: Object.keys(config.schema).length
    }));
  }
}

export const connectionManager = new ConnectionManager();