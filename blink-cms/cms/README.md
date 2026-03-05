# Blink CMS MCP Server

MCP server for managing Blink docs and blog content via Cursor.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CMS_API_URL` | `https://blink.new/api/cms` |
| `CMS_API_KEY` | Your `BLINK_SUPER_ADMIN_API_KEY` from auto-engineer `.env.local` |
| `PORT` | Server port (default: `3100`) |

## Cursor Config

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "blink-cms": {
      "url": "https://YOUR-DEPLOYED-URL/sse"
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `cms_list_dir` | List content (`docs`, `blog`, `docs/build`) |
| `cms_read_file` | Read file (`docs/quickstart.mdx`) |
| `cms_write_file` | Create/update content |
| `cms_search_replace` | Edit content |
| `cms_delete_file` | Delete content |
| `cms_search` | Search content |

## Local Dev

```bash
bun install
CMS_API_URL=https://blink.new/api/cms CMS_API_KEY=xxx bun run dev:http
```
