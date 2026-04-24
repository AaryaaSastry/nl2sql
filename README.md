# 🌌 Universal DB MCP Server

**Universal DB MCP** is a high-performance Model Context Protocol server that bridges the gap between Large Language Models (LLMs) and your data. It transforms any Supabase-backed PostgreSQL database into a searchable, intelligent data source that speaks human.

Instead of writing complex SQL or manually navigating tables, you can simply ask questions in plain English. The server handles schema discovery, relationship mapping, and SQL generation automatically.

---

## ✨ Capabilities

- **🗣️ Natural Language Interface**: Query your database using conversational English.
- **🔍 Intelligent Schema Discovery**: Automatically understands your tables, columns, and foreign key relationships.
- **🔗 Auto-Join Resolution**: Effortlessly queries across multiple tables by following database relations.
- **🛡️ Enterprise-Grade Safety**: Read-only execution with strict SQL sanitization and validation.
- **📊 Business Insights**: Not just raw data—get human-readable summaries and actionable insights.
- **🌐 Multi-Tenant Ready**: Manage multiple database environments (Prod, Staging, Dev) from a single interface.

## 🚀 Quick Start

### 1. Configure Environment
Create a `.env` file with your credentials:

```env
# Primary Connection (Default)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key

# AI Intelligence (Google Gemini)
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-1.5-flash
```

### 2. Enable SQL Execution
Run the following bridge function in your **Supabase SQL Editor** to allow the MCP server to securely fetch data:

```sql
-- Security-hardened SQL executor
CREATE OR REPLACE FUNCTION execute_sql(sql text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE result jsonb;
BEGIN
  IF lower(ltrim(sql)) NOT LIKE 'select %' THEN
    RAISE EXCEPTION 'Only SELECT statements are permitted.';
  END IF;
  EXECUTE format('SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (%s) t', sql) INTO result;
  RETURN result;
END;
$$;
```

### 3. Connect to Claude
Add the server to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "universal-db": {
      "command": "node",
      "args": ["/absolute/path/to/telecom-mcp/index.js"]
    }
  }
}
```

---

## 🛠️ Tool Reference

### `query_nl`
**The primary tool.** Ask any question about your data.
- *Example*: "Who are the top 10 customers by revenue this quarter?"
- *Example*: "Compare data usage between users in Bangalore vs Mumbai."

### `register_db`
Dynamically connect to a new Supabase project without restarting the server.
- *Parameters*: `alias`, `url`, `key`.

### `list_databases`
View all active connections and their discovered schemas.

### `refresh_schema`
Sync the server with your latest database changes (new tables or columns).

---

## 🔒 Security & Safety

- **Read-Only**: The server is architected to only execute `SELECT` statements.
- **Sanitization**: All generated SQL passes through a multi-stage validation layer before execution.
- **No Data Training**: Your data is used only for the immediate query and is not used to train underlying models.

