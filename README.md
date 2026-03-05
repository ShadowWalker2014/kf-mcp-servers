# kf-mcp-servers

Monorepo of HTTP MCP servers, each deployed as its own Railway service.

## Servers

| Folder | Description | Tools |
|--------|-------------|-------|
| `blink-cms/` | Blink CMS + web search | cms_*, web_search, fetch_url, google_serp |

## Stack

- **Transport**: HTTP (Express + MCP Streamable HTTP)
- **Runtime**: Node 22 / Bun
- **Auth**: API key via `Authorization: Bearer` or `x-api-key`

## Railway Deployment

Each server deploys independently:
1. New Railway service → connect this GitHub repo
2. Set **Root Directory** to the server subfolder (e.g. `blink-cms/`)
3. Railway uses the `Dockerfile` inside that folder
4. Add env vars in Railway dashboard

## Local Dev

```bash
cd blink-cms
bun install
bun run dev:http
```

Then connect Cursor:
```json
{
  "mcpServers": {
    "blink-cms": {
      "url": "http://localhost:3100/mcp",
      "headers": { "Authorization": "Bearer <MCP_API_KEY>" }
    }
  }
}
```
