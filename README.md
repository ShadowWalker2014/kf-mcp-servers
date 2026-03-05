# kf-mcp-servers

Monorepo of HTTP MCP servers, each deployed as an independent Railway service.

## Servers

| Folder | Purpose | Port | Docs |
|--------|---------|------|------|
| [`blink-cms/`](./blink-cms/README.md) | Blink.new CMS + web search tools | 3100 | [→](./blink-cms/README.md) |
| [`postgres/`](./postgres/README.md) | PostgreSQL query + schema explorer | 3200 | [→](./postgres/README.md) |
| [`stripe/`](./stripe/README.md) | Stripe products, billing, events | 3300 | [→](./stripe/README.md) |
| [`railway/`](./railway/README.md) | Railway infrastructure management | 3400 | [→](./railway/README.md) |

## How it works

Each server is a stateless HTTP MCP server using the [MCP Streamable HTTP transport](https://modelcontextprotocol.org/docs/concepts/transports). Credentials (API keys, tokens) are passed per-request via HTTP headers — one deployed server serves any number of clients.

```
Cursor / AI client
      │
      │  POST /mcp
      │  Authorization: Bearer <MCP_API_KEY>
      │  X-<Service>-Token: <service-credential>
      ▼
  Railway service
  (kf-mcp-servers/<folder>)
      │
      ▼
  Upstream API / Database
```

## Cursor setup

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "blink-cms": {
      "url": "https://blink-cms-production.up.railway.app/mcp",
      "headers": { "Authorization": "Bearer <MCP_API_KEY>" }
    },
    "pg2-postgres": {
      "url": "https://postgres-production-85106.up.railway.app/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_API_KEY>",
        "X-Database-URL": "postgresql://..."
      }
    },
    "stripe": {
      "url": "https://stripe-production-bc3a.up.railway.app/mcp",
      "headers": { "X-Stripe-Api-Key": "sk_live_..." }
    },
    "railway": {
      "url": "https://railway-production-9f1b.up.railway.app/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_API_KEY>",
        "X-Railway-Token": "<railway-account-token>"
      }
    }
  }
}
```

## Railway deployment

Each server deploys from this single repo. In Railway:

1. Create a new service → connect this GitHub repo
2. Set **Root Directory** to the server subfolder (e.g. `postgres/`)
3. Railway uses the `Dockerfile` inside that folder
4. Add env vars in the Railway dashboard

## Local development

```bash
cd <server-folder>
npm install
npm run dev        # starts with tsx watch
```

Server listens on `http://localhost:<port>/mcp`.

## Adding a new server

1. Create `<name>/` with: `src/index.ts`, `Dockerfile`, `railway.json`, `package.json`, `tsconfig.json`, `README.md`
2. Use Express 5 + `@modelcontextprotocol/sdk` `StreamableHTTPServerTransport` (stateless, `sessionIdGenerator: undefined`)
3. Always expose `GET /health` and `POST /mcp`
4. Accept `MCP_API_KEY` via `Authorization: Bearer` header
5. Accept service credentials via a dedicated `X-<Name>` header
6. Update `AGENTS.md` with server details
