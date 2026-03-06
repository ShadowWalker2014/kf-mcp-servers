---
name: build-http-mcp
description: Build and deploy HTTP MCP servers to the kf-mcp-servers monorepo on Railway. Each server uses Express + MCP Streamable HTTP transport, accepts credentials per-request via headers, and deploys as an independent Railway service from a subfolder. Use when asked to build a new MCP server, add tools to an existing MCP, or deploy an MCP to Railway.
---

# Build HTTP MCP Servers

All MCP servers live in `/Users/kaifeng/Developer/kf-mcp-servers/` — a monorepo where each subfolder is an independent Railway service.

## Monorepo structure

```
kf-mcp-servers/
├── AGENTS.md          ← central memory, update when adding servers
├── blink-cms/         ← Blink CMS + web tools (port 3100)
├── postgres/          ← PostgreSQL query tool (port 3200)
├── stripe/            ← Stripe billing (port 3300)
├── railway/           ← Railway infra management (port 3400)
├── datafast/          ← DataFast analytics (port 3500)
└── digits/            ← Digits financial data / OAuth (port 3600)
```

## Standard server template

Every server needs: `src/index.ts`, `src/api.ts`, `package.json`, `tsconfig.json`, `Dockerfile`, `railway.json`, `.gitignore`

### `src/index.ts` skeleton

```typescript
import express, { NextFunction, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const MCP_API_KEY = process.env.MCP_API_KEY;
const PORT = parseInt(process.env.PORT || '3XXX');
if (isNaN(PORT)) throw new Error(`Invalid PORT: "${process.env.PORT}"`);

function createMcpServer(credential: string): McpServer {
  const server = new McpServer({ name: 'my-mcp', version: '1.0.0' });

  server.tool('tool_name', 'Description of what the tool does.', 
    { param: z.string().describe('...') },
    async ({ param }) => ({
      content: [{ type: 'text', text: JSON.stringify(await callApi(credential, param), null, 2) }]
    })
  );

  return server;
}

// Auth: MCP_API_KEY gates access to the server itself
function authenticate(req: Request, res: Response, next: NextFunction) {
  if (!MCP_API_KEY) return next();
  const key = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : (req.headers['x-api-key'] as string | undefined);
  if (!key) { res.status(401).json({ error: 'Missing API key' }); return; }
  if (key !== MCP_API_KEY) { res.status(403).json({ error: 'Invalid API key' }); return; }
  next();
}

// Credential resolution: header takes priority over env var
function resolveCredential(req: Request): string | null {
  return (req.headers['x-my-credential'] as string | undefined)
    ?? process.env.MY_CREDENTIAL ?? null;
}

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', server: 'my-mcp', version: '1.0.0' }));

// Stateless: new McpServer + transport per request (no session management needed)
app.post('/mcp', authenticate, async (req: Request, res: Response) => {
  const credential = resolveCredential(req);
  if (!credential) { res.status(400).json({ error: 'No credential provided.' }); return; }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,   // stateless
    enableJsonResponse: true,
  });

  res.on('close', () => transport.close());
  const server = createMcpServer(credential);
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', authenticate, (_req, res) => res.status(405).json({ error: 'Use POST /mcp' }));
app.delete('/mcp', authenticate, (_req, res) => res.status(405).json({ error: 'Stateless mode' }));

app.listen(PORT, () => console.log(`my-mcp running on http://0.0.0.0:${PORT}`));
```

### `package.json`

```json
{
  "name": "my-mcp",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.25.1",
    "express": "^5.0.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2"
  },
  "engines": { "node": ">=22.0.0" }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "lib": ["ES2022"], "outDir": "./dist", "rootDir": "./src",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true, "declaration": true, "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### `Dockerfile` (two-stage: builder + prod-only runner)

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
ENV NODE_ENV=production
ENV PORT=3XXX
EXPOSE 3XXX
CMD ["node", "dist/index.js"]
```

### `railway.json`

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": { "builder": "DOCKERFILE", "dockerfilePath": "Dockerfile" },
  "deploy": { "healthcheckPath": "/health", "healthcheckTimeout": 30 }
}
```

### `.gitignore`

```
node_modules/
dist/
*.log
.env
.env.*
.DS_Store
```

## Key design rules

- **Stateless** — `sessionIdGenerator: undefined` + `enableJsonResponse: true`. No session maps.
- **Credentials per request** — header takes priority over env var. One deployed server handles multiple accounts (e.g., postgres server handles any DB via `X-Database-URL`).
- **Express 5** — async errors propagate automatically; no try/catch needed in route handlers.
- **`MCP_API_KEY`** — always gates the MCP server itself. Set to `blnk_68f3c7384ce7f296ff1f3c4d88fcfbf4`.
- **Bind to `0.0.0.0`** — Railway requires this (implicit in `app.listen(PORT)`).
- **`npm ci` not `npm install`** — deterministic builds; commit `package-lock.json`.

## Header naming convention

| Server | Credential header |
|--------|------------------|
| postgres | `X-Database-URL` |
| railway | `X-Railway-Token` |
| stripe | `X-Stripe-Api-Key` |
| datafast | `X-Datafast-Api-Key` |
| digits | `X-Digits-Refresh-Token` |

## OAuth servers (e.g. Digits)

When the API uses OAuth, add two extra Express routes before `/mcp`:

```typescript
// Redirect user to provider auth page
app.get('/auth/start', (_req, res) => {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', `${BASE_URL}/auth/callback`);
  url.searchParams.set('scope', 'required:scopes');
  res.redirect(url.toString());
});

// Exchange code for tokens, display refresh_token to user
app.get('/auth/callback', async (req, res) => {
  const tokens = await exchangeCode(CLIENT_ID, CLIENT_SECRET, req.query.code, REDIRECT_URI);
  res.send(`<pre>Refresh token: ${tokens.refresh_token}</pre>`);
});
```

Store `CLIENT_ID`, `CLIENT_SECRET` as Railway env vars. `BASE_URL` = the Railway public domain.
Token auto-refresh: cache access tokens by refresh_token key, re-fetch when within 60s of expiry.

## Deploy to Railway (via GraphQL API)

```bash
RAILWAY_TOKEN=$(cat ~/.railway/config.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['user']['token'])")
PROJECT_ID="270a435c-b967-4ee2-abdd-de75ad0fba1a"   # kf-mcp-servers project
ENV_ID="3f075578-f96b-4400-8936-baf77e21745d"         # production environment

gql() { curl -s -X POST https://backboard.railway.com/graphql/v2 \
  -H "Authorization: Bearer $RAILWAY_TOKEN" -H "Content-Type: application/json" -d "$1"; }

# 1. Create service connected to GitHub repo
SVC_ID=$(gql '{"query":"mutation { serviceCreate(input: { projectId: \"'$PROJECT_ID'\", name: \"my-mcp\", source: { repo: \"ShadowWalker2014/kf-mcp-servers\" } }) { id } }"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['serviceCreate']['id'])")

# 2. Set root directory to subfolder
gql '{"query":"mutation { serviceInstanceUpdate(input: { rootDirectory: \"my-mcp\" }, environmentId: \"'$ENV_ID'\", serviceId: \"'$SVC_ID'\") }"}' > /dev/null

# 3. Generate public domain
DOMAIN=$(gql '{"query":"mutation { serviceDomainCreate(input: { environmentId: \"'$ENV_ID'\", serviceId: \"'$SVC_ID'\" }) { domain } }"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['serviceDomainCreate']['domain'])")

# 4. Set env vars (use upsert helper for each var)
upsert_var() {
  NAME="$1"; VALUE="$2"
  BODY=$(python3 -c "import json; print(json.dumps({'query': 'mutation { variableUpsert(input: { projectId: \"'$PROJECT_ID'\", environmentId: \"'$ENV_ID'\", serviceId: \"'$SVC_ID'\", name: \"%s\", value: %s }) }' % ('$NAME', json.dumps('$VALUE'))}))")
  curl -s -X POST https://backboard.railway.com/graphql/v2 \
    -H "Authorization: Bearer $RAILWAY_TOKEN" -H "Content-Type: application/json" -d "$BODY" > /dev/null
}
upsert_var "MCP_API_KEY" "blnk_68f3c7384ce7f296ff1f3c4d88fcfbf4"
upsert_var "PORT" "3XXX"

# 5. Trigger deploy
gql '{"query":"mutation { serviceInstanceRedeploy(environmentId: \"'$ENV_ID'\", serviceId: \"'$SVC_ID'\") }"}' > /dev/null

echo "Deployed to: https://$DOMAIN"
```

## Verify and connect

```bash
# Check health
curl https://my-mcp.up.railway.app/health

# Add to ~/.cursor/mcp.json
{
  "my-mcp": {
    "url": "https://my-mcp.up.railway.app/mcp",
    "headers": {
      "Authorization": "Bearer blnk_68f3c7384ce7f296ff1f3c4d88fcfbf4",
      "X-My-Credential": "<credential>"
    }
  }
}
```

## Checklist for new server

- [ ] `mkdir -p kf-mcp-servers/my-mcp/src`
- [ ] Write `src/api.ts` (pure API client functions)
- [ ] Write `src/index.ts` (Express + MCP tools)
- [ ] Write `package.json`, `tsconfig.json`, `Dockerfile`, `railway.json`, `.gitignore`
- [ ] `npm install && npm run build` — must be clean
- [ ] `git add -f my-mcp/` (lockfile needs force-add first time)
- [ ] `git commit && git push`
- [ ] Deploy via Railway GraphQL API (see above)
- [ ] `curl https://domain/health` — confirm ok
- [ ] Update `kf-mcp-servers/AGENTS.md` with server details
- [ ] Add to `~/.cursor/mcp.json`
