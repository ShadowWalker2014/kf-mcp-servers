import express, { NextFunction, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { getAccessToken, exchangeCode } from './auth.js';
import {
  getCompany, getCategories, getParties, getSources,
  getProfitAndLoss, getBalanceSheet, getCashFlow,
  listEntries, queryEntries, getTransaction,
} from './api.js';

const CLIENT_ID = process.env.DIGITS_CLIENT_ID!;
const CLIENT_SECRET = process.env.DIGITS_CLIENT_SECRET!;
const MCP_API_KEY = process.env.MCP_API_KEY;
const PORT = parseInt(process.env.PORT || '3600');
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  throw new Error('DIGITS_CLIENT_ID and DIGITS_CLIENT_SECRET are required');
}

const REDIRECT_URI = `${BASE_URL}/auth/callback`;
const AUTHORIZE_URL = 'https://connect.digits.com/v1/oauth/authorize';

// ─── Resolve refresh token per-request ────────────────────────────────────────

function resolveRefreshToken(req: Request): string | null {
  return (req.headers['x-digits-refresh-token'] as string | undefined)
    ?? process.env.DIGITS_REFRESH_TOKEN
    ?? null;
}

// ─── MCP server factory ────────────────────────────────────────────────────────

function createMcpServer(accessToken: string): McpServer {
  const server = new McpServer({ name: 'digits-mcp', version: '1.0.0' });

  function ok(data: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  }

  const dateParams = {
    start_date: z.string().optional().describe("Start date (YYYY-MM-DD, inclusive)"),
    end_date: z.string().optional().describe("End date (YYYY-MM-DD, inclusive)"),
    interval: z.enum(['Month', 'Quarter', 'Year']).optional().describe("Grouping interval (default: full period)"),
  };

  // ── Company ────────────────────────────────────────────────────────────────

  server.tool('get_company',
    'Get company info: name, fiscal year start month, earliest transaction date. Call this first.',
    {},
    async () => ok(await getCompany(accessToken))
  );

  // ── Chart of Accounts ──────────────────────────────────────────────────────

  server.tool('get_categories',
    'Get the full Chart of Accounts from the ledger. Returns category IDs, names, parent hierarchy, and types (Assets, Liabilities, Equity, Income, Expenses, COGS, etc.). Use category IDs to filter transactions.',
    {},
    async () => ok(await getCategories(accessToken))
  );

  // ── Vendors / Customers ────────────────────────────────────────────────────

  server.tool('get_parties',
    'Get all parties (vendors, customers, contractors) from the ledger. Returns party IDs and names — e.g. "Google Cloud Platform", "Amazon Web Services", "Stripe". Use party IDs to filter transactions to specific vendors.',
    {},
    async () => ok(await getParties(accessToken))
  );

  // ── Bank Feeds / Sources ──────────────────────────────────────────────────

  server.tool('get_sources',
    'Get all connection sources (bank accounts, credit cards) linked to Digits.',
    {},
    async () => ok(await getSources(accessToken))
  );

  // ── Financial Statements ───────────────────────────────────────────────────

  server.tool('get_profit_and_loss',
    'Generate a Profit & Loss (Income Statement) for any date range. Returns hierarchical rows: Income → Gross Profit → Operating Expenses → Net Operating Income → Net Income. Supports monthly/quarterly/annual breakdown.',
    { ...dateParams, fiscal_year_start_month: z.number().int().min(1).max(12).optional().describe("Fiscal year start month 1-12 (default: January)") },
    async ({ start_date, end_date, interval, fiscal_year_start_month }) =>
      ok(await getProfitAndLoss(accessToken, {
        startDate: start_date, endDate: end_date, interval,
        fiscalYearStartMonth: fiscal_year_start_month?.toString(),
      }))
  );

  server.tool('get_balance_sheet',
    'Generate a Balance Sheet for any date. Returns Assets, Liabilities, and Equity with hierarchical line items.',
    { ...dateParams, fiscal_year_start_month: z.number().int().min(1).max(12).optional() },
    async ({ start_date, end_date, interval, fiscal_year_start_month }) =>
      ok(await getBalanceSheet(accessToken, {
        startDate: start_date, endDate: end_date, interval,
        fiscalYearStartMonth: fiscal_year_start_month?.toString(),
      }))
  );

  server.tool('get_cash_flow',
    'Generate a Cash Flow Statement for any date range. Returns Operating, Investing, Financing activities and Net Cash increase/decrease.',
    { ...dateParams, fiscal_year_start_month: z.number().int().min(1).max(12).optional() },
    async ({ start_date, end_date, interval, fiscal_year_start_month }) =>
      ok(await getCashFlow(accessToken, {
        startDate: start_date, endDate: end_date, interval,
        fiscalYearStartMonth: fiscal_year_start_month?.toString(),
      }))
  );

  // ── Transactions ───────────────────────────────────────────────────────────

  server.tool('list_transactions',
    'List recent ledger entries (transactions). Returns entries with date, amount, category, party, and description. Paginate with cursor.',
    {
      limit: z.number().int().min(1).max(100).optional().describe("Number of entries (max 100, default 100)"),
      cursor: z.string().optional().describe("Pagination cursor from previous response"),
    },
    async ({ limit, cursor }) =>
      ok(await listEntries(accessToken, {
        limit: limit?.toString(),
        cursor,
      }))
  );

  server.tool('query_transactions',
    `Search and filter ledger entries. The most powerful reporting tool — filter by vendor (party), category, amount range, date range, or keyword. 

Examples:
- Infra costs: partyIds=["gcp-id","aws-id"] + type="Debit"  
- All expenses in Q1: categoryTypes=["Expenses"] + date range
- Search vendor: fieldSearchTerm={field:"PartyName", term:"Google Cloud"}
- Unpaid bills: linkedObjectType="Bill"`,
    {
      occurred_after: z.string().optional().describe("Filter entries after this ISO timestamp (e.g. '2026-01-01T00:00:00Z')"),
      occurred_before: z.string().optional().describe("Filter entries before this ISO timestamp (e.g. '2026-02-28T23:59:59Z')"),
      minimum_amount: z.number().optional().describe("Minimum amount in cents (e.g. 10000 = $100)"),
      maximum_amount: z.number().optional().describe("Maximum amount in cents"),
      filter_term: z.string().optional().describe("Full-text search across transaction fields"),
      search_field: z.enum(['Name', 'Description', 'ProductName', 'PartyName', 'InstitutionName', 'CategoryName', 'AmountTerm']).optional().describe("Specific field to search within (use with search_term)"),
      search_term: z.string().optional().describe("Term to search in search_field (e.g. 'Google Cloud' with field 'PartyName')"),
      party_ids: z.array(z.string()).optional().describe("Filter to specific party IDs (get IDs from get_parties)"),
      category_ids: z.array(z.string()).optional().describe("Filter to specific category IDs (get IDs from get_categories)"),
      category_types: z.array(z.enum(['Assets', 'Liabilities', 'Equity', 'Income', 'Expenses', 'CostOfGoodsSold', 'OtherIncome', 'OtherExpenses'])).optional().describe("Filter by broad category type"),
      department_ids: z.array(z.string()).optional().describe("Filter by department IDs"),
      transaction_type: z.enum(['Credit', 'Debit']).optional().describe("Debit=money out (expenses), Credit=money in (income)"),
      linked_object_type: z.enum(['Bill', 'Invoice']).optional().describe("Filter to entries linked to Bills or Invoices"),
      limit: z.number().int().min(1).max(100).optional().describe("Number of results (max 100)"),
      cursor: z.string().optional().describe("Pagination cursor from previous response"),
    },
    async ({ occurred_after, occurred_before, minimum_amount, maximum_amount, filter_term,
      search_field, search_term, party_ids, category_ids, category_types,
      department_ids, transaction_type, linked_object_type, limit, cursor }) =>
      ok(await queryEntries(accessToken, {
        occurredAfter: occurred_after,
        occurredBefore: occurred_before,
        minimumAmount: minimum_amount,
        maximumAmount: maximum_amount,
        filterTerm: filter_term,
        fieldSearchTerm: search_field && search_term ? { field: search_field, term: search_term } : undefined,
        partyIds: party_ids,
        categoryIds: category_ids,
        categoryTypes: category_types,
        departmentIds: department_ids,
        type: transaction_type,
        linkedObjectType: linked_object_type,
        limit,
        cursor,
      }))
  );

  server.tool('get_transaction',
    'Get full details of a single ledger transaction by its Digits transaction ID.',
    { transaction_id: z.string().describe("Digits transaction ID") },
    async ({ transaction_id }) => ok(await getTransaction(accessToken, transaction_id))
  );

  return server;
}

// ─── Auth middleware ───────────────────────────────────────────────────────────

function authenticate(req: Request, res: Response, next: NextFunction) {
  if (!MCP_API_KEY) return next();
  const key = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : (req.headers['x-api-key'] as string | undefined);
  if (!key) { res.status(401).json({ error: 'Missing MCP API key' }); return; }
  if (key !== MCP_API_KEY) { res.status(403).json({ error: 'Invalid MCP API key' }); return; }
  next();
}

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// OAuth: redirect user to Digits to authorize
app.get('/auth/start', (_req, res) => {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', 'ledger:read');
  url.searchParams.set('state', 'digits-mcp');
  res.redirect(url.toString());
});

// OAuth: receive code, exchange for tokens, display refresh_token
app.get('/auth/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  if (!code) { res.status(400).send('Missing authorization code'); return; }

  const tokens = await exchangeCode(CLIENT_ID, CLIENT_SECRET, code, REDIRECT_URI);

  res.send(`
    <html><body style="font-family:monospace;padding:40px;max-width:700px">
      <h2>✅ Digits Connected!</h2>
      <p>Copy your <strong>refresh token</strong> below and add it to your Cursor MCP config:</p>
      <textarea style="width:100%;height:80px;font-size:12px;padding:8px" readonly>${tokens.refresh_token}</textarea>
      <hr>
      <h3>Add to ~/.cursor/mcp.json:</h3>
      <pre style="background:#f4f4f4;padding:16px;font-size:12px">{
  "digits": {
    "url": "${BASE_URL}/mcp",
    "headers": {
      "Authorization": "Bearer ${MCP_API_KEY || 'YOUR_MCP_API_KEY'}",
      "X-Digits-Refresh-Token": "${tokens.refresh_token}"
    }
  }
}</pre>
      <p style="color:#666">Access token expires in ${tokens.expires_in}s — the MCP auto-refreshes using your refresh token.</p>
    </body></html>
  `);
});

app.get('/health', (_req, res) => res.json({
  status: 'ok', server: 'digits-mcp', version: '1.0.0',
  auth_url: `${BASE_URL}/auth/start`,
  tools: ['get_company', 'get_categories', 'get_parties', 'get_sources',
    'get_profit_and_loss', 'get_balance_sheet', 'get_cash_flow',
    'list_transactions', 'query_transactions', 'get_transaction'],
}));

app.post('/mcp', authenticate, async (req: Request, res: Response) => {
  const refreshToken = resolveRefreshToken(req);
  if (!refreshToken) {
    res.status(400).json({
      error: `No Digits refresh token. Visit ${BASE_URL}/auth/start to connect your account.`,
    });
    return;
  }

  const accessToken = await getAccessToken(CLIENT_ID, CLIENT_SECRET, refreshToken);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on('close', () => transport.close());

  const server = createMcpServer(accessToken);
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', authenticate, (_req, res) => res.status(405).json({ error: 'Use POST /mcp' }));
app.delete('/mcp', authenticate, (_req, res) => res.status(405).json({ error: 'Stateless mode' }));

app.listen(PORT, () => {
  console.log(`digits-mcp running on http://0.0.0.0:${PORT}`);
  console.log(`  OAuth: ${BASE_URL}/auth/start`);
});
