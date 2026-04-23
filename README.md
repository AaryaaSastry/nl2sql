# telecom-mcp

Phase 1 MCP server that exposes a simple Supabase-backed tool.

## Phase 2 SQL builder

`sqlBuilder.js` exports `buildSQL(plan)` to convert a validated query plan into SQL.

Example plan:

```json
{
  "table": "customers",
  "columns": ["id", "name", "city"],
  "filters": [
    { "column": "city", "operator": "=", "value": "Bangalore" }
  ],
  "orderBy": { "column": "name", "direction": "ASC" },
  "limit": 10
}
```

Usage:

```js
import { buildSQL } from "./sqlBuilder.js";

const sql = buildSQL(plan);
console.log(sql);
```

## Phase 2 plan validation + MCP tool

The server also exposes a `query_plan` tool that validates a structured plan, builds SQL, and optionally executes it.

Example plan:

```json
{
  "table": "data_usage",
  "columns": ["customers.name"],
  "aggregations": [
    { "type": "SUM", "column": "data_usage.data_used_mb", "alias": "total_mb" }
  ],
  "joins": ["customers"],
  "groupBy": ["customers.name"],
  "orderBy": { "column": "total_mb", "direction": "DESC" },
  "limit": 5
}
```

Calling the tool without execution returns SQL only. To execute SQL, set an RPC function name in `.env`:

```env
SUPABASE_SQL_RPC=execute_sql
```

The RPC function must accept a single `sql` text argument. If not configured, the tool returns SQL only.

### Supabase RPC setup

Apply the SQL in [supabase/execute_sql.sql](supabase/execute_sql.sql) in the Supabase SQL editor. This creates a read-only RPC that only allows `SELECT` statements and returns JSON.

## Natural language queries

Set these in `.env`:

```env
GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-1.5-flash
GEMINI_USE_SYSTEM=false
```

Use the `query_nl` tool to convert English to a plan and then run it through validation and the SQL builder. Set `execute` to `true` only after the SQL RPC is configured.

If you see errors about developer/system instructions, keep `GEMINI_USE_SYSTEM=false` so the prompt is sent as part of the user message.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Set environment variables in `.env`:

```env
SUPABASE_URL=your_url
SUPABASE_KEY=your_anon_key
```

3. Start the server:

```bash
npm start
```

## Claude Desktop MCP config

```json
{
  "mcpServers": {
    "telecom-db": {
      "command": "node",
      "args": ["path/to/index.js"]
    }
  }
}
```
