# AGENTS.md — kf-mcp-servers
Central memory for all MCP servers in this repo. Update when adding/changing servers.

## Repo Structure
Each MCP server lives in its own subfolder. Each is deployed as an independent Railway service pointing to this git repo with a subfolder root.

```
kf-mcp-servers/
├── blink-cms/       # Blink CMS + web tools (migrated from ~/Developer/blink-cms)
└── ...              # Future MCP servers
```

## Servers

### postgres
- **Purpose**: HTTP MCP wrapper for any PostgreSQL database — same tools/resources as `@modelcontextprotocol/server-postgres`
- **Transport**: HTTP (Express + Streamable HTTP)
- **Port**: 3200
- **Auth**: `MCP_API_KEY` via `Authorization: Bearer` or `x-api-key` header
- **Endpoint**: `POST /mcp`
- **Health**: `GET /health`
- **Tools**: `query` (read-only SQL, enforced via BEGIN READ ONLY / ROLLBACK)
- **Resources**: one per table — `postgres://{host}/{table}/schema` (DDL schema text)
- **Env vars**: `DATABASE_URL` (required), `MCP_API_KEY`, `PORT`
- **Railway**: Deploy one instance per DB, root dir = `postgres/`, set `DATABASE_URL` per service
- **Replaces**: stdio `@modelcontextprotocol/server-postgres` for pg2, creator-crm, etc.

### datafast
- **Purpose**: DataFast analytics — all data queries, realtime, goal/payment tracking, visitor profiles
- **Transport**: HTTP (Express + Streamable HTTP)
- **Port**: 3500
- **Auth (MCP)**: `MCP_API_KEY` via `Authorization: Bearer` or `x-api-key` header
- **DataFast Key**: `X-Datafast-Api-Key` header per request (or `DATAFAST_API_KEY` env fallback)
- **Endpoint**: `POST /mcp`
- **Health**: `GET /health`
- **Tools**: `get_metadata`, `get_overview`, `get_timeseries`, `get_realtime`, `get_realtime_map`, `get_pages`, `get_referrers`, `get_campaigns`, `get_goals`, `get_countries`, `get_regions`, `get_cities`, `get_devices`, `get_browsers`, `get_operating_systems`, `get_hostnames`, `get_visitor`, `track_goal`, `track_payment`, `delete_goals`, `delete_payments`
- **Env vars**: `MCP_API_KEY`, `DATAFAST_API_KEY` (optional fallback), `PORT`
- **Railway**: Root dir = `datafast/`

### railway
- **Purpose**: Manage Railway infrastructure — projects, services, environments, deployments, logs, variables, domains
- **Transport**: HTTP (Express + Streamable HTTP)
- **Port**: 3400
- **Auth (MCP)**: `MCP_API_KEY` via `Authorization: Bearer` or `x-api-key` header
- **Railway Token**: `X-Railway-Token` header per request (or `RAILWAY_TOKEN` env fallback)
- **Endpoint**: `POST /mcp`
- **Health**: `GET /health`
- **Tools**: `check_status`, `list_projects`, `list_services`, `list_environments`, `list_deployments`, `get_logs` (build|deploy), `list_variables`, `set_variable`, `redeploy`, `restart_deployment`, `create_environment`, `generate_domain`
- **Implementation**: Direct Railway GraphQL API (`https://backboard.railway.com/graphql/v2`) — no CLI needed
- **Env vars**: `MCP_API_KEY`, `RAILWAY_TOKEN` (optional fallback), `PORT`
- **Railway**: Root dir = `railway/`
- **Token type**: Account token (from railway.com/account/tokens) — broadest scope

### stripe
- **Purpose**: Stripe management — products, prices, webhooks, billing portal, query events/charges/subscriptions
- **Transport**: HTTP (Streamable HTTP, raw node `http` module)
- **Port**: 3300
- **Auth**: Stripe API key via `X-Stripe-Api-Key` header (or `STRIPE_SECRET_KEY` env fallback)
- **Endpoint**: `POST /mcp`
- **Health**: `GET /health`
- **Tools**: `stripe_connect`, `stripe_products`, `stripe_prices`, `stripe_webhooks`, `stripe_portal_config`, `stripe_query`
- **Env vars**: `STRIPE_SECRET_KEY` (optional fallback), `PORT`, `TRANSPORT_TYPE=http`
- **Runtime**: `tsx` (no tsc build step — source runs directly)
- **Railway**: Root dir = `stripe/`
- **Replaces**: stdio `github:ShadowWalker2014/mcp mcp-stripe`

### blink-cms
- **Purpose**: Blink.new CMS management + web tools (search, fetch, SERP)
- **Transport**: HTTP (Express + Streamable HTTP)
- **Port**: 3100
- **Auth**: `MCP_API_KEY` via `Authorization: Bearer` or `x-api-key` header
- **Endpoint**: `POST /mcp`
- **Health**: `GET /health`
- **Tools**: cms_list_dir, cms_read_file, cms_write_file, cms_search_replace, cms_delete_file, cms_restore_file, cms_list_trash, cms_multi_edit, cms_search, cms_grep, cms_publish, cms_unpublish, cms_discard_draft, cms_list_drafts, cms_get_versions, cms_activate_version, cms_read_version, web_search, fetch_url, google_serp
- **Env vars**: `MCP_API_KEY`, `CMS_API_URL`, `EXA_API_KEY`, `VALUE_SERP_API_KEY`, `PORT`
- **Railway**: Deployed from this repo, root dir = `blink-cms/`
- **Deprecated**: Old repo at `~/Developer/blink-cms` — no longer maintained

## Railway Deployment Pattern
Each server in this monorepo deploys as its own Railway service:
1. Connect Railway service to this GitHub repo
2. Set **Root Directory** = `<server-folder>/` (e.g. `blink-cms/`)
3. Railway picks up the `Dockerfile` and `railway.json` within that folder
4. Set env vars per service in Railway dashboard

## Adding a New MCP Server
1. Create `<name>/` folder with: `src/`, `Dockerfile`, `railway.json`, `package.json`, `tsconfig.json`
2. Use Express + `@modelcontextprotocol/sdk` StreamableHTTPServerTransport (stateless)
3. Always expose `GET /health` and `POST /mcp`
4. Add auth via `MCP_API_KEY` env var
5. Update this AGENTS.md with server details
