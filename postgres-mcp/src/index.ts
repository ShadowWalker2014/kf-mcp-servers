import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Pool } from 'pg';
import { z } from 'zod';

const DATABASE_URL = process.env.DATABASE_URL;
const MCP_API_KEY = process.env.MCP_API_KEY;
const PORT = parseInt(process.env.PORT || '3200');

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

// ─── Schema helpers (mirrors @modelcontextprotocol/server-postgres behavior) ───

async function getTableNames(): Promise<string[]> {
  const { rows } = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`
  );
  return rows.map((r) => r.table_name);
}

async function getTableSchema(tableName: string): Promise<string> {
  const { rows } = await pool.query<{
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName]
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

async function createMcpServer(): Promise<McpServer> {
  const server = new McpServer({ name: 'postgres-mcp', version: '1.0.0' });

  // Tool: query (same as official server — read-only enforced via BEGIN/ROLLBACK)
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

  // Resources: one per table, exposing its schema (mirrors the official server)
  const tables = await getTableNames();

  const url = new URL(DATABASE_URL!);
  const host = url.hostname;

  for (const table of tables) {
    const uri = `postgres://${host}/${table}/schema`;
    server.resource(table, uri, async () => {
      const schema = await getTableSchema(table);
      return { contents: [{ uri, mimeType: 'text/plain', text: schema }] };
    });
  }

  return server;
}

// ─── Auth middleware ───────────────────────────────────────────────────────────

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

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

app.get('/health', async (_req, res) => {
  const tables = await getTableNames().catch(() => []);
  res.json({
    status: 'ok',
    server: 'postgres-mcp',
    version: '1.0.0',
    tables: tables.length,
    auth: MCP_API_KEY ? 'enabled' : 'disabled',
  });
});

app.post('/mcp', authenticate, async (req: Request, res: Response) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on('close', () => transport.close());

  const server = await createMcpServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', (_req, res) => res.status(405).json({ error: 'Use POST /mcp' }));
app.delete('/mcp', (_req, res) => res.status(405).json({ error: 'Stateless mode — no sessions' }));

app.listen(PORT, () => {
  console.log(`postgres-mcp running on http://0.0.0.0:${PORT}`);
  console.log(`  POST /mcp  — MCP endpoint`);
  console.log(`  GET  /health`);
  console.log(`  Auth: ${MCP_API_KEY ? 'API key required' : 'OPEN (set MCP_API_KEY to secure)'}`);
});
