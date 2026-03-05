import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Pool } from 'pg';
import { z } from 'zod';

const MCP_API_KEY = process.env.MCP_API_KEY;
const PORT = parseInt(process.env.PORT || '3200');

// Pool cache — reuse connections across requests for the same DB URL
const pools = new Map<string, Pool>();

function getPool(databaseUrl: string): Pool {
  if (!pools.has(databaseUrl)) {
    pools.set(databaseUrl, new Pool({ connectionString: databaseUrl, max: 5 }));
  }
  return pools.get(databaseUrl)!;
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
  // parameterized query issues with PgBouncer in transaction-pooling mode
  const safe = tableName.replace(/[^a-zA-Z0-9_]/g, '');
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
  const server = new McpServer({ name: 'postgres', version: '1.0.0' });

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

function authenticate(req: Request, res: Response, next: () => void) {
  if (!MCP_API_KEY) return next();

  const authHeader = req.headers.authorization;
  const key = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : (req.headers['x-api-key'] as string | undefined);

  if (!key) return res.status(401).json({ error: 'Missing API key' });
  if (key !== MCP_API_KEY) return res.status(403).json({ error: 'Invalid API key' });

  next();
}

// Resolve DB URL: header takes priority, falls back to env var
function resolveDatabaseUrl(req: Request): string | null {
  return (req.headers['x-database-url'] as string | undefined)
    ?? process.env.DATABASE_URL
    ?? null;
}

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    server: 'postgres',
    version: '1.0.0',
    auth: MCP_API_KEY ? 'enabled' : 'disabled',
    mode: process.env.DATABASE_URL ? 'single-db (env)' : 'multi-db (x-database-url header)',
  });
});

app.post('/mcp', authenticate, async (req: Request, res: Response) => {
  const databaseUrl = resolveDatabaseUrl(req);

  if (!databaseUrl) {
    res.status(400).json({ error: 'No database URL. Set DATABASE_URL env or pass X-Database-URL header.' });
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on('close', () => transport.close());

  const pool = getPool(databaseUrl);
  const server = await createMcpServer(pool, databaseUrl);
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', (_req, res) => res.status(405).json({ error: 'Use POST /mcp' }));
app.delete('/mcp', (_req, res) => res.status(405).json({ error: 'Stateless mode — no sessions' }));

app.listen(PORT, () => {
  console.log(`postgres running on http://0.0.0.0:${PORT}`);
  console.log(`  Auth: ${MCP_API_KEY ? 'API key required' : 'OPEN (set MCP_API_KEY to secure)'}`);
  console.log(`  DB mode: ${process.env.DATABASE_URL ? 'single-db (env)' : 'multi-db (X-Database-URL header)'}`);
});
