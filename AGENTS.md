# AGENTS.md — kf-mcp-servers
Central memory for all MCP servers in this repo. Update when adding/changing servers.

## How to build a new MCP server
Follow the skill at `.cursor/skills/build-http-mcp/SKILL.md` — it contains the full template, deploy steps, and checklist.

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
- **Tools (129 total)**: Full Railway CLI + API feature parity — projects (CRUD, members, tokens, invitations, transfer, leave, scheduled delete), services (CRUD, connect/disconnect, duplicate, deploy, instance config, resource limits, upstream URL), environments (CRUD, rename, trigger deploys, base env override), deployments (list, get, logs, http logs, env logs, snapshot, redeploy, restart, cancel, stop, rollback, remove, approve, triggers CRUD), variables (list, set, bulk set, delete, shared vars, resolved vars), domains (list, generate, add/delete/update custom, domain status), TCP proxies (CRUD), volumes (CRUD, backups CRUD, backup schedules), plugins full lifecycle (create/delete/start/restart/reset/update/logs), GitHub (repos, branches, check access, update repo), regions, metrics/usage/estimated usage, egress gateways (static IPs), templates deploy, docker-compose import, webhooks (CRUD), private networks (CRUD, rename), integrations (CRUD), usage limits, API tokens, workspace management, workflow status
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

### tolt
- **Purpose**: Tolt affiliate/partner management — partners, customers, transactions, commissions, links, clicks, promotion codes
- **Transport**: HTTP (Express + Streamable HTTP)
- **Port**: 3700
- **Auth (MCP)**: `MCP_API_KEY` via `Authorization: Bearer` or `x-api-key` header
- **Tolt Key**: `X-Tolt-Api-Key` header per request (or `TOLT_API_KEY` env fallback)
- **Endpoint**: `POST /mcp`
- **Health**: `GET /health`
- **URL**: `https://tolt-mcp-production.up.railway.app`
- **Tools (32 total)**: `list_partners`, `get_partner`, `create_partner`, `update_partner`, `delete_partner`, `list_customers`, `get_customer`, `create_customer`, `update_customer`, `delete_customer`, `list_transactions`, `get_transaction`, `create_transaction`, `update_transaction`, `delete_transaction`, `refund_transaction`, `list_commissions`, `get_commission`, `create_commission`, `update_commission`, `delete_commission`, `list_links`, `get_link`, `create_link`, `update_link`, `delete_link`, `create_click`, `list_promotion_codes`, `get_promotion_code`, `create_promotion_code`, `update_promotion_code`, `delete_promotion_code`
- **Env vars**: `MCP_API_KEY`, `TOLT_API_KEY`, `PORT`
- **Railway**: Root dir = `tolt/`

## Adding a New MCP Server
1. Create `<name>/` folder with: `src/`, `Dockerfile`, `railway.json`, `package.json`, `tsconfig.json`
2. Use Express + `@modelcontextprotocol/sdk` StreamableHTTPServerTransport (stateless)
3. Always expose `GET /health` and `POST /mcp`
4. Add auth via `MCP_API_KEY` env var
5. Update this AGENTS.md with server details
