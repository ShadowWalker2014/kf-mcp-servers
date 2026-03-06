# railway

HTTP MCP server for Railway infrastructure management. Uses Railway's GraphQL API directly — no CLI required.

## Requirements

**Account-scoped token required.** Create one at [railway.com/account/tokens](https://railway.com/account/tokens) → New Token → select **"No workspace"**.

> Workspace tokens cannot call `list_workspaces` (the `me` query is restricted). Use account tokens for full autonomous operation.

## Tools

| Tool | Description |
|------|-------------|
| `list_workspaces` | **Start here.** Returns your account info + all workspace IDs |
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

## End-to-end flow

```
list_workspaces
  → { name: "KF Production", workspaces: [{ id: "1a7943e1-...", name: "KF Production" }] }

list_projects(workspace_id: "1a7943e1-...")
  → [{ id: "proj_...", name: "Blink", services: [...], environments: [...] }]

list_services(project_id: "proj_...")
  → [{ id: "svc_...", name: "web" }]

list_environments(project_id: "proj_...")
  → [{ id: "env_...", name: "production" }]

list_deployments(project_id, environment_id, service_id)
  → [{ id: "dep_...", status: "SUCCESS" }]

get_logs(deployment_id, log_type: "deploy")
  → timestamped log lines

set_variable(project_id, environment_id, service_id, name, value)
  → sets env var

redeploy(environment_id, service_id)
  → triggers new deployment
```

## Auth

| Header | Purpose |
|--------|---------|
| `Authorization: Bearer <key>` | MCP server auth (`MCP_API_KEY`) |
| `X-Railway-Token: <token>` | Railway **account** token |

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MCP_API_KEY` | No | Enables bearer auth on the MCP server |
| `RAILWAY_TOKEN` | No | Default token if no `X-Railway-Token` header |
| `PORT` | No | Defaults to `3400` |

## Cursor config

```json
"railway": {
  "url": "https://railway-production-9f1b.up.railway.app/mcp",
  "headers": {
    "Authorization": "Bearer blnk_68f3c7384ce7f296ff1f3c4d88fcfbf4",
    "X-Railway-Token": "<account token from railway.com/account/tokens>"
  }
}
```

## Local dev

```bash
npm install
MCP_API_KEY=secret npm run dev
```

Health: `GET http://localhost:3400/health`

## Railway deployment

- **Root Directory**: `railway/`
- **Env vars**: `MCP_API_KEY`
