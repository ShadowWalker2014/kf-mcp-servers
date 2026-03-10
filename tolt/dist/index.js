import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import * as api from './api.js';
const MCP_API_KEY = process.env.MCP_API_KEY;
const PORT = parseInt(process.env.PORT || '3700');
// Pagination + expand params shared across list tools
const listParams = {
    limit: z.number().int().min(1).max(100).optional().describe('Max results (default 10, max 100)'),
    starting_after: z.string().optional().describe('Cursor: last ID from previous page'),
    ending_before: z.string().optional().describe('Cursor: first ID for previous page'),
    order: z.enum(['asc', 'desc']).optional().describe('Sort by created_at (default desc)'),
    created_after: z.string().optional().describe('ISO 8601 filter: created after'),
    created_before: z.string().optional().describe('ISO 8601 filter: created before'),
};
const expandParam = z.array(z.string()).optional().describe('Related objects to expand (e.g. ["group","program"])');
function strip(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}
function createMcpServer(apiKey) {
    const server = new McpServer({ name: 'tolt-mcp', version: '1.0.0' });
    // ── PARTNERS ──────────────────────────────────────────────────────────────
    server.tool('list_partners', 'List all partners with optional filters and pagination.', {
        program_id: z.string().optional().describe('Filter by program ID'),
        group_id: z.string().optional().describe('Filter by group ID'),
        expand: expandParam,
        ...listParams,
    }, async (p) => ({ content: [{ type: 'text', text: JSON.stringify(await api.listPartners(apiKey, strip(p)), null, 2) }] }));
    server.tool('get_partner', 'Retrieve a single partner by ID.', { id: z.string().describe('Partner ID (e.g. part_...)') }, async ({ id }) => ({ content: [{ type: 'text', text: JSON.stringify(await api.getPartner(apiKey, id), null, 2) }] }));
    server.tool('create_partner', 'Create a new partner.', {
        first_name: z.string().describe("Partner's first name"),
        last_name: z.string().optional().describe("Partner's last name"),
        email: z.string().email().describe("Partner's email address"),
        program_id: z.string().describe('Program ID the partner belongs to'),
        group_id: z.string().optional().describe('Group ID to assign the partner to'),
        company_name: z.string().optional().describe("Partner's company name"),
        country_code: z.string().length(2).optional().describe('Two-letter ISO country code'),
        payout_method: z.enum(['paypal', 'crypto', 'wise', 'bank_transfer', 'wire', 'none']).optional(),
        payout_details: z.record(z.unknown()).optional().describe('Payout method specific details'),
        send_welcome_email: z.boolean().optional().describe('Send welcome email after creation'),
    }, async (p) => ({ content: [{ type: 'text', text: JSON.stringify(await api.createPartner(apiKey, strip(p)), null, 2) }] }));
    server.tool('update_partner', 'Update an existing partner.', {
        id: z.string().describe('Partner ID'),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        email: z.string().email().optional(),
        company_name: z.string().optional(),
        country_code: z.string().length(2).optional(),
        payout_method: z.enum(['paypal', 'crypto', 'wise', 'bank_transfer', 'wire', 'none']).optional(),
        payout_details: z.record(z.unknown()).optional(),
        group_id: z.string().optional(),
        internal_note: z.string().optional(),
    }, async ({ id, ...body }) => ({ content: [{ type: 'text', text: JSON.stringify(await api.updatePartner(apiKey, id, strip(body)), null, 2) }] }));
    server.tool('delete_partner', 'Delete a partner by ID.', { id: z.string().describe('Partner ID') }, async ({ id }) => ({ content: [{ type: 'text', text: JSON.stringify(await api.deletePartner(apiKey, id), null, 2) }] }));
    // ── CUSTOMERS ─────────────────────────────────────────────────────────────
    server.tool('list_customers', 'List all customers with optional filters and pagination.', {
        program_id: z.string().optional().describe('Filter by program ID'),
        partner_id: z.string().optional().describe('Filter by referring partner ID'),
        status: z.enum(['lead', 'trialing', 'active', 'canceled']).optional(),
        expand: expandParam,
        ...listParams,
    }, async (p) => ({ content: [{ type: 'text', text: JSON.stringify(await api.listCustomers(apiKey, strip(p)), null, 2) }] }));
    server.tool('get_customer', 'Retrieve a single customer by ID.', { id: z.string().describe('Customer ID (e.g. cust_...)') }, async ({ id }) => ({ content: [{ type: 'text', text: JSON.stringify(await api.getCustomer(apiKey, id), null, 2) }] }));
    server.tool('create_customer', 'Create a new customer.', {
        email: z.string().describe("Customer's email address"),
        partner_id: z.string().optional().describe('Partner ID who referred this customer'),
        name: z.string().optional().describe("Customer's name"),
        subscription_id: z.string().optional().describe('Associated subscription identifier'),
        customer_id: z.string().optional().describe('Your internal customer identifier'),
        click_id: z.string().optional().describe('Tracking click identifier'),
        created_at: z.string().optional().describe('ISO 8601 creation timestamp'),
        lead_at: z.string().optional().describe('ISO 8601 lead conversion timestamp'),
        active_at: z.string().optional().describe('ISO 8601 activation timestamp'),
        status: z.enum(['lead', 'trialing', 'active', 'canceled']).optional(),
    }, async (p) => ({ content: [{ type: 'text', text: JSON.stringify(await api.createCustomer(apiKey, strip(p)), null, 2) }] }));
    server.tool('update_customer', 'Update an existing customer.', {
        id: z.string().describe('Customer ID'),
        email: z.string().optional(),
        name: z.string().optional(),
        subscription_id: z.string().optional(),
        customer_id: z.string().optional(),
        status: z.enum(['lead', 'trialing', 'active', 'canceled']).optional(),
        active_at: z.string().optional(),
        lead_at: z.string().optional(),
    }, async ({ id, ...body }) => ({ content: [{ type: 'text', text: JSON.stringify(await api.updateCustomer(apiKey, id, strip(body)), null, 2) }] }));
    server.tool('delete_customer', 'Delete a customer by ID.', { id: z.string().describe('Customer ID') }, async ({ id }) => ({ content: [{ type: 'text', text: JSON.stringify(await api.deleteCustomer(apiKey, id), null, 2) }] }));
    // ── TRANSACTIONS ──────────────────────────────────────────────────────────
    server.tool('list_transactions', 'List all transactions with optional filters and pagination.', {
        program_id: z.string().optional().describe('Filter by program ID'),
        partner_id: z.string().optional().describe('Filter by partner ID'),
        customer_id: z.string().optional().describe('Filter by customer ID'),
        status: z.string().optional().describe('Filter by status (e.g. paid, refunded)'),
        expand: expandParam,
        ...listParams,
    }, async (p) => ({ content: [{ type: 'text', text: JSON.stringify(await api.listTransactions(apiKey, strip(p)), null, 2) }] }));
    server.tool('get_transaction', 'Retrieve a single transaction by ID.', { id: z.string().describe('Transaction ID (e.g. txn_...)') }, async ({ id }) => ({ content: [{ type: 'text', text: JSON.stringify(await api.getTransaction(apiKey, id), null, 2) }] }));
    server.tool('create_transaction', 'Create a new transaction (e.g. to track a purchase).', {
        amount: z.number().int().describe('Transaction amount in cents'),
        customer_id: z.string().describe('Customer ID associated with this transaction'),
        billing_type: z.enum(['one_time', 'subscription']).describe('Billing type'),
        charge_id: z.string().optional().describe('Associated charge identifier'),
        click_id: z.string().optional().describe('Associated click identifier'),
        created_at: z.string().optional().describe('ISO 8601 creation timestamp'),
        product_id: z.string().optional().describe('Product ID'),
        product_name: z.string().optional().describe('Product name'),
        source: z.string().optional().describe('Source of the transaction (e.g. stripe)'),
        interval: z.enum(['month', 'year']).optional().describe('Subscription interval'),
    }, async (p) => ({ content: [{ type: 'text', text: JSON.stringify(await api.createTransaction(apiKey, strip(p)), null, 2) }] }));
    server.tool('update_transaction', 'Update an existing transaction.', {
        id: z.string().describe('Transaction ID'),
        amount: z.number().int().optional(),
        status: z.string().optional(),
        charge_id: z.string().optional(),
        product_id: z.string().optional(),
        product_name: z.string().optional(),
    }, async ({ id, ...body }) => ({ content: [{ type: 'text', text: JSON.stringify(await api.updateTransaction(apiKey, id, strip(body)), null, 2) }] }));
    server.tool('delete_transaction', 'Delete a transaction by ID.', { id: z.string().describe('Transaction ID') }, async ({ id }) => ({ content: [{ type: 'text', text: JSON.stringify(await api.deleteTransaction(apiKey, id), null, 2) }] }));
    server.tool('refund_transaction', 'Refund a transaction by ID.', { id: z.string().describe('Transaction ID to refund') }, async ({ id }) => ({ content: [{ type: 'text', text: JSON.stringify(await api.refundTransaction(apiKey, id), null, 2) }] }));
    // ── COMMISSIONS ───────────────────────────────────────────────────────────
    server.tool('list_commissions', 'List all commissions with optional filters and pagination.', {
        program_id: z.string().optional().describe('Filter by program ID'),
        partner_id: z.string().optional().describe('Filter by partner ID'),
        customer_id: z.string().optional().describe('Filter by customer ID'),
        transaction_id: z.string().optional().describe('Filter by transaction ID'),
        status: z.string().optional().describe('Filter by status (e.g. pending, paid)'),
        expand: expandParam,
        ...listParams,
    }, async (p) => ({ content: [{ type: 'text', text: JSON.stringify(await api.listCommissions(apiKey, strip(p)), null, 2) }] }));
    server.tool('get_commission', 'Retrieve a single commission by ID.', { id: z.string().describe('Commission ID (e.g. comm_...)') }, async ({ id }) => ({ content: [{ type: 'text', text: JSON.stringify(await api.getCommission(apiKey, id), null, 2) }] }));
    server.tool('create_commission', 'Create a new commission manually.', {
        partner_id: z.string().describe('Partner ID who earns the commission'),
        amount: z.number().int().describe('Commission amount in cents'),
        customer_id: z.string().optional().describe('Customer ID associated with this commission'),
        transaction_id: z.string().optional().describe('Transaction ID associated with this commission'),
        program_id: z.string().optional().describe('Program ID'),
        status: z.string().optional().describe('Commission status'),
    }, async (p) => ({ content: [{ type: 'text', text: JSON.stringify(await api.createCommission(apiKey, strip(p)), null, 2) }] }));
    server.tool('update_commission', 'Update an existing commission (e.g. change status).', {
        id: z.string().describe('Commission ID'),
        status: z.string().optional().describe('New status (e.g. paid, cancelled)'),
        amount: z.number().int().optional(),
    }, async ({ id, ...body }) => ({ content: [{ type: 'text', text: JSON.stringify(await api.updateCommission(apiKey, id, strip(body)), null, 2) }] }));
    server.tool('delete_commission', 'Delete a commission by ID.', { id: z.string().describe('Commission ID') }, async ({ id }) => ({ content: [{ type: 'text', text: JSON.stringify(await api.deleteCommission(apiKey, id), null, 2) }] }));
    // ── LINKS ─────────────────────────────────────────────────────────────────
    server.tool('list_links', 'List all tracking links with optional filters and pagination.', {
        program_id: z.string().optional().describe('Filter by program ID'),
        partner_id: z.string().optional().describe('Filter by partner ID'),
        ...listParams,
    }, async (p) => ({ content: [{ type: 'text', text: JSON.stringify(await api.listLinks(apiKey, strip(p)), null, 2) }] }));
    server.tool('get_link', 'Retrieve a single tracking link by ID.', { id: z.string().describe('Link ID (e.g. lnk_...)') }, async ({ id }) => ({ content: [{ type: 'text', text: JSON.stringify(await api.getLink(apiKey, id), null, 2) }] }));
    server.tool('create_link', 'Create a new tracking link for a partner.', {
        param: z.string().describe("Tracking parameter name (e.g. 'ref', 'via')"),
        value: z.string().describe('Value of the tracking parameter'),
        partner_id: z.string().describe('Partner ID who owns this link'),
    }, async (p) => ({ content: [{ type: 'text', text: JSON.stringify(await api.createLink(apiKey, p), null, 2) }] }));
    server.tool('update_link', 'Update an existing tracking link.', {
        id: z.string().describe('Link ID'),
        param: z.string().optional(),
        value: z.string().optional(),
    }, async ({ id, ...body }) => ({ content: [{ type: 'text', text: JSON.stringify(await api.updateLink(apiKey, id, strip(body)), null, 2) }] }));
    server.tool('delete_link', 'Delete a tracking link by ID.', { id: z.string().describe('Link ID') }, async ({ id }) => ({ content: [{ type: 'text', text: JSON.stringify(await api.deleteLink(apiKey, id), null, 2) }] }));
    // ── CLICKS ────────────────────────────────────────────────────────────────
    server.tool('create_click', 'Record a click event. Use partner_id + link_id OR param + value.', {
        partner_id: z.string().optional().describe('Partner ID (Method 1)'),
        link_id: z.string().optional().describe('Link ID (Method 1)'),
        param: z.string().optional().describe("Tracking param name, e.g. 'ref' (Method 2)"),
        value: z.string().optional().describe('Tracking param value (Method 2)'),
        country: z.string().length(2).optional().describe('Two-letter ISO country code'),
        device: z.enum(['desktop', 'mobile', 'tablet']).optional(),
        page: z.string().url().optional().describe('URL of the page where click occurred'),
        referrer: z.string().url().optional().describe('Referring page URL'),
    }, async (p) => ({ content: [{ type: 'text', text: JSON.stringify(await api.createClick(apiKey, strip(p)), null, 2) }] }));
    // ── PROMOTION CODES ───────────────────────────────────────────────────────
    server.tool('list_promotion_codes', 'List all promotion codes with optional filters and pagination.', {
        program_id: z.string().optional().describe('Filter by program ID'),
        partner_id: z.string().optional().describe('Filter by partner ID'),
        ...listParams,
    }, async (p) => ({ content: [{ type: 'text', text: JSON.stringify(await api.listPromoCodes(apiKey, strip(p)), null, 2) }] }));
    server.tool('get_promotion_code', 'Retrieve a single promotion code by ID.', { id: z.string().describe('Promotion code ID') }, async ({ id }) => ({ content: [{ type: 'text', text: JSON.stringify(await api.getPromoCode(apiKey, id), null, 2) }] }));
    server.tool('create_promotion_code', 'Create a new promotion code for a partner.', {
        code: z.string().describe('The promotion code string'),
        partner_id: z.string().describe('Partner ID who owns this code'),
        program_id: z.string().optional().describe('Program ID'),
        discount_type: z.string().optional().describe('Type of discount (e.g. percentage, fixed)'),
        discount_value: z.number().optional().describe('Discount amount'),
    }, async (p) => ({ content: [{ type: 'text', text: JSON.stringify(await api.createPromoCode(apiKey, strip(p)), null, 2) }] }));
    server.tool('update_promotion_code', 'Update an existing promotion code.', {
        id: z.string().describe('Promotion code ID'),
        code: z.string().optional(),
        discount_type: z.string().optional(),
        discount_value: z.number().optional(),
    }, async ({ id, ...body }) => ({ content: [{ type: 'text', text: JSON.stringify(await api.updatePromoCode(apiKey, id, strip(body)), null, 2) }] }));
    server.tool('delete_promotion_code', 'Delete a promotion code by ID.', { id: z.string().describe('Promotion code ID') }, async ({ id }) => ({ content: [{ type: 'text', text: JSON.stringify(await api.deletePromoCode(apiKey, id), null, 2) }] }));
    return server;
}
function authenticate(req, res, next) {
    if (!MCP_API_KEY)
        return next();
    const key = req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : req.headers['x-api-key'];
    if (!key) {
        res.status(401).json({ error: 'Missing API key' });
        return;
    }
    if (key !== MCP_API_KEY) {
        res.status(403).json({ error: 'Invalid API key' });
        return;
    }
    next();
}
function resolveApiKey(req) {
    return req.headers['x-tolt-api-key'] ?? process.env.TOLT_API_KEY ?? null;
}
const app = express();
app.use(express.json());
app.get('/health', (_req, res) => res.json({ status: 'ok', server: 'tolt-mcp', version: '1.0.0' }));
app.post('/mcp', authenticate, async (req, res) => {
    const apiKey = resolveApiKey(req);
    if (!apiKey) {
        res.status(400).json({ error: 'No Tolt API key. Pass X-Tolt-Api-Key header or set TOLT_API_KEY env var.' });
        return;
    }
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
    });
    res.on('close', () => transport.close());
    const server = createMcpServer(apiKey);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
});
app.get('/mcp', authenticate, (_req, res) => res.status(405).json({ error: 'Use POST /mcp' }));
app.delete('/mcp', authenticate, (_req, res) => res.status(405).json({ error: 'Stateless mode' }));
app.listen(PORT, () => console.log(`tolt-mcp running on http://0.0.0.0:${PORT}`));
//# sourceMappingURL=index.js.map