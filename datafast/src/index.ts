import express, { NextFunction, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import {
  getOverview, getTimeseries, getRealtime, getRealtimeMap, getMetadata,
  getPages, getReferrers, getCampaigns, getGoals,
  getCountries, getRegions, getCities,
  getDevices, getBrowsers, getOperatingSystems, getHostnames,
  getVisitor, trackGoal, deleteGoals, trackPayment, deletePayments,
} from './api.js';

const MCP_API_KEY = process.env.MCP_API_KEY;
const PORT = parseInt(process.env.PORT || '3500');
if (isNaN(PORT)) throw new Error(`Invalid PORT: "${process.env.PORT}"`);

// ─── Shared zod schemas ────────────────────────────────────────────────────────

const dateRange = {
  start_at: z.string().optional().describe("Start date (ISO 8601, e.g. '2026-02-01' or '2026-02-01T00:00:00Z')"),
  end_at: z.string().optional().describe("End date (ISO 8601, e.g. '2026-02-28' or '2026-02-28T23:59:59Z')"),
  timezone: z.string().optional().describe("IANA timezone (e.g. 'America/New_York'). Defaults to website timezone."),
};

const pagination = {
  limit: z.number().optional().describe("Max results (default 100)"),
  offset: z.number().optional().describe("Pagination offset"),
};

const commonFilters = {
  filter_country: z.string().optional().describe("Filter by country. Format: 'is:United States,Canada' or 'is_not:Germany'"),
  filter_device: z.string().optional().describe("Filter by device type. Format: 'is:desktop' or 'is_not:mobile'"),
  filter_referrer: z.string().optional().describe("Filter by referrer. Format: 'is:google.com,twitter.com'"),
  filter_page: z.string().optional().describe("Filter by page path. Format: 'is:/pricing' or 'contains:/blog'"),
};

// ─── MCP server factory ────────────────────────────────────────────────────────

function createMcpServer(apiKey: string): McpServer {
  const server = new McpServer({ name: 'datafast-mcp', version: '1.0.0' });

  function ok(data: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  }

  // ── Site metadata ────────────────────────────────────────────────────────────

  server.tool('get_metadata',
    'Get website configuration: domain, timezone, currency, KPI goal, name, logo. Call this first to understand the site setup.',
    {},
    async () => ok(await getMetadata(apiKey))
  );

  // ── Overview / aggregate metrics ─────────────────────────────────────────────

  server.tool('get_overview',
    'Get aggregate analytics metrics for a date range: visitors, sessions, bounce_rate, avg_session_duration, revenue, revenue_per_visitor, conversion_rate. Omit dates for all-time. Both startAt and endAt must be provided together.',
    {
      ...dateRange,
      fields: z.string().optional().describe("Comma-separated fields: visitors, sessions, bounce_rate, avg_session_duration, currency, revenue, revenue_per_visitor, conversion_rate. Omit for all."),
    },
    async ({ start_at, end_at, timezone, fields }) => {
      const data = await getOverview(apiKey, { startAt: start_at, endAt: end_at, timezone, fields });
      return ok(data);
    }
  );

  // ── Time series ──────────────────────────────────────────────────────────────

  server.tool('get_timeseries',
    'Get analytics data over time broken down by day/week/month/hour. Great for charts and trend analysis. Returns totals + revenueBreakdown (new/renewal/refund). Use filters to segment by traffic source, country, device, etc.',
    {
      ...dateRange,
      fields: z.string().optional().describe("Comma-separated metrics: visitors, sessions, revenue, conversion_rate. Default: visitors"),
      interval: z.enum(['hour', 'day', 'week', 'month']).optional().describe("Time granularity (default: day)"),
      ...pagination,
      filter_country: commonFilters.filter_country,
      filter_device: commonFilters.filter_device,
      filter_referrer: commonFilters.filter_referrer,
      filter_page: commonFilters.filter_page,
      filter_utm_source: z.string().optional().describe("Filter by UTM source. Format: 'is:google,facebook'"),
      filter_utm_medium: z.string().optional().describe("Filter by UTM medium. Format: 'is:email,cpc'"),
      filter_utm_campaign: z.string().optional().describe("Filter by UTM campaign. Format: 'is:summer_sale'"),
      filter_browser: z.string().optional().describe("Filter by browser. Format: 'is:Chrome,Safari'"),
      filter_os: z.string().optional().describe("Filter by OS. Format: 'is:Mac OS,Windows'"),
    },
    async ({ start_at, end_at, timezone, fields, interval, limit, offset, ...filters }) => {
      const filterMap: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(filters)) if (v) filterMap[k] = v as string;
      const data = await getTimeseries(apiKey, {
        startAt: start_at, endAt: end_at, timezone, fields, interval, limit, offset, ...filterMap,
      });
      return ok(data);
    }
  );

  // ── Realtime ─────────────────────────────────────────────────────────────────

  server.tool('get_realtime',
    'Get the count of active visitors right now (activity in the last 5 minutes).',
    {},
    async () => ok(await getRealtime(apiKey))
  );

  server.tool('get_realtime_map',
    'Get live visitor data for the last 10 minutes: visitor locations, devices, pages, recent events, and recent payments. Includes conversion likelihood scores.',
    {},
    async () => ok(await getRealtimeMap(apiKey))
  );

  // ── Breakdowns ────────────────────────────────────────────────────────────────

  server.tool('get_pages',
    'Get top pages by visitors and revenue. Shows hostname + path breakdown.',
    { ...dateRange, ...pagination, ...commonFilters },
    async ({ start_at, end_at, timezone, limit, offset, filter_country, filter_device, filter_referrer }) =>
      ok(await getPages(apiKey, { startAt: start_at, endAt: end_at, timezone, limit, offset, filter_country, filter_device, filter_referrer }))
  );

  server.tool('get_referrers',
    'Get traffic sources and referrers with visitor counts and revenue attribution. Great for understanding what channels drive conversions.',
    { ...dateRange, ...pagination, filter_country: commonFilters.filter_country, filter_device: commonFilters.filter_device, filter_page: commonFilters.filter_page },
    async ({ start_at, end_at, timezone, limit, offset, filter_country, filter_device, filter_page }) =>
      ok(await getReferrers(apiKey, { startAt: start_at, endAt: end_at, timezone, limit, offset, filter_country, filter_device, filter_page }))
  );

  server.tool('get_campaigns',
    'Get UTM campaign analytics: utm_source, utm_medium, utm_campaign, utm_term, utm_content, ref, source, via — with visitor counts and revenue.',
    {
      ...dateRange, ...pagination,
      fields: z.string().optional().describe("Filter to specific UTM fields: 'utm_source,utm_medium,utm_campaign'"),
    },
    async ({ start_at, end_at, timezone, limit, offset, fields }) =>
      ok(await getCampaigns(apiKey, { startAt: start_at, endAt: end_at, timezone, limit, offset, fields }))
  );

  server.tool('get_goals',
    'Get custom goal analytics: completions count and unique visitors per goal name. Use this to see signup rates, checkout initiations, scroll events, etc.',
    { ...dateRange, ...pagination, fields: z.string().optional().describe("Filter to specific fields: 'goal,completions'") },
    async ({ start_at, end_at, timezone, limit, offset, fields }) =>
      ok(await getGoals(apiKey, { startAt: start_at, endAt: end_at, timezone, limit, offset, fields }))
  );

  server.tool('get_countries',
    'Get visitors and revenue broken down by country. Includes flag image URLs.',
    { ...dateRange, ...pagination, filter_device: commonFilters.filter_device, filter_referrer: commonFilters.filter_referrer, filter_page: commonFilters.filter_page },
    async ({ start_at, end_at, timezone, limit, offset, filter_device, filter_referrer, filter_page }) =>
      ok(await getCountries(apiKey, { startAt: start_at, endAt: end_at, timezone, limit, offset, filter_device, filter_referrer, filter_page }))
  );

  server.tool('get_regions',
    'Get visitors and revenue broken down by region/state.',
    { ...dateRange, ...pagination },
    async ({ start_at, end_at, timezone, limit, offset }) =>
      ok(await getRegions(apiKey, { startAt: start_at, endAt: end_at, timezone, limit, offset }))
  );

  server.tool('get_cities',
    'Get visitors and revenue broken down by city.',
    { ...dateRange, ...pagination },
    async ({ start_at, end_at, timezone, limit, offset }) =>
      ok(await getCities(apiKey, { startAt: start_at, endAt: end_at, timezone, limit, offset }))
  );

  server.tool('get_devices',
    'Get visitors and revenue broken down by device type (desktop, mobile, tablet).',
    { ...dateRange, ...pagination, filter_country: commonFilters.filter_country, filter_referrer: commonFilters.filter_referrer, filter_page: commonFilters.filter_page },
    async ({ start_at, end_at, timezone, limit, offset, filter_country, filter_referrer, filter_page }) =>
      ok(await getDevices(apiKey, { startAt: start_at, endAt: end_at, timezone, limit, offset, filter_country, filter_referrer, filter_page }))
  );

  server.tool('get_browsers',
    'Get visitors and revenue broken down by browser (Chrome, Safari, Firefox, etc.).',
    { ...dateRange, ...pagination },
    async ({ start_at, end_at, timezone, limit, offset }) =>
      ok(await getBrowsers(apiKey, { startAt: start_at, endAt: end_at, timezone, limit, offset }))
  );

  server.tool('get_operating_systems',
    'Get visitors and revenue broken down by operating system (Mac OS, Windows, iOS, Android, etc.).',
    { ...dateRange, ...pagination },
    async ({ start_at, end_at, timezone, limit, offset }) =>
      ok(await getOperatingSystems(apiKey, { startAt: start_at, endAt: end_at, timezone, limit, offset }))
  );

  server.tool('get_hostnames',
    'Get visitors and revenue broken down by hostname/domain. Useful if tracking across subdomains.',
    { ...dateRange, ...pagination },
    async ({ start_at, end_at, timezone, limit, offset }) =>
      ok(await getHostnames(apiKey, { startAt: start_at, endAt: end_at, timezone, limit, offset }))
  );

  // ── Visitor profile ───────────────────────────────────────────────────────────

  server.tool('get_visitor',
    'Get full profile for a specific visitor: identity (geo, device, browser, UTM params), activity (visit count, pages visited, goals completed), and conversion prediction score (0-100) with expected revenue value.',
    { visitor_id: z.string().describe("DataFast visitor ID (from datafast_visitor_id cookie)") },
    async ({ visitor_id }) => ok(await getVisitor(apiKey, visitor_id))
  );

  // ── Event tracking ────────────────────────────────────────────────────────────

  server.tool('track_goal',
    'Server-side: record a custom goal event for a visitor. Use for signups, purchases, feature usage, etc. Requires the visitor to have at least one prior pageview.',
    {
      visitor_id: z.string().describe("DataFast visitor ID (from datafast_visitor_id cookie)"),
      name: z.string().describe("Goal name (lowercase, underscores/hyphens, max 64 chars — e.g. 'signup', 'checkout_initiated')"),
      metadata: z.record(z.string()).optional().describe("Custom key-value pairs (max 10, values max 255 chars)"),
    },
    async ({ visitor_id, name, metadata }) =>
      ok(await trackGoal(apiKey, { datafast_visitor_id: visitor_id, name, metadata }))
  );

  server.tool('track_payment',
    'Record a payment for revenue attribution. Use for any payment provider not natively supported (Stripe/LemonSqueezy/Polar are auto-tracked). Attributes revenue to the visitor\'s traffic source.',
    {
      amount: z.number().describe("Payment amount (e.g. 29.99)"),
      currency: z.string().describe("ISO currency code (e.g. 'USD', 'EUR')"),
      transaction_id: z.string().describe("Unique transaction ID from your payment provider"),
      visitor_id: z.string().optional().describe("DataFast visitor ID for attribution (highly recommended)"),
      email: z.string().optional().describe("Customer email"),
      name: z.string().optional().describe("Customer name"),
      customer_id: z.string().optional().describe("Customer ID from payment provider"),
      renewal: z.boolean().optional().describe("True if recurring/renewal payment (default false)"),
      refunded: z.boolean().optional().describe("True if refunded (default false)"),
      timestamp: z.string().optional().describe("ISO 8601 timestamp (defaults to now)"),
    },
    async ({ amount, currency, transaction_id, visitor_id, email, name, customer_id, renewal, refunded, timestamp }) =>
      ok(await trackPayment(apiKey, {
        amount, currency, transaction_id,
        datafast_visitor_id: visitor_id, email, name, customer_id, renewal, refunded, timestamp,
      }))
  );

  // ── Data deletion ─────────────────────────────────────────────────────────────

  server.tool('delete_goals',
    'Delete goal events by visitor ID, name, or time range. WARNING: without time range, deletes ALL matching records across all time.',
    {
      visitor_id: z.string().optional().describe("Delete all goals for this visitor"),
      name: z.string().optional().describe("Delete all goals with this name (e.g. 'signup')"),
      start_at: z.string().optional().describe("Start of time range to delete within (ISO 8601)"),
      end_at: z.string().optional().describe("End of time range to delete within (ISO 8601)"),
    },
    async ({ visitor_id, name, start_at, end_at }) =>
      ok(await deleteGoals(apiKey, { datafast_visitor_id: visitor_id, name, startAt: start_at, endAt: end_at }))
  );

  server.tool('delete_payments',
    'Delete payments by transaction ID, visitor ID, or time range. WARNING: without time range, deletes ALL payments for that visitor.',
    {
      transaction_id: z.string().optional().describe("Delete a specific payment by transaction ID"),
      visitor_id: z.string().optional().describe("Delete all payments for this visitor"),
      start_at: z.string().optional().describe("Start of time range (ISO 8601)"),
      end_at: z.string().optional().describe("End of time range (ISO 8601)"),
    },
    async ({ transaction_id, visitor_id, start_at, end_at }) =>
      ok(await deletePayments(apiKey, { transaction_id, datafast_visitor_id: visitor_id, startAt: start_at, endAt: end_at }))
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

function resolveDatafastKey(req: Request): string | null {
  return (req.headers['x-datafast-api-key'] as string | undefined)
    ?? process.env.DATAFAST_API_KEY
    ?? null;
}

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({
  status: 'ok',
  server: 'datafast-mcp',
  version: '1.0.0',
  auth: MCP_API_KEY ? 'enabled' : 'disabled',
  tools: [
    'get_metadata', 'get_overview', 'get_timeseries',
    'get_realtime', 'get_realtime_map',
    'get_pages', 'get_referrers', 'get_campaigns', 'get_goals',
    'get_countries', 'get_regions', 'get_cities',
    'get_devices', 'get_browsers', 'get_operating_systems', 'get_hostnames',
    'get_visitor',
    'track_goal', 'track_payment',
    'delete_goals', 'delete_payments',
  ],
}));

app.post('/mcp', authenticate, async (req: Request, res: Response) => {
  const datafastKey = resolveDatafastKey(req);
  if (!datafastKey) {
    res.status(400).json({ error: 'No DataFast API key. Set DATAFAST_API_KEY env or pass X-Datafast-Api-Key header.' });
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on('close', () => transport.close());

  const server = createMcpServer(datafastKey);
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', authenticate, (_req, res) => res.status(405).json({ error: 'Use POST /mcp' }));
app.delete('/mcp', authenticate, (_req, res) => res.status(405).json({ error: 'Stateless mode' }));

app.listen(PORT, () => {
  console.log(`datafast-mcp running on http://0.0.0.0:${PORT}`);
  console.log(`  Key mode: ${process.env.DATAFAST_API_KEY ? 'env (DATAFAST_API_KEY)' : 'per-request (X-Datafast-Api-Key header)'}`);
});
