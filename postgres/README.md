# postgres

HTTP MCP server for PostgreSQL. Drop-in replacement for `@modelcontextprotocol/server-postgres` — same `query` tool and per-table schema resources, over HTTP with per-request database URLs.

## Tools

| Tool | Description |
|------|-------------|
| `query` | Run a read-only SQL query (enforced via `BEGIN READ ONLY` / `ROLLBACK`) |

## Resources

One resource per table: `postgres://{host}/{table}/schema` — returns the DDL (`CREATE TABLE ...`) for that table.

## Auth

| Header | Purpose |
|--------|---------|
| `Authorization: Bearer <key>` | MCP server auth (`MCP_API_KEY`) |
| `X-Database-URL: postgresql://...` | Which database to connect to |

The `X-Database-URL` header takes priority over the `DATABASE_URL` env var. This means **one deployed server handles any number of databases** — just pass a different URL header per Cursor MCP config entry.

Both PgBouncer proxy URLs and direct connection URLs work. Prefer PgBouncer (`maglev.proxy.rlwy.net`) for lower connection overhead.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | No | Default DB if no `X-Database-URL` header |
| `MCP_API_KEY` | No | Enables bearer auth. If unset, server is open. |
| `PORT` | No | Defaults to `3200` |

## Cursor config

```json
"pg2-postgres": {
  "url": "https://postgres-production-85106.up.railway.app/mcp",
  "headers": {
    "Authorization": "Bearer <MCP_API_KEY>",
    "X-Database-URL": "postgresql://postgres:<pass>@maglev.proxy.rlwy.net:22905/railway"
  }
},
"creator-crm": {
  "url": "https://postgres-production-85106.up.railway.app/mcp",
  "headers": {
    "Authorization": "Bearer <MCP_API_KEY>",
    "X-Database-URL": "postgresql://postgres:<pass>@centerbeam.proxy.rlwy.net:29356/railway"
  }
}
```

## Local dev

```bash
npm install
DATABASE_URL=postgresql://... MCP_API_KEY=secret npm run dev
```

Health check: `GET http://localhost:3200/health`

## Railway deployment

- **Root Directory**: `postgres/`
- **Env vars**: `MCP_API_KEY` (required), `DATABASE_URL` (optional default)
- The `Dockerfile` uses a two-stage build: builder compiles TypeScript, runner installs prod-only deps
