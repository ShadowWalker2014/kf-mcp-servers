---
name: build-http-mcp
description: Build HTTP MCP servers using Express + @modelcontextprotocol/sdk Streamable HTTP transport. Covers tools, prompts, resources, auth, and OAuth patterns. Use when asked to build a new MCP server, add capabilities to an existing one, or wrap any API as MCP tools/resources/prompts.
---

# Build HTTP MCP Servers

HTTP MCP servers wrap any API into AI-usable tools, prompts, and resources over HTTP. Architecture: **Express → auth middleware → fresh `McpServer` per request → `StreamableHTTPServerTransport`**.

## File structure

```
my-server/
├── src/
│   ├── index.ts   # Express app + MCP server factory
│   └── api.ts     # Pure API client functions (no MCP imports)
├── package.json
├── tsconfig.json
└── .gitignore
```

`api.ts` = pure functions that call the upstream API — no Express, no MCP. `index.ts` wires them together.

## `src/index.ts`

```typescript
import express, { NextFunction, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const MCP_API_KEY = process.env.MCP_API_KEY;
const PORT = parseInt(process.env.PORT || '3000');

function createMcpServer(credential: string): McpServer {
  const server = new McpServer({ name: 'my-server', version: '1.0.0' });

  server.tool(
    'tool_name',
    'What this tool does and when to use it.',
    { param: z.string().describe('What this parameter is') },
    async ({ param }) => ({
      content: [{ type: 'text', text: JSON.stringify(await callApi(credential, param), null, 2) }],
    })
  );

  return server;
}

function authenticate(req: Request, res: Response, next: NextFunction) {
  if (!MCP_API_KEY) return next();
  const key = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : (req.headers['x-api-key'] as string | undefined);
  if (!key) { res.status(401).json({ error: 'Missing API key' }); return; }
  if (key !== MCP_API_KEY) { res.status(403).json({ error: 'Invalid API key' }); return; }
  next();
}

function resolveCredential(req: Request): string | null {
  return (req.headers['x-my-credential'] as string | undefined) ?? process.env.MY_CREDENTIAL ?? null;
}

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', server: 'my-server', version: '1.0.0' }));

// Stateless: fresh McpServer + transport per request
app.post('/mcp', authenticate, async (req: Request, res: Response) => {
  const credential = resolveCredential(req);
  if (!credential) { res.status(400).json({ error: 'No credential provided.' }); return; }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });

  res.on('close', () => transport.close());
  const server = createMcpServer(credential);
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', authenticate, (_req, res) => res.status(405).json({ error: 'Use POST /mcp' }));
app.delete('/mcp', authenticate, (_req, res) => res.status(405).json({ error: 'Stateless mode' }));

app.listen(PORT, () => console.log(`my-server running on http://0.0.0.0:${PORT}`));
```

## Config files

**`package.json`**
```json
{
  "name": "my-server",
  "version": "1.0.0",
  "type": "module",
  "scripts": { "build": "tsc", "dev": "tsx watch src/index.ts", "start": "node dist/index.js" },
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

**`tsconfig.json`**
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

**`.gitignore`**
```
node_modules/
dist/
*.log
.env
.env.*
.DS_Store
```

## Key design rules

- **Stateless** — `sessionIdGenerator: undefined` + `enableJsonResponse: true`. Never store session state; create a fresh `McpServer` per request.
- **Credentials per request** — resolve from header first, fall back to env var. One deployed server can serve multiple accounts.
- **Express 5** — async errors propagate automatically; no try/catch in route handlers.
- **Bind to `0.0.0.0`** — required by most hosting platforms (implicit in `app.listen(PORT)`).
- **Never commit `dist/`** — hosting platforms skip compilation if compiled output is in git.
- **`MCP_API_KEY`** — always gate the server with this env var. Accept via `Authorization: Bearer` or `x-api-key` header.

## Tools

Each tool should:
- Have a clear action-oriented name (`query_database` not `db`)
- Have a description that explains *when* to use it, not just what it does
- Use Zod for every input field with `.describe()` on each
- Return `{ content: [{ type: 'text', text: ... }] }` — stringify objects with `JSON.stringify(result, null, 2)`

Capabilities are **auto-advertised**: calling `server.tool()` automatically enables `{ tools: { listChanged: true } }` in the MCP handshake.

See [examples.md](examples.md) for complete working tool implementations.

## Prompts

Prompts are reusable message templates clients discover via `prompts/list` and invoke via `prompts/get`. Register with `server.registerPrompt()` — capability is auto-advertised.

See [prompts-resources.md](prompts-resources.md) for full API and patterns.

## Resources

Resources expose read-only data by URI (docs, schemas, config). Clients discover via `resources/list` and fetch via `resources/read`. Register with `server.registerResource()` or `ResourceTemplate` for parameterized URIs — capability is auto-advertised.

See [prompts-resources.md](prompts-resources.md) for full API and patterns.

## OAuth

When the upstream API uses OAuth (authorization code flow), add `/auth/start` and `/auth/callback` routes before `/mcp`. See [oauth.md](oauth.md) for the full pattern including token refresh caching.

## Connecting to Cursor

Add to `~/.cursor/mcp.json`:
```json
{
  "my-server": {
    "url": "https://your-server.example.com/mcp",
    "headers": {
      "Authorization": "Bearer <MCP_API_KEY>",
      "X-My-Credential": "<credential>"
    }
  }
}
```

## Build checklist

- [ ] Write `src/api.ts` — pure API client functions, no MCP/Express imports
- [ ] Write `src/index.ts` — Express + `createMcpServer()` with tools/prompts/resources
- [ ] `npm install && npm run build` — must compile clean with zero TypeScript errors
- [ ] `curl http://localhost:PORT/health` — confirm `{"status":"ok"}`
- [ ] Verify tools/prompts/resources appear in Cursor (reload MCP after adding to `mcp.json`)
