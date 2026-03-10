# Examples

## 1. Minimal tool server (GitHub Stars lookup)

A complete, runnable example wrapping a public API.

**`src/api.ts`**
```typescript
export interface Repo {
  full_name: string;
  stargazers_count: number;
  description: string | null;
  html_url: string;
}

export async function getRepo(token: string, owner: string, repo: string): Promise<Repo> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'mcp-github' },
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function searchRepos(token: string, query: string): Promise<Repo[]> {
  const res = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=10`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'mcp-github' },
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.items;
}
```

**`src/index.ts`** (just the `createMcpServer` function — rest follows the standard skeleton)
```typescript
import { getRepo, searchRepos } from './api.js';

function createMcpServer(token: string): McpServer {
  const server = new McpServer({ name: 'github-mcp', version: '1.0.0' });

  server.tool(
    'get_repo',
    'Get details and star count for a specific GitHub repository.',
    {
      owner: z.string().describe('Repository owner (user or org)'),
      repo: z.string().describe('Repository name'),
    },
    async ({ owner, repo }) => ({
      content: [{ type: 'text', text: JSON.stringify(await getRepo(token, owner, repo), null, 2) }],
    })
  );

  server.tool(
    'search_repos',
    'Search GitHub repositories by keyword. Returns top 10 results with star counts.',
    { query: z.string().describe('Search query, e.g. "react state management"') },
    async ({ query }) => ({
      content: [{ type: 'text', text: JSON.stringify(await searchRepos(token, query), null, 2) }],
    })
  );

  return server;
}
```

Credential header: `X-Github-Token`. Env fallback: `GITHUB_TOKEN`.

---

## 2. Resource serving table schemas (like the postgres server)

Exposes every table's DDL as a discoverable resource.

```typescript
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

function createMcpServer(dbUrl: string): McpServer {
  const server = new McpServer({ name: 'postgres-mcp', version: '1.0.0' });

  // Tool: execute read-only SQL
  server.tool(
    'query',
    'Run a read-only SQL query against the database.',
    { sql: z.string().describe('A SELECT statement') },
    async ({ sql }) => {
      const result = await runReadOnlyQuery(dbUrl, sql);
      return { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] };
    }
  );

  // Resource: list all tables + fetch individual schema
  server.registerResource(
    'table-schema',
    new ResourceTemplate('postgres://{host}/{table}/schema', {
      list: async () => {
        const tables = await listTables(dbUrl);
        const url = new URL(dbUrl);
        return {
          resources: tables.map(t => ({
            uri: `postgres://${url.host}/${t}/schema`,
            name: `${t} schema`,
            mimeType: 'text/plain',
          })),
        };
      },
    }),
    { title: 'Table Schema', description: 'DDL for a database table', mimeType: 'text/plain' },
    async (uri, { table }) => {
      const ddl = await getTableDDL(dbUrl, table as string);
      return { contents: [{ uri: uri.href, text: ddl }] };
    }
  );

  return server;
}
```

---

## 3. Prompt with embedded resource content

A prompt that fetches a doc resource and passes it to the LLM as context.

```typescript
server.registerResource(
  'api-docs',
  'docs://api',
  { title: 'API Documentation', mimeType: 'text/markdown' },
  async (uri) => ({ contents: [{ uri: uri.href, text: await readFile('./docs/api.md', 'utf8') }] })
);

server.registerPrompt(
  'answer-from-docs',
  {
    title: 'Answer from API Docs',
    description: 'Answer a question using the API documentation as context',
    argsSchema: { question: z.string().describe('The question to answer') },
  },
  ({ question }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'resource',
          resource: { uri: 'docs://api', mimeType: 'text/markdown', text: '' },
        },
      },
      {
        role: 'user',
        content: { type: 'text', text: `Using the documentation above, answer: ${question}` },
      },
    ],
  })
);
```

---

## 4. Multi-tool server with optional credential

Pattern for when the credential has a fallback default (e.g., public API with rate limits).

```typescript
function resolveCredential(req: Request): string {
  return (
    (req.headers['x-api-key'] as string | undefined) ??
    process.env.DEFAULT_API_KEY ??
    'anonymous'  // public tier
  );
}
```

Note: change the route handler signature — don't return a 400 when credential is absent if you have a valid anonymous tier.

---

## 5. Cursor `mcp.json` snippet

```json
{
  "github-mcp": {
    "url": "https://github-mcp.example.com/mcp",
    "headers": {
      "Authorization": "Bearer your-mcp-api-key",
      "X-Github-Token": "ghp_yourPersonalAccessToken"
    }
  }
}
```
