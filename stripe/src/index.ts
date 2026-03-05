#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import Stripe from "stripe";

const FALLBACK_STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const TRANSPORT_TYPE = process.env.TRANSPORT_TYPE || 'stdio';
const PORT = parseInt(process.env.PORT || '8080', 10);

if (TRANSPORT_TYPE === 'stdio' && !FALLBACK_STRIPE_SECRET_KEY) {
  console.error("STRIPE_SECRET_KEY is required for stdio mode");
  process.exit(1);
}

function createStripeClient(apiKey: string): Stripe {
  return new Stripe(apiKey, { apiVersion: '2025-05-28.basil', typescript: true });
}

const defaultStripe = FALLBACK_STRIPE_SECRET_KEY ? createStripeClient(FALLBACK_STRIPE_SECRET_KEY) : null;

// ─── Tool definitions ──────────────────────────────────────────────────────────

function addStripeTools(server: McpServer, stripe: Stripe) {
  function ok(data: unknown, message?: string) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, ...(message ? { message } : {}), ...( data !== null ? { data } : {}) }, null, 2) }] };
  }
  function err(e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: msg }, null, 2) }] };
  }

  // ── Customers ──────────────────────────────────────────────────────────────

  server.tool("stripe_customers",
    "Manage Stripe customers. Actions: create, retrieve, update, delete, list, search. Use search with email to find a customer by email address.",
    {
      action: z.enum(['create', 'retrieve', 'update', 'delete', 'list', 'search']),
      customer_id: z.string().optional().describe("Customer ID (required for retrieve, update, delete)"),
      email: z.string().optional().describe("Email address (for create/update, or search query)"),
      name: z.string().optional().describe("Customer full name"),
      description: z.string().optional().describe("Internal description"),
      phone: z.string().optional().describe("Phone number"),
      metadata: z.string().optional().describe("JSON string of metadata key-value pairs"),
      search_query: z.string().optional().describe("Stripe search query string, e.g. 'email:\"foo@bar.com\"' or 'name:\"John\"'. Used with action=search"),
      limit: z.number().optional().describe("Max results for list/search (default 10, max 100)"),
    },
    async ({ action, customer_id, email, name, description, phone, metadata, search_query, limit = 10 }) => {
      try {
        const meta = metadata ? JSON.parse(metadata) : undefined;
        const validLimit = Math.min(Math.max(limit, 1), 100);

        switch (action) {
          case 'create': {
            const customer = await stripe.customers.create({
              ...(email && { email }),
              ...(name && { name }),
              ...(description && { description }),
              ...(phone && { phone }),
              ...(meta && { metadata: meta }),
            });
            return ok(customer, `Created customer ${customer.id}`);
          }
          case 'retrieve': {
            if (!customer_id) return err('customer_id is required for retrieve');
            const customer = await stripe.customers.retrieve(customer_id);
            return ok(customer);
          }
          case 'update': {
            if (!customer_id) return err('customer_id is required for update');
            const customer = await stripe.customers.update(customer_id, {
              ...(email && { email }),
              ...(name && { name }),
              ...(description !== undefined && { description }),
              ...(phone && { phone }),
              ...(meta && { metadata: meta }),
            });
            return ok(customer, `Updated customer ${customer.id}`);
          }
          case 'delete': {
            if (!customer_id) return err('customer_id is required for delete');
            const deleted = await stripe.customers.del(customer_id);
            return ok(deleted, `Deleted customer ${customer_id}`);
          }
          case 'list': {
            const customers = await stripe.customers.list({
              limit: validLimit,
              ...(email && { email }),
            });
            return ok({ customers: customers.data, has_more: customers.has_more }, `Found ${customers.data.length} customer(s)`);
          }
          case 'search': {
            // Use Stripe Search API — correct way to find customers by email/name/metadata
            const query = search_query || (email ? `email:"${email}"` : '');
            if (!query) return err('Provide search_query or email for search action');
            const results = await stripe.customers.search({ query, limit: validLimit });
            return ok({ customers: results.data, has_more: results.has_more }, `Found ${results.data.length} customer(s)`);
          }
        }
      } catch (e) { return err(e); }
    }
  );

  // ── Subscriptions ──────────────────────────────────────────────────────────

  server.tool("stripe_subscriptions",
    "Manage Stripe subscriptions. Actions: create, retrieve, update, cancel, list. Status values: active, past_due, unpaid, canceled, trialing, all.",
    {
      action: z.enum(['create', 'retrieve', 'update', 'cancel', 'list']),
      subscription_id: z.string().optional().describe("Subscription ID (required for retrieve, update, cancel)"),
      customer_id: z.string().optional().describe("Customer ID (required for create, optional filter for list)"),
      price_id: z.string().optional().describe("Price ID (required for create)"),
      status: z.enum(['active', 'past_due', 'unpaid', 'canceled', 'trialing', 'incomplete', 'incomplete_expired', 'all']).optional().describe("Filter by status (for list)"),
      cancel_at_period_end: z.boolean().optional().describe("Cancel at end of billing period instead of immediately (for cancel/update)"),
      trial_period_days: z.number().optional().describe("Trial period in days (for create)"),
      metadata: z.string().optional().describe("JSON string of metadata key-value pairs"),
      limit: z.number().optional().describe("Max results for list (default 10, max 100)"),
    },
    async ({ action, subscription_id, customer_id, price_id, status, cancel_at_period_end, trial_period_days, metadata, limit = 10 }) => {
      try {
        const meta = metadata ? JSON.parse(metadata) : undefined;
        const validLimit = Math.min(Math.max(limit, 1), 100);

        switch (action) {
          case 'create': {
            if (!customer_id || !price_id) return err('customer_id and price_id are required for create');
            const sub = await stripe.subscriptions.create({
              customer: customer_id,
              items: [{ price: price_id }],
              ...(trial_period_days && { trial_period_days }),
              ...(meta && { metadata: meta }),
              expand: ['latest_invoice.payment_intent'],
            });
            return ok(sub, `Created subscription ${sub.id} (status: ${sub.status})`);
          }
          case 'retrieve': {
            if (!subscription_id) return err('subscription_id is required for retrieve');
            const sub = await stripe.subscriptions.retrieve(subscription_id);
            return ok(sub);
          }
          case 'update': {
            if (!subscription_id) return err('subscription_id is required for update');
            const sub = await stripe.subscriptions.update(subscription_id, {
              ...(cancel_at_period_end !== undefined && { cancel_at_period_end }),
              ...(meta && { metadata: meta }),
            });
            return ok(sub, `Updated subscription ${subscription_id}`);
          }
          case 'cancel': {
            if (!subscription_id) return err('subscription_id is required for cancel');
            if (cancel_at_period_end) {
              const sub = await stripe.subscriptions.update(subscription_id, { cancel_at_period_end: true });
              return ok(sub, `Subscription ${subscription_id} set to cancel at period end`);
            }
            const sub = await stripe.subscriptions.cancel(subscription_id);
            return ok(sub, `Cancelled subscription ${subscription_id}`);
          }
          case 'list': {
            const subs = await stripe.subscriptions.list({
              limit: validLimit,
              ...(customer_id && { customer: customer_id }),
              ...(status && { status }),
            });
            return ok({ subscriptions: subs.data, has_more: subs.has_more }, `Found ${subs.data.length} subscription(s)`);
          }
        }
      } catch (e) { return err(e); }
    }
  );

  // ── Products ───────────────────────────────────────────────────────────────

  server.tool("stripe_products",
    "Manage Stripe products. Actions: create, retrieve, update, archive, list.",
    {
      action: z.enum(['create', 'retrieve', 'update', 'archive', 'list']),
      product_id: z.string().optional().describe("Product ID (required for retrieve, update, archive)"),
      name: z.string().optional().describe("Product name (required for create)"),
      description: z.string().optional().describe("Product description"),
      active: z.boolean().optional().describe("Whether active (for update/list filter)"),
      metadata: z.string().optional().describe("JSON string of metadata"),
      limit: z.number().optional().describe("Max results for list (default 10, max 100)"),
    },
    async ({ action, product_id, name, description, active, metadata, limit = 10 }) => {
      try {
        const meta = metadata ? JSON.parse(metadata) : undefined;
        const validLimit = Math.min(Math.max(limit, 1), 100);

        switch (action) {
          case 'create': {
            if (!name) return err('name is required for create');
            const product = await stripe.products.create({
              name,
              ...(description && { description }),
              ...(meta && { metadata: meta }),
            });
            return ok(product, `Created product ${product.id}: ${product.name}`);
          }
          case 'retrieve': {
            if (!product_id) return err('product_id is required for retrieve');
            return ok(await stripe.products.retrieve(product_id));
          }
          case 'update': {
            if (!product_id) return err('product_id is required for update');
            const product = await stripe.products.update(product_id, {
              ...(name && { name }),
              ...(description !== undefined && { description }),
              ...(active !== undefined && { active }),
              ...(meta && { metadata: meta }),
            });
            return ok(product, `Updated product ${product_id}`);
          }
          case 'archive': {
            if (!product_id) return err('product_id is required for archive');
            const product = await stripe.products.update(product_id, { active: false });
            return ok(product, `Archived product ${product_id}`);
          }
          case 'list': {
            const products = await stripe.products.list({
              limit: validLimit,
              ...(active !== undefined && { active }),
            });
            return ok({ products: products.data, has_more: products.has_more }, `Found ${products.data.length} product(s)`);
          }
        }
      } catch (e) { return err(e); }
    }
  );

  // ── Prices ─────────────────────────────────────────────────────────────────

  server.tool("stripe_prices",
    "Manage Stripe prices. Actions: create, retrieve, update, archive, list.",
    {
      action: z.enum(['create', 'retrieve', 'update', 'archive', 'list']),
      price_id: z.string().optional().describe("Price ID (required for retrieve, update, archive)"),
      product_id: z.string().optional().describe("Product ID (required for create, optional filter for list)"),
      unit_amount: z.number().optional().describe("Price in cents, e.g. 2000 = $20.00 (required for create)"),
      currency: z.string().optional().describe("ISO currency code, e.g. 'usd' (default: usd)"),
      recurring_interval: z.enum(['day', 'week', 'month', 'year']).optional().describe("Billing interval (omit for one-time)"),
      active: z.boolean().optional().describe("Whether active (for update/list filter)"),
      metadata: z.string().optional().describe("JSON string of metadata"),
      limit: z.number().optional().describe("Max results for list (default 10, max 100)"),
    },
    async ({ action, price_id, product_id, unit_amount, currency = 'usd', recurring_interval, active, metadata, limit = 10 }) => {
      try {
        const meta = metadata ? JSON.parse(metadata) : undefined;
        const validLimit = Math.min(Math.max(limit, 1), 100);

        switch (action) {
          case 'create': {
            if (!product_id || unit_amount === undefined) return err('product_id and unit_amount are required for create');
            const price = await stripe.prices.create({
              product: product_id,
              unit_amount,
              currency,
              ...(recurring_interval && { recurring: { interval: recurring_interval } }),
              ...(meta && { metadata: meta }),
            });
            const label = `${(price.unit_amount ?? 0) / 100} ${price.currency.toUpperCase()}${price.recurring ? `/${price.recurring.interval}` : ''}`;
            return ok(price, `Created price ${price.id}: ${label}`);
          }
          case 'retrieve': {
            if (!price_id) return err('price_id is required for retrieve');
            return ok(await stripe.prices.retrieve(price_id));
          }
          case 'update': {
            if (!price_id) return err('price_id is required for update');
            const price = await stripe.prices.update(price_id, {
              ...(active !== undefined && { active }),
              ...(meta && { metadata: meta }),
            });
            return ok(price, `Updated price ${price_id}`);
          }
          case 'archive': {
            if (!price_id) return err('price_id is required for archive');
            return ok(await stripe.prices.update(price_id, { active: false }), `Archived price ${price_id}`);
          }
          case 'list': {
            const prices = await stripe.prices.list({
              limit: validLimit,
              ...(product_id && { product: product_id }),
              ...(active !== undefined && { active }),
            });
            return ok({ prices: prices.data, has_more: prices.has_more }, `Found ${prices.data.length} price(s)`);
          }
        }
      } catch (e) { return err(e); }
    }
  );

  // ── Query (read-only, per-resource correct filters) ─────────────────────────

  server.tool("stripe_query",
    "Query Stripe data. Each resource supports its own valid filters — do not mix filter types across resources. For finding a customer by email, use stripe_customers with action=search instead.",
    {
      resource: z.enum(['events', 'charges', 'payment_intents', 'invoices', 'subscriptions', 'customers', 'products', 'prices']),
      // customer filter — valid for: charges, payment_intents, invoices, subscriptions
      customer_id: z.string().optional().describe("Filter by customer ID. Valid for: charges, payment_intents, invoices, subscriptions"),
      // status — valid per resource: charges(succeeded/failed/pending), payment_intents(requires_payment_method/.../succeeded), invoices(draft/open/paid/uncollectible/void), subscriptions(active/past_due/unpaid/canceled/trialing/all)
      status: z.string().optional().describe("Filter by status. Valid values depend on resource. subscriptions: active|past_due|canceled|trialing. invoices: draft|open|paid. charges: succeeded|failed|pending"),
      // event type filter — valid for events only
      event_type: z.string().optional().describe("Filter events by type, e.g. 'payment_intent.succeeded'. Only valid for resource=events"),
      // product filter — valid for prices only
      product_id: z.string().optional().describe("Filter prices by product ID. Only valid for resource=prices"),
      // time range
      created_gte: z.number().optional().describe("Unix timestamp — only records created at or after this time"),
      created_lte: z.number().optional().describe("Unix timestamp — only records created at or before this time"),
      limit: z.number().optional().describe("Max results (default 10, max 100)"),
      expand: z.array(z.string()).optional().describe("Fields to expand, e.g. ['data.customer', 'data.payment_intent']"),
    },
    async ({ resource, customer_id, status, event_type, product_id, created_gte, created_lte, limit = 10, expand }) => {
      try {
        const validLimit = Math.min(Math.max(limit, 1), 100);
        const created = (created_gte || created_lte) ? {
          ...(created_gte && { gte: created_gte }),
          ...(created_lte && { lte: created_lte }),
        } : undefined;

        // Per-resource correct filter mapping
        let result: Stripe.ApiList<Stripe.StripeRawList['data'][0]>;

        switch (resource) {
          case 'events':
            result = await stripe.events.list({
              limit: validLimit,
              ...(event_type && { type: event_type }),
              ...(created && { created }),
              ...(expand && { expand }),
            });
            break;
          case 'charges':
            result = await stripe.charges.list({
              limit: validLimit,
              ...(customer_id && { customer: customer_id }),
              ...(created && { created }),
              ...(expand && { expand }),
            });
            break;
          case 'payment_intents':
            result = await stripe.paymentIntents.list({
              limit: validLimit,
              ...(customer_id && { customer: customer_id }),
              ...(created && { created }),
              ...(expand && { expand }),
            });
            break;
          case 'invoices':
            result = await stripe.invoices.list({
              limit: validLimit,
              ...(customer_id && { customer: customer_id }),
              ...(status && { status: status as Stripe.InvoiceListParams.Status }),
              ...(created && { created }),
              ...(expand && { expand }),
            });
            break;
          case 'subscriptions':
            result = await stripe.subscriptions.list({
              limit: validLimit,
              ...(customer_id && { customer: customer_id }),
              ...(status && { status: status as Stripe.SubscriptionListParams.Status }),
              ...(created && { created }),
              ...(expand && { expand }),
            });
            break;
          case 'customers':
            // customers.list does NOT support status or customer filter
            // Use stripe_customers action=search to find by email
            result = await stripe.customers.list({
              limit: validLimit,
              ...(created && { created }),
              ...(expand && { expand }),
            });
            break;
          case 'products':
            result = await stripe.products.list({
              limit: validLimit,
              ...(created && { created }),
              ...(expand && { expand }),
            });
            break;
          case 'prices':
            result = await stripe.prices.list({
              limit: validLimit,
              ...(product_id && { product: product_id }),
              ...(created && { created }),
              ...(expand && { expand }),
            });
            break;
          default:
            return err(`Unknown resource: ${resource}`);
        }

        return ok({
          resource,
          count: result.data.length,
          has_more: result.has_more,
          data: result.data,
        }, `Found ${result.data.length} ${resource} record(s)${result.has_more ? ' (more available, use created_lte to paginate)' : ''}`);

      } catch (e) { return err(e); }
    }
  );

  // ── Webhooks ───────────────────────────────────────────────────────────────

  server.tool("stripe_webhooks",
    "Manage Stripe webhook endpoints. Actions: create, retrieve, update, delete, list.",
    {
      action: z.enum(['create', 'retrieve', 'update', 'delete', 'list']),
      webhook_id: z.string().optional().describe("Webhook endpoint ID (required for retrieve, update, delete)"),
      url: z.string().optional().describe("HTTPS URL to send events to (required for create)"),
      enabled_events: z.array(z.string()).optional().describe("Event types to subscribe to, e.g. ['payment_intent.succeeded']. Use ['*'] for all events."),
      description: z.string().optional().describe("Description of the webhook"),
      enabled: z.boolean().optional().describe("Enable or disable the endpoint (for update)"),
    },
    async ({ action, webhook_id, url, enabled_events, description, enabled }) => {
      try {
        switch (action) {
          case 'create': {
            if (!url || !enabled_events) return err('url and enabled_events are required for create');
            if (!url.startsWith('https://')) return err('Webhook URL must start with https://');
            const webhook = await stripe.webhookEndpoints.create({
              url,
              enabled_events: enabled_events as Stripe.WebhookEndpointCreateParams.EnabledEvent[],
              ...(description && { description }),
            });
            return ok(webhook, `Created webhook endpoint ${webhook.id}: ${webhook.url}`);
          }
          case 'retrieve': {
            if (!webhook_id) return err('webhook_id is required for retrieve');
            return ok(await stripe.webhookEndpoints.retrieve(webhook_id));
          }
          case 'update': {
            if (!webhook_id) return err('webhook_id is required for update');
            const webhook = await stripe.webhookEndpoints.update(webhook_id, {
              ...(url && { url }),
              ...(enabled_events && { enabled_events: enabled_events as Stripe.WebhookEndpointUpdateParams.EnabledEvent[] }),
              ...(description !== undefined && { description }),
              ...(enabled !== undefined && { disabled: !enabled }),
            });
            return ok(webhook, `Updated webhook ${webhook_id}`);
          }
          case 'delete': {
            if (!webhook_id) return err('webhook_id is required for delete');
            return ok(await stripe.webhookEndpoints.del(webhook_id), `Deleted webhook ${webhook_id}`);
          }
          case 'list': {
            const webhooks = await stripe.webhookEndpoints.list({ limit: 100 });
            return ok({ webhooks: webhooks.data }, `Found ${webhooks.data.length} webhook(s)`);
          }
        }
      } catch (e) { return err(e); }
    }
  );

  // ── Refunds ────────────────────────────────────────────────────────────────

  server.tool("stripe_refunds",
    "Issue and view refunds. Refund a charge fully or partially. Actions: create, retrieve, list.",
    {
      action: z.enum(['create', 'retrieve', 'list']),
      charge_id: z.string().optional().describe("Charge ID to refund (required for create, e.g. ch_xxx or py_xxx)"),
      payment_intent_id: z.string().optional().describe("Payment Intent ID to refund (alternative to charge_id for create)"),
      refund_id: z.string().optional().describe("Refund ID (required for retrieve)"),
      amount: z.number().optional().describe("Amount in cents to refund. Omit to refund full amount."),
      reason: z.enum(['duplicate', 'fraudulent', 'requested_by_customer']).optional().describe("Reason for refund"),
      customer_id: z.string().optional().describe("Filter refunds by customer (for list)"),
      limit: z.number().optional().describe("Max results for list (default 10, max 100)"),
    },
    async ({ action, charge_id, payment_intent_id, refund_id, amount, reason, limit = 10 }) => {
      try {
        const validLimit = Math.min(Math.max(limit, 1), 100);
        switch (action) {
          case 'create': {
            if (!charge_id && !payment_intent_id) return err('charge_id or payment_intent_id is required for create');
            const refund = await stripe.refunds.create({
              ...(charge_id && { charge: charge_id }),
              ...(payment_intent_id && { payment_intent: payment_intent_id }),
              ...(amount && { amount }),
              ...(reason && { reason }),
            });
            const display = amount ? `$${amount / 100}` : 'full amount';
            return ok(refund, `Refund ${refund.id} created for ${display} (status: ${refund.status})`);
          }
          case 'retrieve': {
            if (!refund_id) return err('refund_id is required for retrieve');
            return ok(await stripe.refunds.retrieve(refund_id));
          }
          case 'list': {
            const refunds = await stripe.refunds.list({ limit: validLimit });
            return ok({ refunds: refunds.data, has_more: refunds.has_more }, `Found ${refunds.data.length} refund(s)`);
          }
        }
      } catch (e) { return err(e); }
    }
  );

  // ── Invoices ───────────────────────────────────────────────────────────────

  server.tool("stripe_invoices",
    "Create and manage one-off invoices. Actions: create (creates a draft), add_item (adds a line item to draft), finalize (locks and opens for payment), send (emails to customer + returns hosted URL), pay (charge immediately), void, retrieve, list. Typical flow: create → add_item → finalize → send.",
    {
      action: z.enum(['create', 'add_item', 'finalize', 'send', 'pay', 'void', 'retrieve', 'list']),
      invoice_id: z.string().optional().describe("Invoice ID (required for add_item, finalize, send, pay, void, retrieve)"),
      customer_id: z.string().optional().describe("Customer ID (required for create, optional filter for list)"),
      description: z.string().optional().describe("Invoice description / memo (for create)"),
      days_until_due: z.number().optional().describe("Days until payment is due when sending invoice (default 30)"),
      // add_item params
      amount: z.number().optional().describe("Line item amount in cents (required for add_item)"),
      currency: z.string().optional().describe("Currency code for line item (default: usd)"),
      item_description: z.string().optional().describe("Line item description (for add_item)"),
      // list params
      status: z.enum(['draft', 'open', 'paid', 'uncollectible', 'void']).optional().describe("Filter invoices by status (for list)"),
      limit: z.number().optional().describe("Max results for list (default 10, max 100)"),
    },
    async ({ action, invoice_id, customer_id, description, days_until_due = 30, amount, currency = 'usd', item_description, status, limit = 10 }) => {
      try {
        const validLimit = Math.min(Math.max(limit, 1), 100);
        switch (action) {
          case 'create': {
            if (!customer_id) return err('customer_id is required for create');
            const invoice = await stripe.invoices.create({
              customer: customer_id,
              collection_method: 'send_invoice',
              days_until_due,
              ...(description && { description }),
            });
            return ok(invoice, `Created draft invoice ${invoice.id}. Add items with add_item, then finalize and send.`);
          }
          case 'add_item': {
            if (!invoice_id || !amount) return err('invoice_id and amount are required for add_item');
            if (!customer_id) return err('customer_id is required for add_item');
            const item = await stripe.invoiceItems.create({
              customer: customer_id,
              invoice: invoice_id,
              amount,
              currency,
              ...(item_description && { description: item_description }),
            });
            return ok(item, `Added line item $${amount / 100} to invoice ${invoice_id}`);
          }
          case 'finalize': {
            if (!invoice_id) return err('invoice_id is required for finalize');
            const invoice = await stripe.invoices.finalizeInvoice(invoice_id);
            return ok(invoice, `Invoice ${invoice_id} finalized — amount due: $${(invoice.amount_due ?? 0) / 100}`);
          }
          case 'send': {
            if (!invoice_id) return err('invoice_id is required for send');
            const invoice = await stripe.invoices.sendInvoice(invoice_id);
            return ok({
              id: invoice.id,
              status: invoice.status,
              hosted_invoice_url: invoice.hosted_invoice_url,
              amount_due: invoice.amount_due,
            }, `Invoice sent. Customer payment URL: ${invoice.hosted_invoice_url}`);
          }
          case 'pay': {
            if (!invoice_id) return err('invoice_id is required for pay');
            const invoice = await stripe.invoices.pay(invoice_id);
            return ok(invoice, `Invoice ${invoice_id} paid (status: ${invoice.status})`);
          }
          case 'void': {
            if (!invoice_id) return err('invoice_id is required for void');
            const invoice = await stripe.invoices.voidInvoice(invoice_id);
            return ok(invoice, `Invoice ${invoice_id} voided`);
          }
          case 'retrieve': {
            if (!invoice_id) return err('invoice_id is required for retrieve');
            return ok(await stripe.invoices.retrieve(invoice_id));
          }
          case 'list': {
            const invoices = await stripe.invoices.list({
              limit: validLimit,
              ...(customer_id && { customer: customer_id }),
              ...(status && { status }),
            });
            return ok({ invoices: invoices.data, has_more: invoices.has_more }, `Found ${invoices.data.length} invoice(s)`);
          }
        }
      } catch (e) { return err(e); }
    }
  );

  // ── Billing Portal Session ─────────────────────────────────────────────────

  server.tool("stripe_billing_portal_session",
    "Create a Stripe Billing Portal session URL for a specific customer. Returns a URL you can send to the customer so they can self-manage their subscription, update payment methods, view invoices, and cancel. Requires a billing portal configuration to exist (use stripe_portal_config to create one).",
    {
      customer_id: z.string().describe("Customer ID to create the portal session for"),
      return_url: z.string().optional().describe("URL to redirect the customer after they leave the portal (e.g. 'https://yourapp.com/account')"),
    },
    async ({ customer_id, return_url }) => {
      try {
        const session = await stripe.billingPortal.sessions.create({
          customer: customer_id,
          ...(return_url && { return_url }),
        });
        return ok({
          url: session.url,
          customer: session.customer,
          created: session.created,
        }, `Portal session created. Send this URL to the customer: ${session.url}`);
      } catch (e) { return err(e); }
    }
  );

  // ── Checkout Sessions ──────────────────────────────────────────────────────

  server.tool("stripe_checkout",
    "Create a Stripe Checkout session — generates a hosted payment URL. Use mode=payment for one-time purchases, mode=subscription for recurring, mode=setup to save a payment method. Returns a URL to redirect the customer to.",
    {
      mode: z.enum(['payment', 'subscription', 'setup']).describe("payment = one-time, subscription = recurring, setup = save payment method only"),
      price_id: z.string().optional().describe("Stripe Price ID to checkout (for payment or subscription mode)"),
      quantity: z.number().optional().describe("Quantity of the price (default 1)"),
      success_url: z.string().describe("URL to redirect after successful payment (required)"),
      cancel_url: z.string().describe("URL to redirect if customer cancels (required)"),
      customer_id: z.string().optional().describe("Existing customer ID to associate with the session"),
      customer_email: z.string().optional().describe("Pre-fill customer email"),
      allow_promotion_codes: z.boolean().optional().describe("Whether to allow promo codes at checkout (default false)"),
      metadata: z.string().optional().describe("JSON string of metadata key-value pairs"),
    },
    async ({ mode, price_id, quantity = 1, success_url, cancel_url, customer_id, customer_email, allow_promotion_codes, metadata }) => {
      try {
        const meta = metadata ? JSON.parse(metadata) : undefined;
        const session = await stripe.checkout.sessions.create({
          mode,
          success_url,
          cancel_url,
          ...(price_id && { line_items: [{ price: price_id, quantity }] }),
          ...(customer_id && { customer: customer_id }),
          ...(customer_email && !customer_id && { customer_email }),
          ...(allow_promotion_codes && { allow_promotion_codes }),
          ...(meta && { metadata: meta }),
        });
        return ok({
          id: session.id,
          url: session.url,
          mode: session.mode,
          status: session.status,
          payment_status: session.payment_status,
        }, `Checkout session created. Payment URL: ${session.url}`);
      } catch (e) { return err(e); }
    }
  );

  // ── Balance ────────────────────────────────────────────────────────────────

  server.tool("stripe_balance",
    "Retrieve your Stripe account balance — shows available funds (ready for payout) and pending funds (still processing).",
    {},
    async () => {
      try {
        const balance = await stripe.balance.retrieve();
        const fmt = (amt: Stripe.Balance.Available[]) =>
          amt.map(a => `${a.currency.toUpperCase()}: $${a.amount / 100}`).join(', ');
        return ok({
          available: balance.available,
          pending: balance.pending,
          livemode: balance.livemode,
        }, `Available: ${fmt(balance.available)} | Pending: ${fmt(balance.pending)}`);
      } catch (e) { return err(e); }
    }
  );

  // ── Portal Config ──────────────────────────────────────────────────────────

  server.tool("stripe_portal_config",
    "Manage Stripe billing portal configurations. Actions: create, retrieve, update, list.",
    {
      action: z.enum(['create', 'retrieve', 'update', 'list']),
      configuration_id: z.string().optional().describe("Configuration ID (required for retrieve and update)"),
      default_return_url: z.string().optional().describe("Return URL after customer actions"),
      business_profile_headline: z.string().optional().describe("Headline shown in the portal"),
      invoice_history_enabled: z.boolean().optional().describe("Allow customers to view invoice history (default true)"),
      payment_method_update_enabled: z.boolean().optional().describe("Allow updating payment methods (default true)"),
      subscription_cancel_enabled: z.boolean().optional().describe("Allow canceling subscriptions (default true)"),
      subscription_pause_enabled: z.boolean().optional().describe("Allow pausing subscriptions (default false)"),
    },
    async ({ action, configuration_id, default_return_url, business_profile_headline, invoice_history_enabled = true, payment_method_update_enabled = true, subscription_cancel_enabled = true, subscription_pause_enabled = false }) => {
      try {
        const features = {
          invoice_history: { enabled: invoice_history_enabled },
          payment_method_update: { enabled: payment_method_update_enabled },
          subscription_cancel: { enabled: subscription_cancel_enabled },
          subscription_pause: { enabled: subscription_pause_enabled },
          subscription_update: { enabled: false },
        };

        switch (action) {
          case 'create': {
            const config = await stripe.billingPortal.configurations.create({
              features,
              ...(default_return_url && { default_return_url }),
              ...(business_profile_headline && { business_profile: { headline: business_profile_headline } }),
            });
            return ok(config, `Created portal configuration ${config.id}`);
          }
          case 'retrieve': {
            if (!configuration_id) return err('configuration_id is required for retrieve');
            return ok(await stripe.billingPortal.configurations.retrieve(configuration_id));
          }
          case 'update': {
            if (!configuration_id) return err('configuration_id is required for update');
            const config = await stripe.billingPortal.configurations.update(configuration_id, {
              ...(default_return_url && { default_return_url }),
              ...(business_profile_headline && { business_profile: { headline: business_profile_headline } }),
            });
            return ok(config, `Updated portal configuration ${configuration_id}`);
          }
          case 'list': {
            const configs = await stripe.billingPortal.configurations.list({ limit: 100 });
            return ok({ configurations: configs.data }, `Found ${configs.data.length} configuration(s)`);
          }
        }
      } catch (e) { return err(e); }
    }
  );
}

// ─── MCP server factory ────────────────────────────────────────────────────────

function createMcpServer(stripeClient: Stripe): McpServer {
  const server = new McpServer({ name: "stripe-mcp", version: "2.1.0" });
  addStripeTools(server, stripeClient);
  return server;
}

// ─── HTTP server ───────────────────────────────────────────────────────────────

async function main() {
  if (TRANSPORT_TYPE === 'http') {
    const { createServer } = await import('http');
    const { parse } = await import('url');

    const streamableTransports: Record<string, StreamableHTTPServerTransport> = {};
    const sseTransports: Record<string, SSEServerTransport> = {};

    const httpServer = createServer(async (req, res) => {
      const parsedUrl = parse(req.url || '', true);

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, X-Stripe-Api-Key');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

      if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

      if (parsedUrl.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'healthy', service: 'stripe-mcp', version: '2.1.0', tools: ['stripe_customers', 'stripe_subscriptions', 'stripe_products', 'stripe_prices', 'stripe_query', 'stripe_refunds', 'stripe_invoices', 'stripe_billing_portal_session', 'stripe_checkout', 'stripe_balance', 'stripe_webhooks', 'stripe_portal_config'] }));
        return;
      }

      if (parsedUrl.pathname === '/mcp') {
        if (req.method === 'POST') {
          const sessionId = req.headers['mcp-session-id'] as string | undefined;

          if (sessionId && streamableTransports[sessionId]) {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
              const requestBody = JSON.parse(body);
              await streamableTransports[sessionId].handleRequest(req, res, requestBody);
            });
            return;
          }

          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            const requestBody = JSON.parse(body);

            if (!sessionId && isInitializeRequest(requestBody)) {
              const stripeApiKey = (req.headers['x-stripe-api-key'] as string) || FALLBACK_STRIPE_SECRET_KEY;
              if (!stripeApiKey) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Stripe API key required via X-Stripe-Api-Key header' }, id: null }));
                return;
              }

              const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (sid) => { streamableTransports[sid] = transport; },
              });
              transport.onclose = () => { if (transport.sessionId) delete streamableTransports[transport.sessionId]; };

              await createMcpServer(createStripeClient(stripeApiKey)).connect(transport);
              await transport.handleRequest(req, res, requestBody);
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Invalid request' }, id: null }));
            }
          });
          return;
        }

        if (req.method === 'GET') {
          const sessionId = req.headers['mcp-session-id'] as string;
          if (!sessionId || !streamableTransports[sessionId]) {
            res.writeHead(400); res.end('Invalid session ID'); return;
          }
          await streamableTransports[sessionId].handleRequest(req, res);
          return;
        }

        if (req.method === 'DELETE') {
          const sessionId = req.headers['mcp-session-id'] as string;
          if (sessionId && streamableTransports[sessionId]) await streamableTransports[sessionId].handleRequest(req, res);
          else { res.writeHead(400); res.end('Invalid session ID'); }
          return;
        }
      }

      // Legacy SSE
      if (parsedUrl.pathname === '/sse' && req.method === 'GET') {
        const stripeApiKey = (req.headers['x-stripe-api-key'] as string) || FALLBACK_STRIPE_SECRET_KEY;
        if (!stripeApiKey) { res.writeHead(400); res.end(JSON.stringify({ error: 'X-Stripe-Api-Key header required' })); return; }
        const transport = new SSEServerTransport('/messages', res);
        sseTransports[transport.sessionId] = transport;
        res.on('close', () => { delete sseTransports[transport.sessionId]; });
        await createMcpServer(createStripeClient(stripeApiKey)).connect(transport);
        return;
      }

      if (parsedUrl.pathname === '/messages' && req.method === 'POST') {
        const sessionId = parsedUrl.query.sessionId as string;
        const transport = sseTransports[sessionId];
        if (!transport) { res.writeHead(400); res.end(JSON.stringify({ error: 'No transport found' })); return; }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => { await transport.handlePostMessage(req, res, JSON.parse(body)); });
        return;
      }

      res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' }));
    });

    httpServer.on('error', (err) => console.error('HTTP server error:', err));
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.error(`stripe-mcp v2.0.0 running on port ${PORT}`);
    });

  } else {
    if (!defaultStripe) { console.error("STRIPE_SECRET_KEY required for stdio mode"); process.exit(1); }
    const transport = new StdioServerTransport();
    await createMcpServer(defaultStripe).connect(transport);
    console.error("stripe-mcp running on stdio");
  }
}

main().catch((e) => { console.error("Failed to start:", e); process.exit(1); });
