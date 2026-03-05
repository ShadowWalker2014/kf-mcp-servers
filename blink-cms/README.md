# Blink MCP Server

Unified MCP (Model Context Protocol) server for Blink tools.

## Tools

### CMS Tools (17 tools)
Content management for docs and blog articles.

| Tool | Description |
|------|-------------|
| `cms_list_dir` | List content in a directory |
| `cms_read_file` | Read content file (draft or published) |
| `cms_write_file` | Create or update content |
| `cms_search_replace` | Find and replace with diff |
| `cms_multi_edit` | Atomic multi-edit operation |
| `cms_delete_file` | Move to trash |
| `cms_restore_file` | Restore from trash |
| `cms_list_trash` | List deleted content |
| `cms_search` | Search content |
| `cms_grep` | Fuzzy search with excerpts |
| `cms_publish` | Publish content (creates version) |
| `cms_unpublish` | Hide from website |
| `cms_discard_draft` | Revert to published version |
| `cms_list_drafts` | List unpublished changes |
| `cms_get_versions` | Get version history |
| `cms_activate_version` | Rollback to version |
| `cms_read_version` | Read historical version |

### Web Tools (3 tools)
Web search and content fetching.

| Tool | Description |
|------|-------------|
| `web_search` | Search the web using Exa AI |
| `fetch_url` | Fetch and extract clean text from any URL |
| `google_serp` | Get Google SERP data for SEO analysis |

## Setup

```bash
bun install
bun run build
```

## Environment Variables

```bash
# CMS API
CMS_API_URL=https://blink.new/api/cms
CMS_API_KEY=your-cms-api-key

# Web Tools
EXA_API_KEY=your-exa-api-key
VALUE_SERP_API_KEY=your-valueserp-api-key

# Server Auth
MCP_API_KEY=your-mcp-api-key
```

## Usage

### HTTP Server (Railway/Production)
```bash
bun run start
# Server runs on http://localhost:3100
```

### Stdio Server (Local/Cursor)
```bash
bun run start:stdio
```

### With Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "blink-cms": {
      "command": "bun",
      "args": ["run", "/path/to/blink-cms/dist/index.js"],
      "env": {
        "CMS_API_URL": "https://blink.new/api/cms",
        "CMS_API_KEY": "your-key",
        "EXA_API_KEY": "your-exa-key",
        "VALUE_SERP_API_KEY": "your-serp-key"
      }
    }
  }
}
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with tool list |
| `/mcp` | POST | MCP protocol endpoint |

## Development

```bash
# HTTP server with hot reload
bun run dev:http

# Stdio server
bun run dev
```
