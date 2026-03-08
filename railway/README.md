# railway

HTTP MCP server for Railway infrastructure management. Full feature parity with the Railway CLI. Uses Railway's GraphQL API directly — no CLI required.

## Requirements

**Account-scoped token required.** Create one at [railway.com/account/tokens](https://railway.com/account/tokens) → New Token → select **"No workspace"**.

> Workspace tokens cannot call `list_workspaces` (the `me` query is restricted). Use account tokens for full autonomous operation.

## Tools (60 total)

### Account / Workspaces
| Tool | Description |
|------|-------------|
| `list_workspaces` | **Start here.** Returns your account info + all workspace IDs |

### Projects
| Tool | Description |
|------|-------------|
| `list_projects` | List all projects in a workspace |
| `get_project` | Get details of a single project |
| `create_project` | Create a new project |
| `update_project` | Update project name or description |
| `delete_project` | Permanently delete a project |
| `list_project_members` | List all project members |
| `invite_project_member` | Invite a user by email |
| `remove_project_member` | Remove a member from a project |
| `update_project_member_role` | Change a member's role |
| `create_project_token` | Create a project-scoped API token |
| `delete_project_token` | Delete a project API token |
| `create_project_invitation` | Create an invitation link |
| `delete_project_invitation` | Delete a pending invitation |

### Services
| Tool | Description |
|------|-------------|
| `list_services` | List services in a project |
| `get_service` | Get details of a single service |
| `create_service` | Create a service (empty, GitHub repo, or Docker image) |
| `update_service` | Update service name or icon |
| `delete_service` | Delete a service |
| `connect_service` | Connect service to a GitHub repository |
| `disconnect_service` | Disconnect service from its repo |
| `duplicate_service` | Duplicate a service within an environment |
| `get_service_instance` | Get service config for an environment (build/start commands, region, etc) |
| `update_service_instance` | Update build/deploy settings (commands, region, replicas, healthcheck, cron, etc) |
| `deploy_service` | Trigger a new deployment |

### Environments
| Tool | Description |
|------|-------------|
| `list_environments` | List environments in a project |
| `create_environment` | Create a new environment |
| `delete_environment` | Delete an environment |
| `rename_environment` | Rename an environment |
| `trigger_environment_deploys` | Trigger deploys for all services in an environment |

### Deployments
| Tool | Description |
|------|-------------|
| `list_deployments` | List recent deployments for a service |
| `get_deployment` | Get details of a single deployment |
| `get_logs` | Build or deploy logs for a deployment |
| `get_environment_logs` | All runtime logs for an entire environment |
| `get_http_logs` | HTTP access logs (requests, status codes, latency) |
| `redeploy` | Redeploy the latest service deployment |
| `restart_deployment` | Restart a deployment without rebuilding |
| `cancel_deployment` | Cancel a building/queued deployment |
| `stop_deployment` | Stop a running deployment |
| `rollback_deployment` | Rollback to a previous deployment |
| `remove_deployment` | Remove a deployment from history |
| `approve_deployment` | Approve a waiting deployment |
| `list_deployment_triggers` | List auto-deploy rules |
| `create_deployment_trigger` | Create auto-deploy on git push |
| `delete_deployment_trigger` | Delete a deployment trigger |
| `update_deployment_trigger` | Update a deployment trigger |

### Variables
| Tool | Description |
|------|-------------|
| `list_variables` | List env vars for a service |
| `set_variable` | Set (upsert) a single env var |
| `set_variables_bulk` | Set multiple env vars at once |
| `delete_variable` | Delete an env var |

### Domains
| Tool | Description |
|------|-------------|
| `list_domains` | List all domains (Railway + custom) for a service |
| `generate_domain` | Generate a `*.railway.app` domain |
| `delete_service_domain` | Delete a Railway-provided domain |
| `add_custom_domain` | Add a custom domain |
| `delete_custom_domain` | Delete a custom domain |
| `update_custom_domain` | Update custom domain target port |
| `check_domain_available` | Check if a domain is available |
| `get_domain_status` | Get DNS and certificate status |

### TCP Proxies
| Tool | Description |
|------|-------------|
| `list_tcp_proxies` | List TCP proxies for a service |
| `create_tcp_proxy` | Expose a non-HTTP port via TCP proxy |
| `delete_tcp_proxy` | Delete a TCP proxy |

### Volumes
| Tool | Description |
|------|-------------|
| `create_volume` | Create a persistent volume |
| `delete_volume` | Delete a volume (irreversible) |
| `update_volume` | Rename a volume |
| `update_volume_mount` | Update a volume's mount path |
| `list_volume_backups` | List volume backups |

### Plugins (Legacy Databases)
| Tool | Description |
|------|-------------|
| `create_plugin` | Create a database plugin (postgresql, redis, mysql, mongodb) |
| `delete_plugin` | Delete a plugin |
| `restart_plugin` | Restart a plugin |

### GitHub
| Tool | Description |
|------|-------------|
| `list_github_repos` | List accessible GitHub repositories |
| `list_github_branches` | List branches for a repo |

### Regions
| Tool | Description |
|------|-------------|
| `list_regions` | List available deployment regions |

### Webhooks
| Tool | Description |
|------|-------------|
| `list_webhooks` | List project webhooks |
| `create_webhook` | Create a webhook |
| `delete_webhook` | Delete a webhook |

### Private Networks
| Tool | Description |
|------|-------------|
| `list_private_networks` | List private networks in an environment |
| `create_private_network` | Create a private network |
| `create_private_network_endpoint` | Add a service to a private network |
| `delete_private_network_endpoint` | Remove a service from a private network |

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
