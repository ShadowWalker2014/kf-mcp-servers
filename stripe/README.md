# stripe

HTTP MCP server for Stripe. Manage products, prices, webhooks, billing portal, and query events/charges/subscriptions. Pass your Stripe secret key per request.

## Tools

| Tool | Description |
|------|-------------|
| `stripe_products` | Create, list, retrieve, update, archive products |
| `stripe_prices` | Create, list, retrieve, update, archive prices |
| `stripe_webhooks` | Create, list, retrieve, update, delete webhook endpoints |
| `stripe_portal_config` | Create, list, retrieve, update billing portal configurations |
| `stripe_query` | Query events, charges, payment_intents, customers, subscriptions, invoices, products, prices with filters |

## Auth

| Header | Purpose |
|--------|---------|
| `X-Stripe-Api-Key: sk_live_...` | Stripe secret key (used for all API calls) |

The `X-Stripe-Api-Key` header takes priority over the `STRIPE_SECRET_KEY` env var. Each client passes their own key — fully multi-tenant.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `STRIPE_SECRET_KEY` | No | Default key if no `X-Stripe-Api-Key` header |
| `TRANSPORT_TYPE` | Yes (set to `http`) | Must be `http` for server mode |
| `PORT` | No | Defaults to `3300` |

## Cursor config

```json
"stripe": {
  "url": "https://stripe-production-bc3a.up.railway.app/mcp",
  "headers": {
    "X-Stripe-Api-Key": "sk_live_..."
  }
}
```

## Local dev

```bash
npm install
TRANSPORT_TYPE=http STRIPE_SECRET_KEY=sk_test_... npm run dev
```

Health check: `GET http://localhost:3300/health`

## Railway deployment

- **Root Directory**: `stripe/`
- **Env vars**: `TRANSPORT_TYPE=http` (required), `STRIPE_SECRET_KEY` (optional default key)
- **Runtime**: Uses `tsx` directly (no compiled build step)
