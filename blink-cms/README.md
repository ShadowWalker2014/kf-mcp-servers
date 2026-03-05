# blink-cms

HTTP MCP server for Blink.new CMS management and web tools. Manage docs and blog content on blink.new, plus web search and URL fetching.

## Tools

### CMS tools

| Tool | Description |
|------|-------------|
| `cms_list_dir` | List files and folders in a CMS directory |
| `cms_read_file` | Read a CMS file's content |
| `cms_write_file` | Write/create a CMS file (optionally publish) |
| `cms_search_replace` | Find and replace text in a CMS file |
| `cms_delete_file` | Move a file to trash |
| `cms_restore_file` | Restore a file from trash |
| `cms_list_trash` | List trashed files |
| `cms_multi_edit` | Apply multiple search/replace edits in one call |
| `cms_search` | Full-text search across CMS content |
| `cms_grep` | Grep CMS content with cropped output |
| `cms_publish` | Publish one or more draft files |
| `cms_unpublish` | Unpublish published files |
| `cms_discard_draft` | Discard unpublished draft changes |
| `cms_list_drafts` | List files with unpublished changes |
| `cms_get_versions` | List version history for a file |
| `cms_activate_version` | Restore a file to a previous version |
| `cms_read_version` | Read the content of a specific version |

### Web tools

| Tool | Description |
|------|-------------|
| `web_search` | Search the web via Exa AI |
| `fetch_url` | Fetch and parse a URL's content as markdown |
| `google_serp` | Google search results via ValueSerp |

## Auth

| Header | Purpose |
|--------|---------|
| `Authorization: Bearer <key>` | MCP server auth (`MCP_API_KEY`) — same key used for CMS API |

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MCP_API_KEY` | Yes | Auth key for both MCP access and CMS API calls |
| `CMS_API_URL` | No | CMS API base URL (defaults to `https://blink.new/api/cms`) |
| `EXA_API_KEY` | No | Required for `web_search` tool |
| `VALUE_SERP_API_KEY` | No | Required for `google_serp` tool |
| `PORT` | No | Defaults to `3100` |

## Cursor config

```json
"blink-cms": {
  "url": "https://blink-cms.up.railway.app/mcp",
  "headers": {
    "Authorization": "Bearer <MCP_API_KEY>"
  }
}
```

## Local dev

```bash
npm install
MCP_API_KEY=secret CMS_API_URL=https://blink.new/api/cms npm run dev:http
```

Health check: `GET http://localhost:3100/health`

## Railway deployment

- **Root Directory**: `blink-cms/`
- **Env vars**: `MCP_API_KEY` (required), `CMS_API_URL`, `EXA_API_KEY`, `VALUE_SERP_API_KEY`
