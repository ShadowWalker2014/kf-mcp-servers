import express, { NextFunction, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Pool } from 'pg';
import { z } from 'zod';
import { mountOAuth, lookupAccessToken, getBaseUrl } from './oauth.js';

const MCP_API_KEY = process.env.MCP_API_KEY;
const PORT = parseInt(process.env.PORT || '3200');
if (isNaN(PORT)) throw new Error(`Invalid PORT env var: "${process.env.PORT}"`);

// Pool cache — reuse connections per DB URL, evict LRU when above limit
const MAX_POOLS = 20;
const pools = new Map<string, Pool>();

function getPool(databaseUrl: string): Pool {
  if (pools.has(databaseUrl)) return pools.get(databaseUrl)!;

  // Evict oldest entry if at cap
  if (pools.size >= MAX_POOLS) {
    const oldest = pools.keys().next().value!;
    pools.get(oldest)?.end().catch(() => {});
    pools.delete(oldest);
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  pools.set(databaseUrl, pool);
  return pool;
}

// ─── Schema helpers ───────────────────────────────────────────────────────────

async function getTableNames(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`
  );
  return rows.map((r) => r.table_name);
}

async function getTableSchema(pool: Pool, tableName: string): Promise<string> {
  // tableName comes from information_schema (trusted), inline it to avoid
  // parameterized query issues with PgBouncer in transaction-pooling mode.
  // Sanitize by keeping only alphanumeric + underscore characters.
  const safe = tableName.replace(/[^a-zA-Z0-9_]/g, '');
  if (!safe) return `Table name "${tableName}" contains no valid characters after sanitization.`;

  const { rows } = await pool.query<{
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = '${safe}'
     ORDER BY ordinal_position`
  );

  if (rows.length === 0) return `Table "${tableName}" not found or has no columns.`;

  const cols = rows
    .map((r) => {
      const nullable = r.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
      const def = r.column_default ? ` DEFAULT ${r.column_default}` : '';
      return `  ${r.column_name} ${r.data_type} ${nullable}${def}`;
    })
    .join(',\n');

  return `CREATE TABLE ${tableName} (\n${cols}\n);`;
}

// ─── MCP server factory ────────────────────────────────────────────────────────

async function createMcpServer(pool: Pool, databaseUrl: string): Promise<McpServer> {
  const server = new McpServer({ name: 'postgres', version: '1.1.0' });

  server.tool(
    'query',
    'Run a read-only SQL query against the PostgreSQL database.',
    { sql: z.string().describe('The SQL query to execute (SELECT only)') },
    async ({ sql }) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN READ ONLY');
        const result = await client.query(sql);
        await client.query('ROLLBACK');
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ rows: result.rows, rowCount: result.rowCount }, null, 2),
          }],
        };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Query error: ${msg}` }], isError: true };
      } finally {
        client.release();
      }
    }
  );

  const tables = await getTableNames(pool);
  const host = new URL(databaseUrl).hostname;

  for (const table of tables) {
    const uri = `postgres://${host}/${table}/schema`;
    server.resource(table, uri, async () => {
      const schema = await getTableSchema(pool, table);
      return { contents: [{ uri, mimeType: 'text/plain', text: schema }] };
    });
  }

  return server;
}

// ─── Auth + DB URL resolution ─────────────────────────────────────────────────
//
// Three ways in, tried in order — see .cursor/skills/add-mcp-oauth/SKILL.md:
//   1. OAuth access token (Authorization: Bearer <sealed-token>) — the token
//      itself encodes the database URL, bound at /authorize. This is the path
//      Claude Code / claude.ai connectors use; it's what makes DCR+PKCE work.
//   2. Legacy static key: Authorization/x-api-key === MCP_API_KEY, DB URL from
//      X-Database-URL header or DATABASE_URL env. Kept for existing non-OAuth
//      clients (e.g. a repo-committed .mcp.json using a static bearer token).
//   3. Open mode: no MCP_API_KEY configured at all. DB URL from header or env.

function challenge401(req: Request, res: Response, description: string) {
  const base = getBaseUrl(req);
  res.set(
    'WWW-Authenticate',
    `Bearer realm="postgres-mcp", error="invalid_token", error_description="${description}", resource_metadata="${base}/.well-known/oauth-protected-resource"`
  );
  res.status(401).json({ error: 'unauthorized', error_description: description });
}

function authenticateAndResolveDatabaseUrl(req: Request, res: Response): string | null {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7).trim()
    : undefined;

  // 1. OAuth-issued token?
  if (bearer) {
    const databaseUrl = lookupAccessToken(bearer);
    if (databaseUrl) return databaseUrl;
  }

  // 2. Legacy static MCP_API_KEY + X-Database-URL header / DATABASE_URL env
  if (MCP_API_KEY) {
    const key = bearer ?? (req.headers['x-api-key'] as string | undefined);
    if (!key) { challenge401(req, res, 'missing credentials'); return null; }
    if (key !== MCP_API_KEY) { challenge401(req, res, 'invalid token'); return null; }
    const databaseUrl = (req.headers['x-database-url'] as string | undefined) ?? process.env.DATABASE_URL;
    if (!databaseUrl) { res.status(400).json({ error: 'No database URL. Set DATABASE_URL env or pass X-Database-URL header.' }); return null; }
    return databaseUrl;
  }

  // 3. Explicit opt-in open mode for local dev ONLY. With OAuth mounted, the
  // old "no MCP_API_KEY == fully open" default is no longer safe — a server
  // meant to require OAuth should never silently accept unauthenticated
  // requests just because a legacy env var happens to be unset. Requires
  // deliberately setting MCP_ALLOW_OPEN=1, never the default.
  if (process.env.MCP_ALLOW_OPEN === '1') {
    const databaseUrl = (req.headers['x-database-url'] as string | undefined) ?? process.env.DATABASE_URL;
    if (databaseUrl) return databaseUrl;
  }

  challenge401(req, res, 'no credentials - authenticate via OAuth');
  return null;
}

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.set('trust proxy', true); // Railway/any reverse proxy sets x-forwarded-* — required for correct base URLs and PKCE redirect matching
app.use(express.json());

// OAuth endpoints (must be mounted before /mcp so 401 challenges point clients here).
mountOAuth(app);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    server: 'postgres',
    version: '1.1.0',
    auth: MCP_API_KEY ? 'enabled (legacy static key)' : 'disabled (legacy path open)',
    oauth: 'enabled',
    mode: process.env.DATABASE_URL ? 'single-db (env)' : 'multi-db (x-database-url header)',
    pools: pools.size,
  });
});

app.post('/mcp', async (req: Request, res: Response, next: NextFunction) => {
  const databaseUrl = authenticateAndResolveDatabaseUrl(req, res);
  if (!databaseUrl) return; // response already sent

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on('close', () => transport.close());

  try {
    const pool = getPool(databaseUrl);
    const server = await createMcpServer(pool, databaseUrl);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    next(err);
  }
});

app.get('/mcp', (req, res) => {
  // MCP clients often probe GET first; return 401 so they discover OAuth metadata.
  if (!authenticateAndResolveDatabaseUrl(req, res)) return;
  res.status(405).json({ error: 'Use POST /mcp' });
});

app.delete('/mcp', (req, res) => {
  if (!authenticateAndResolveDatabaseUrl(req, res)) return;
  res.status(405).json({ error: 'Stateless mode — no sessions' });
});

app.listen(PORT, () => {
  console.log(`postgres-mcp running on http://0.0.0.0:${PORT}`);
  console.log(`  Auth: OAuth enabled${MCP_API_KEY ? ' + legacy static key' : ''}`);
  console.log(`  DB mode: ${process.env.DATABASE_URL ? 'single-db (env)' : 'multi-db (X-Database-URL header)'}`);
});
