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
Each server deploys as its own Railway service. **Use nixpacks (no Dockerfile)** — simpler, faster, no caching hell.

**Critical steps when creating a new service via API:**
1. `create_service` → `connect_service` (repo + branch=main)
2. `update_service_instance` → set `root_directory`, `build_command: "npm run build"`, `start_command: "node dist/index.js"`, `watch_patterns: ["<name>/**"]`, `healthcheck_path: "/health"`
3. `set_variables_bulk` → `MCP_API_KEY`, `PORT`, any credential env vars
4. `create_deployment_trigger` → provider=GITHUB, repo, branch=main ← **CRITICAL: without this, pushes don't auto-deploy**
5. `generate_domain` → get public URL
6. `git push` → Railway auto-builds via the trigger

**Railway deployment lessons learned:**
- `serviceInstanceRedeploy` / `serviceInstanceDeploy` = restart existing image, NOT a fresh build — pushing a commit is the only way to trigger a real rebuild
- `create_deployment_trigger` must be called explicitly — it is NOT created automatically when you connect a repo via API (only via dashboard)
- **Never commit `dist/`** — if compiled output is in git, nixpacks skips compilation and runs stale code. Use `git rm -r --cached <name>/dist/` if accidentally committed
- **Never use Dockerfile** — Railway's nixpacks auto-detects Node.js, runs `npm run build`, starts with `node dist/index.js`. Dockerfiles cause layer-cache issues that are hard to debug
- `dockerfilePath: ""` (empty string) clears the Dockerfile setting via GraphQL API if it gets stuck

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
- **Railway service ID**: `e130c38c-091d-4cd5-acdf-052ec33cf631`
- **Railway**: Root dir = `tolt/`, nixpacks, branch=main, watch_patterns=`tolt/**`

## Adding a New MCP Server

**Build**: Follow `.cursor/skills/build-http-mcp/SKILL.md` for the full template (Express + StreamableHTTP, tools/prompts/resources, OAuth).

**railway.json** (required per-server, no Dockerfile):
```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": { "builder": "NIXPACKS" },
  "deploy": { "healthcheckPath": "/health", "healthcheckTimeout": 30, "startCommand": "node dist/index.js" }
}
```

**Credential header convention** (header → env var fallback):

| Server | Header | Env var |
|--------|--------|---------|
| postgres | `X-Database-URL` | `DATABASE_URL` |
| railway | `X-Railway-Token` | `RAILWAY_TOKEN` |
| stripe | `X-Stripe-Api-Key` | `STRIPE_SECRET_KEY` |
| datafast | `X-Datafast-Api-Key` | `DATAFAST_API_KEY` |
| tolt | `X-Tolt-Api-Key` | `TOLT_API_KEY` |

**Deploy checklist** (Railway MCP — PROJECT_ID=`270a435c-b967-4ee2-abdd-de75ad0fba1a`, ENV_ID=`3f075578-f96b-4400-8936-baf77e21745d`):
1. `npm install && npm run build` — clean compile
2. `git add <name>/` (never `git add -f`, never commit `dist/`) → `git commit && git push`
3. `create_service` → `connect_service` (repo=`ShadowWalker2014/kf-mcp-servers`, branch=main)
4. `update_service_instance` → `root_directory="<name>"`, `build_command="npm run build"`, `start_command="node dist/index.js"`, `healthcheck_path="/health"`, `watch_patterns=["<name>/**"]`
5. `set_variables_bulk` → `MCP_API_KEY`, `PORT`, credential env vars
6. `create_deployment_trigger` → provider=GITHUB, repo, branch=main ← **CRITICAL: without this, pushes never build**
7. `generate_domain` → get public URL
8. `git push` → Railway builds automatically
9. `curl https://domain/health` → confirm `{"status":"ok"}`
10. Update this AGENTS.md with server details + Railway service ID
11. Add to `~/.cursor/mcp.json`
