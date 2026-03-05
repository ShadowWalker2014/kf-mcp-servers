# railway

HTTP MCP server for Railway infrastructure management. Uses Railway's GraphQL API directly — no CLI required. Pass your Railway account token per request.

## Tools

| Tool | Description |
|------|-------------|
| `check_status` | Verify token, get account info + workspaces |
| `list_projects` | List all projects in a workspace |
| `list_services` | List services in a project |
| `list_environments` | List environments in a project |
| `list_deployments` | Recent deployments for a service |
| `get_logs` | Build or deploy logs for a deployment |
| `list_variables` | Env vars for a service/environment |
| `set_variable` | Upsert an environment variable |
| `redeploy` | Trigger redeploy of latest service deployment |
| `restart_deployment` | Restart a specific deployment by ID |
| `create_environment` | Create a new environment in a project |
| `generate_domain` | Generate a `*.up.railway.app` domain |

## Auth

| Header | Purpose |
|--------|---------|
| `Authorization: Bearer <key>` | MCP server auth (`MCP_API_KEY`) |
| `X-Railway-Token: <token>` | Railway account token |

The `X-Railway-Token` header takes priority over the `RAILWAY_TOKEN` env var. Each user/machine passes their own token — Railway permissions are scoped to that token.

**Get your token**: [railway.com/account/tokens](https://railway.com/account/tokens) → create an Account token for full access.

## Typical workflow

```
1. check_status           → see your workspaces + workspace IDs
2. list_projects          → get project IDs
3. list_services          → get service IDs
4. list_environments      → get environment IDs
5. list_deployments       → get deployment IDs
6. get_logs               → debug a deployment
7. list_variables         → inspect env vars
8. set_variable           → update an env var
9. redeploy               → trigger new deployment
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MCP_API_KEY` | No | Enables bearer auth. If unset, server is open. |
| `RAILWAY_TOKEN` | No | Default token if no `X-Railway-Token` header |
| `PORT` | No | Defaults to `3400` |

## Cursor config

```json
"railway": {
  "url": "https://railway-production-9f1b.up.railway.app/mcp",
  "headers": {
    "Authorization": "Bearer <MCP_API_KEY>",
    "X-Railway-Token": "<your-railway-account-token>"
  }
}
```

## Local dev

```bash
npm install
MCP_API_KEY=secret npm run dev
```

Then pass `X-Railway-Token` per request. Health check: `GET http://localhost:3400/health`

## Railway deployment

- **Root Directory**: `railway/`
- **Env vars**: `MCP_API_KEY` (required)
- Calls `https://backboard.railway.com/graphql/v2` — no outbound restrictions needed beyond HTTPS
