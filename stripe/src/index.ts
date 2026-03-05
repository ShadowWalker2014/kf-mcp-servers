#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import Stripe from "stripe";

// Parse command line arguments
function parseArgs() {
 const args = process.argv.slice(2);
 const config: {
 apiKey?: string;
 publishableKey?: string;
 webhookSecret?: string;
 tools?: string;
 transport?: 'stdio' | 'http';
 port?: number;
 } = {};

 for (let i = 0; i < args.length; i++) {
 const arg = args[i];
 if (arg.startsWith('--api-key=')) {
 config.apiKey = arg.split('=')[1];
 } else if (arg === '--api-key' && i + 1 < args.length) {
 config.apiKey = args[++i];
 } else if (arg.startsWith('--publishable-key=')) {
 config.publishableKey = arg.split('=')[1];
 } else if (arg === '--publishable-key' && i + 1 < args.length) {
 config.publishableKey = args[++i];
 } else if (arg.startsWith('--webhook-secret=')) {
 config.webhookSecret = arg.split('=')[1];
 } else if (arg === '--webhook-secret' && i + 1 < args.length) {
 config.webhookSecret = args[++i];
 } else if (arg.startsWith('--tools=')) {
 config.tools = arg.split('=')[1];
 } else if (arg === '--tools' && i + 1 < args.length) {
 config.tools = args[++i];
 } else if (arg.startsWith('--transport=')) {
 config.transport = arg.split('=')[1] as 'stdio' | 'http';
 } else if (arg === '--transport' && i + 1 < args.length) {
 config.transport = args[++i] as 'stdio' | 'http';
 } else if (arg.startsWith('--port=')) {
 config.port = parseInt(arg.split('=')[1], 10);
 } else if (arg === '--port' && i + 1 < args.length) {
 config.port = parseInt(args[++i], 10);
 }
 }

 return config;
}

const cliArgs = parseArgs();

// Get configuration from CLI args or environment variables
const FALLBACK_STRIPE_SECRET_KEY = cliArgs.apiKey || process.env.STRIPE_SECRET_KEY;
const STRIPE_PUBLISHABLE_KEY = cliArgs.publishableKey || process.env.STRIPE_PUBLISHABLE_KEY;
const STRIPE_WEBHOOK_SECRET = cliArgs.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET;
const TRANSPORT_TYPE = cliArgs.transport || process.env.TRANSPORT_TYPE || 'stdio';
const PORT = cliArgs.port || parseInt(process.env.PORT || '8080', 10);

// For stdio mode, require the API key upfront
if (TRANSPORT_TYPE === 'stdio' && !FALLBACK_STRIPE_SECRET_KEY) {
 console.error("Stripe API key is required for stdio mode. Provide it via --api-key argument or STRIPE_SECRET_KEY environment variable");
 process.exit(1);
}

// For HTTP mode, we don't require API key upfront - users provide it per request

// Create Stripe client factory function
function createStripeClient(apiKey: string) {
 return new Stripe(apiKey, {
 apiVersion: '2025-05-28.basil',
 typescript: true
 });
}

// For stdio mode, create default client
const defaultStripe = FALLBACK_STRIPE_SECRET_KEY ? createStripeClient(FALLBACK_STRIPE_SECRET_KEY) : null;

// Create MCP server factory function
function createMcpServer(stripeClient: Stripe) {
 const server = new McpServer({
 name: "stripe-mcp-server",
 version: "1.0.0"
 });

 // Add all the Stripe tools using the provided client
 addStripeTools(server, stripeClient);
 return server;
}

// Function to add all Stripe tools to a server
function addStripeTools(server: McpServer, stripe: Stripe) {
 // Helper function to handle errors consistently
 function handleError(error: unknown): { success: false; error: string } {
 console.error('Stripe MCP Server Error:', error);
 return { 
 success: false, 
 error: error instanceof Error ? error.message : String(error) 
 };
 }

// Stripe Connect Tool
server.tool(
 "stripe_connect",
 {
 purpose: z.string().describe("Explanation of why Stripe connection is needed for this specific feature or use case"),
 features: z.array(z.string()).describe("List of Stripe features that will be used (e.g., 'payments', 'subscriptions', 'products', 'customers', 'webhooks')")
 },
 async ({ purpose, features }) => {
 return {
 content: [{
 type: "text",
 text: `Stripe connection requested for: ${purpose}\nFeatures needed: ${features.join(', ')}\n\nPlease ensure the following environment variables are set:\n- STRIPE_SECRET_KEY\n- STRIPE_PUBLISHABLE_KEY (optional)\n- STRIPE_WEBHOOK_SECRET (optional)`
 }]
 };
 }
);

// Stripe Products Tool
server.tool(
 "stripe_products",
 {
 action: z.enum(['create', 'list', 'retrieve', 'update', 'archive']).describe("The action to perform on products"),
 product_id: z.string().optional().describe("Product ID (required for retrieve, update, archive actions)"),
 name: z.string().optional().describe("Product name (required for create, optional for update)"),
 description: z.string().optional().describe("Product description (optional)"),
 images: z.array(z.string()).optional().describe("Array of image URLs (optional)"),
 metadata: z.string().optional().describe("JSON string of key-value metadata object (optional, e.g., '{\"category\":\"premium\"}')"),
 active: z.boolean().optional().describe("Whether the product is active (optional, for update)")
 },
 async ({ action, product_id, name, description, images, metadata, active }) => {
 try {
 // Parse metadata if provided
 let parsedMetadata: Record | undefined;
 if (metadata) {
 try {
 parsedMetadata = JSON.parse(metadata);
 } catch (error) {
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ success: false, error: 'Invalid metadata JSON format' }, null, 2)
 }]
 };
 }
 }
 
 switch (action) {
 case 'create':
 if (!name) {
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ success: false, error: 'Product name is required for create action' }, null, 2)
 }]
 };
 }
 
 const createParams: any = { name };
 if (description) createParams.description = description;
 if (images) createParams.images = images;
 if (parsedMetadata) createParams.metadata = parsedMetadata;
 
 const product = await stripe.products.create(createParams);
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ 
 success: true, 
 product,
 message: `Successfully created product: ${product.name}`
 }, null, 2)
 }]
 };
 
 case 'list':
 const products = await stripe.products.list({ limit: 100 });
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ 
 success: true, 
 products: products.data,
 message: `Found ${products.data.length} product(s)`
 }, null, 2)
 }]
 };
 
 case 'retrieve':
 if (!product_id) {
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ success: false, error: 'Product ID is required for retrieve action' }, null, 2)
 }]
 };
 }
 
 const retrievedProduct = await stripe.products.retrieve(product_id);
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ 
 success: true, 
 product: retrievedProduct,
 message: `Retrieved product: ${retrievedProduct.name}`
 }, null, 2)
 }]
 };
 
 case 'update':
 if (!product_id) {
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ success: false, error: 'Product ID is required for update action' }, null, 2)
 }]
 };
 }
 
 const updateParams: any = {};
 if (name) updateParams.name = name;
 if (description !== undefined) updateParams.description = description;
 if (images) updateParams.images = images;
 if (parsedMetadata) updateParams.metadata = parsedMetadata;
 if (active !== undefined) updateParams.active = active;
 
 const updatedProduct = await stripe.products.update(product_id, updateParams);
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ 
 success: true, 
 product: updatedProduct,
 message: `Successfully updated product: ${updatedProduct.name}`
 }, null, 2)
 }]
 };
 
 case 'archive':
 if (!product_id) {
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ success: false, error: 'Product ID is required for archive action' }, null, 2)
 }]
 };
 }
 
 const archivedProduct = await stripe.products.update(product_id, { active: false });
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ 
 success: true, 
 product: archivedProduct,
 message: `Successfully archived product: ${archivedProduct.name}`
 }, null, 2)
 }]
 };
 
 default:
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ success: false, error: `Unknown action: ${action}` }, null, 2)
 }]
 };
 }
 } catch (error) {
 return {
 content: [{
 type: "text",
 text: JSON.stringify(handleError(error), null, 2)
 }]
 };
 }
 }
);

// Stripe Prices Tool
server.tool(
 "stripe_prices",
 {
 action: z.enum(['create', 'list', 'retrieve', 'update', 'archive']).describe("The action to perform on prices"),
 price_id: z.string().optional().describe("Price ID (required for retrieve, update, archive actions)"),
 product_id: z.string().optional().describe("Product ID (required for create action)"),
 unit_amount: z.number().optional().describe("Price in cents (e.g., 2000 for $20.00, required for create)"),
 currency: z.string().optional().describe("Currency code (e.g., 'usd', defaults to 'usd')"),
 recurring_interval: z.enum(['day', 'week', 'month', 'year']).optional().describe("Billing interval for subscriptions (optional for one-time payments)"),
 recurring_interval_count: z.number().optional().describe("Number of intervals between billings (defaults to 1)"),
 metadata: z.string().optional().describe("JSON string of key-value metadata object (optional, e.g., '{\"plan\":\"pro\"}')"),
 active: z.boolean().optional().describe("Whether the price is active (optional, for update/archive)")
 },
 async ({ action, price_id, product_id, unit_amount, currency = 'usd', recurring_interval, recurring_interval_count = 1, metadata, active }) => {
 try {
 // Parse metadata if provided
 let parsedMetadata: Record | undefined;
 if (metadata) {
 try {
 parsedMetadata = JSON.parse(metadata);
 } catch (error) {
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ success: false, error: 'Invalid metadata JSON format' }, null, 2)
 }]
 };
 }
 }
 
 switch (action) {
 case 'create':
 if (!product_id || !unit_amount) {
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ success: false, error: 'Product ID and unit_amount are required for create action' }, null, 2)
 }]
 };
 }
 
 const createParams: any = {
 product: product_id,
 unit_amount,
 currency
 };
 
 if (recurring_interval) {
 createParams.recurring = {
 interval: recurring_interval,
 interval_count: recurring_interval_count
 };
 }
 
 if (parsedMetadata) createParams.metadata = parsedMetadata;
 
 const price = await stripe.prices.create(createParams);
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ 
 success: true, 
 price,
 message: `Successfully created price: ${price.unit_amount ? (price.unit_amount / 100) : 'custom'} ${price.currency.toUpperCase()}${price.recurring ? ` per ${price.recurring.interval}` : ''}`
 }, null, 2)
 }]
 };
 
 case 'list':
 const listParams: any = { limit: 100 };
 if (product_id) listParams.product = product_id;
 
 const prices = await stripe.prices.list(listParams);
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ 
 success: true, 
 prices: prices.data,
 message: `Found ${prices.data.length} price(s)`
 }, null, 2)
 }]
 };
 
 case 'retrieve':
 if (!price_id) {
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ success: false, error: 'Price ID is required for retrieve action' }, null, 2)
 }]
 };
 }
 
 const retrievedPrice = await stripe.prices.retrieve(price_id);
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ 
 success: true, 
 price: retrievedPrice,
 message: `Retrieved price: ${retrievedPrice.unit_amount ? (retrievedPrice.unit_amount / 100) : 'custom'} ${retrievedPrice.currency.toUpperCase()}`
 }, null, 2)
 }]
 };
 
 case 'update':
 if (!price_id) {
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ success: false, error: 'Price ID is required for update action' }, null, 2)
 }]
 };
 }
 
 const updateParams: any = {};
 if (parsedMetadata) updateParams.metadata = parsedMetadata;
 if (active !== undefined) updateParams.active = active;
 
 const updatedPrice = await stripe.prices.update(price_id, updateParams);
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ 
 success: true, 
 price: updatedPrice,
 message: `Successfully updated price: ${updatedPrice.unit_amount ? (updatedPrice.unit_amount / 100) : 'custom'} ${updatedPrice.currency.toUpperCase()}`
 }, null, 2)
 }]
 };
 
 case 'archive':
 if (!price_id) {
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ success: false, error: 'Price ID is required for archive action' }, null, 2)
 }]
 };
 }
 
 const archivedPrice = await stripe.prices.update(price_id, { active: false });
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ 
 success: true, 
 price: archivedPrice,
 message: `Successfully archived price: ${archivedPrice.unit_amount ? (archivedPrice.unit_amount / 100) : 'custom'} ${archivedPrice.currency.toUpperCase()}`
 }, null, 2)
 }]
 };
 
 default:
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ success: false, error: `Unknown action: ${action}` }, null, 2)
 }]
 };
 }
 } catch (error) {
 return {
 content: [{
 type: "text",
 text: JSON.stringify(handleError(error), null, 2)
 }]
 };
 }
 }
);

// Stripe Webhooks Tool
server.tool(
 "stripe_webhooks",
 {
 action: z.enum(['create', 'list', 'retrieve', 'update', 'delete']).describe("The action to perform on webhook endpoints"),
 webhook_id: z.string().optional().describe("Webhook endpoint ID (required for retrieve, update, delete actions)"),
 url: z.string().optional().describe("The URL to send webhook events to (required for create, must start with https://)"),
 enabled_events: z.array(z.string()).optional().describe("Array of events to subscribe to (required for create, e.g., ['payment_intent.succeeded', 'customer.subscription.created'])"),
 description: z.string().optional().describe("Description of the webhook endpoint (optional)"),
 enabled: z.boolean().optional().describe("Whether the webhook endpoint is enabled (optional, for update)")
 },
 async ({ action, webhook_id, url, enabled_events, description, enabled }) => {
 try {
 switch (action) {
 case 'create':
 if (!url || !enabled_events) {
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ success: false, error: 'URL and enabled_events are required for create action' }, null, 2)
 }]
 };
 }
 
 if (!url.startsWith('https://')) {
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ success: false, error: 'Webhook URL must start with https://' }, null, 2)
 }]
 };
 }
 
 const createParams: any = {
 url,
 enabled_events
 };
 
 if (description) createParams.description = description;
 
 const webhook = await stripe.webhookEndpoints.create(createParams);
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ 
 success: true, 
 webhook,
 message: `Successfully created webhook endpoint: ${webhook.url}`
 }, null, 2)
 }]
 };
 
 case 'list':
 const webhooks = await stripe.webhookEndpoints.list({ limit: 100 });
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ 
 success: true, 
 webhooks: webhooks.data,
 message: `Found ${webhooks.data.length} webhook endpoint(s)`
 }, null, 2)
 }]
 };
 
 case 'retrieve':
 if (!webhook_id) {
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ success: false, error: 'Webhook ID is required for retrieve action' }, null, 2)
 }]
 };
 }
 
 const retrievedWebhook = await stripe.webhookEndpoints.retrieve(webhook_id);
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ 
 success: true, 
 webhook: retrievedWebhook,
 message: `Retrieved webhook endpoint: ${retrievedWebhook.url}`
 }, null, 2)
 }]
 };
 
 case 'update':
 if (!webhook_id) {
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ success: false, error: 'Webhook ID is required for update action' }, null, 2)
 }]
 };
 }
 
 const updateParams: any = {};
 if (url) updateParams.url = url;
 if (enabled_events) updateParams.enabled_events = enabled_events;
 if (description !== undefined) updateParams.description = description;
 if (enabled !== undefined) updateParams.disabled = !enabled;
 
 const updatedWebhook = await stripe.webhookEndpoints.update(webhook_id, updateParams);
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ 
 success: true, 
 webhook: updatedWebhook,
 message: `Successfully updated webhook endpoint: ${updatedWebhook.url}`
 }, null, 2)
 }]
 };
 
 case 'delete':
 if (!webhook_id) {
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ success: false, error: 'Webhook ID is required for delete action' }, null, 2)
 }]
 };
 }
 
 const deletedWebhook = await stripe.webhookEndpoints.del(webhook_id);
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ 
 success: true, 
 webhook: deletedWebhook,
 message: `Successfully deleted webhook endpoint`
 }, null, 2)
 }]
 };
 
 default:
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ success: false, error: `Unknown action: ${action}` }, null, 2)
 }]
 };
 }
 } catch (error) {
 return {
 content: [{
 type: "text",
 text: JSON.stringify(handleError(error), null, 2)
 }]
 };
 }
 }
);

// Stripe Portal Config Tool
server.tool(
 "stripe_portal_config",
 {
 action: z.enum(['create', 'list', 'retrieve', 'update']).describe("The action to perform on portal configurations"),
 configuration_id: z.string().optional().describe("Configuration ID (required for retrieve and update actions)"),
 business_profile_headline: z.string().optional().describe("Headline for the business profile (optional)"),
 business_profile_privacy_policy_url: z.string().optional().describe("URL to privacy policy (optional, must start with https://)"),
 business_profile_terms_of_service_url: z.string().optional().describe("URL to terms of service (optional, must start with https://)"),
 default_return_url: z.string().optional().describe("Default return URL after customer actions (optional, must start with https://)"),
 features_customer_update_allowed_updates: z.array(z.enum(['email', 'name', 'phone', 'address', 'shipping', 'tax_id'])).optional().describe("Which customer details can be updated (optional)"),
 features_invoice_history_enabled: z.boolean().optional().describe("Whether customers can view invoice history (defaults to true)"),
 features_payment_method_update_enabled: z.boolean().optional().describe("Whether customers can update payment methods (defaults to true)"),
 features_subscription_cancel_enabled: z.boolean().optional().describe("Whether customers can cancel subscriptions (defaults to true)"),
 features_subscription_pause_enabled: z.boolean().optional().describe("Whether customers can pause subscriptions (defaults to false)"),
 features_subscription_update_enabled: z.boolean().optional().describe("Whether customers can update subscriptions (defaults to true)")
 },
 async ({ 
 action, 
 configuration_id, 
 business_profile_headline,
 business_profile_privacy_policy_url,
 business_profile_terms_of_service_url,
 default_return_url,
 features_customer_update_allowed_updates,
 features_invoice_history_enabled = true,
 features_payment_method_update_enabled = true,
 features_subscription_cancel_enabled = true,
 features_subscription_pause_enabled = false,
 features_subscription_update_enabled = true
 }) => {
 try {
 switch (action) {
 case 'create':
 const createParams: any = {
 features: {
 invoice_history: { enabled: features_invoice_history_enabled },
 payment_method_update: { enabled: features_payment_method_update_enabled },
 subscription_cancel: { enabled: features_subscription_cancel_enabled },
 subscription_pause: { enabled: features_subscription_pause_enabled },
 subscription_update: { enabled: features_subscription_update_enabled }
 }
 };
 
 if (business_profile_headline || business_profile_privacy_policy_url || business_profile_terms_of_service_url) {
 createParams.business_profile = {};
 if (business_profile_headline) createParams.business_profile.headline = business_profile_headline;
 if (business_profile_privacy_policy_url) createParams.business_profile.privacy_policy_url = business_profile_privacy_policy_url;
 if (business_profile_terms_of_service_url) createParams.business_profile.terms_of_service_url = business_profile_terms_of_service_url;
 }
 
 if (default_return_url) createParams.default_return_url = default_return_url;
 
 if (features_customer_update_allowed_updates) {
 createParams.features.customer_update = {
 enabled: true,
 allowed_updates: features_customer_update_allowed_updates
 };
 }
 
 const configuration = await stripe.billingPortal.configurations.create(createParams);
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ 
 success: true, 
 configuration,
 message: `Successfully created portal configuration: ${configuration.id}`
 }, null, 2)
 }]
 };
 
 case 'list':
 const configurations = await stripe.billingPortal.configurations.list({ limit: 100 });
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ 
 success: true, 
 configurations: configurations.data,
 message: `Found ${configurations.data.length} portal configuration(s)`
 }, null, 2)
 }]
 };
 
 case 'retrieve':
 if (!configuration_id) {
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ success: false, error: 'Configuration ID is required for retrieve action' }, null, 2)
 }]
 };
 }
 
 const retrievedConfig = await stripe.billingPortal.configurations.retrieve(configuration_id);
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ 
 success: true, 
 configuration: retrievedConfig,
 message: `Retrieved portal configuration: ${retrievedConfig.id}`
 }, null, 2)
 }]
 };
 
 case 'update':
 if (!configuration_id) {
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ success: false, error: 'Configuration ID is required for update action' }, null, 2)
 }]
 };
 }
 
 const updateParams: any = {};
 
 if (business_profile_headline || business_profile_privacy_policy_url || business_profile_terms_of_service_url) {
 updateParams.business_profile = {};
 if (business_profile_headline) updateParams.business_profile.headline = business_profile_headline;
 if (business_profile_privacy_policy_url) updateParams.business_profile.privacy_policy_url = business_profile_privacy_policy_url;
 if (business_profile_terms_of_service_url) updateParams.business_profile.terms_of_service_url = business_profile_terms_of_service_url;
 }
 
 if (default_return_url) updateParams.default_return_url = default_return_url;
 
 updateParams.features = {
 invoice_history: { enabled: features_invoice_history_enabled },
 payment_method_update: { enabled: features_payment_method_update_enabled },
 subscription_cancel: { enabled: features_subscription_cancel_enabled },
 subscription_pause: { enabled: features_subscription_pause_enabled },
 subscription_update: { enabled: features_subscription_update_enabled }
 };
 
 if (features_customer_update_allowed_updates) {
 updateParams.features.customer_update = {
 enabled: true,
 allowed_updates: features_customer_update_allowed_updates
 };
 }
 
 const updatedConfig = await stripe.billingPortal.configurations.update(configuration_id, updateParams);
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ 
 success: true, 
 configuration: updatedConfig,
 message: `Successfully updated portal configuration: ${updatedConfig.id}`
 }, null, 2)
 }]
 };
 
 default:
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ success: false, error: `Unknown action: ${action}` }, null, 2)
 }]
 };
 }
 } catch (error) {
 return {
 content: [{
 type: "text",
 text: JSON.stringify(handleError(error), null, 2)
 }]
 };
 }
 }
);

// Stripe Query Tool
server.tool(
 "stripe_query",
 {
 resource: z.enum([
 'events', // Webhook events and logs
 'charges', // Payment charges 
 'payment_intents', // Payment intents
 'customers', // Customer records
 'subscriptions', // Subscription data
 'invoices', // Invoice records
 'products', // Product catalog
 'prices' // Pricing data
 ]).describe('Stripe resource to query. Each resource provides different data and filtering options.'),
 
 filters: z.object({
 // Time-based filters (most common)
 created: z.object({
 gte: z.number().optional().describe('Unix timestamp: show records created on or after this time'),
 lte: z.number().optional().describe('Unix timestamp: show records created on or before this time'),
 gt: z.number().optional().describe('Unix timestamp: show records created after this time'),
 lt: z.number().optional().describe('Unix timestamp: show records created before this time')
 }).optional(),
 
 // Status filters (resource-dependent)
 status: z.string().optional().describe('Filter by status (e.g., "succeeded", "failed", "active", "canceled"). Available values depend on resource.'),
 
 // Event-specific filters
 type: z.string().optional().describe('For events resource: filter by event type (e.g., "payment_intent.succeeded", "invoice.payment_failed")'),
 
 // Relationship filters
 customer: z.string().optional().describe('Customer ID to filter by (e.g., "cus_xxxxx")'),
 subscription: z.string().optional().describe('Subscription ID to filter by (e.g., "sub_xxxxx")'),
 invoice: z.string().optional().describe('Invoice ID to filter by (e.g., "in_xxxxx")'),
 payment_intent: z.string().optional().describe('Payment Intent ID to filter by (e.g., "pi_xxxxx")'),
 
 // Amount filters
 amount: z.object({
 gte: z.number().optional().describe('Amount in cents: show records with amount >= this value'),
 lte: z.number().optional().describe('Amount in cents: show records with amount <= this value')
 }).optional()
 }).optional().describe('Filters to apply to the query. Combine multiple filters to narrow results.'),
 limit: z.number().optional().describe('Maximum number of records to return (must be between 1-100, defaults to 10)'),
 expand: z.array(z.string()).optional().describe('Stripe expand parameters to include related objects (e.g., ["customer", "payment_method"])')
 },
 async ({ resource, filters = {}, limit = 10, expand }) => {
 try {
 // Validate limit
 const validLimit = Math.min(Math.max(limit || 10, 1), 100);

 // Build query parameters
 const params: any = { limit: validLimit };
 
 // Add filters
 if (filters.created) params.created = filters.created;
 if (filters.status) params.status = filters.status;
 if (filters.type) params.type = filters.type;
 if (filters.customer) params.customer = filters.customer;
 if (filters.subscription) params.subscription = filters.subscription;
 if (filters.invoice) params.invoice = filters.invoice;
 if (filters.payment_intent) params.payment_intent = filters.payment_intent;
 if (filters.amount) params.amount = filters.amount;
 if (expand) params.expand = expand;

 // Execute query based on resource type
 let result;
 switch (resource) {
 case 'events':
 result = await stripe.events.list(params);
 break;
 case 'charges':
 result = await stripe.charges.list(params);
 break;
 case 'payment_intents':
 result = await stripe.paymentIntents.list(params);
 break;
 case 'customers':
 result = await stripe.customers.list(params);
 break;
 case 'subscriptions':
 result = await stripe.subscriptions.list(params);
 break;
 case 'invoices':
 result = await stripe.invoices.list(params);
 break;
 case 'products':
 result = await stripe.products.list(params);
 break;
 case 'prices':
 result = await stripe.prices.list(params);
 break;
 default:
 return {
 content: [{
 type: "text",
 text: JSON.stringify({ success: false, error: `Unsupported resource: ${resource}` }, null, 2)
 }]
 };
 }

 return {
 content: [{
 type: "text",
 text: JSON.stringify({
 success: true,
 resource,
 count: result.data.length,
 has_more: result.has_more,
 data: result.data,
 message: `Found ${result.data.length} ${resource} record(s)${result.has_more ? ' (more available)' : ''}`
 }, null, 2)
 }]
 };

 } catch (error) {
 return {
 content: [{
 type: "text",
 text: JSON.stringify(handleError(error), null, 2)
 }]
 };
 }
 }
);

} // End of addStripeTools function

// Start the server
async function main() {
 if (TRANSPORT_TYPE === 'http') {
 // Modern Streamable HTTP transport with backwards compatibility for SSE
 const { createServer } = await import('http');
 const { parse } = await import('url');
 
 // Store transports for session management
 const streamableTransports: { [sessionId: string]: StreamableHTTPServerTransport } = {};
 const sseTransports: { [sessionId: string]: SSEServerTransport } = {};
 
 const httpServer = createServer(async (req, res) => {
 const parsedUrl = parse(req.url || '', true);
 
 // Enable CORS for all requests
 res.setHeader('Access-Control-Allow-Origin', '*');
 res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
 res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, X-Stripe-Api-Key, Stripe-Api-Key');
 res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
 
 if (req.method === 'OPTIONS') {
 res.writeHead(200);
 res.end();
 return;
 }
 
 // Modern Streamable HTTP endpoint
 if (parsedUrl.pathname === '/mcp') {
 if (req.method === 'POST') {
 // Handle Streamable HTTP requests
 const sessionId = req.headers['mcp-session-id'] as string | undefined;
 let transport: StreamableHTTPServerTransport;

 if (sessionId && streamableTransports[sessionId]) {
 // Reuse existing transport
 transport = streamableTransports[sessionId];
 } else {
 // Parse body to check for initialize request
 let body = '';
 req.on('data', chunk => body += chunk);
 req.on('end', async () => {
 try {
 const requestBody = JSON.parse(body);
 
 if (!sessionId && isInitializeRequest(requestBody)) {
 // Extract Stripe API key from headers
 const stripeApiKey = req.headers['x-stripe-api-key'] as string || 
 req.headers['stripe-api-key'] as string ||
 FALLBACK_STRIPE_SECRET_KEY;
 
 if (!stripeApiKey) {
 res.writeHead(400, { 'Content-Type': 'application/json' });
 res.end(JSON.stringify({
 jsonrpc: '2.0',
 error: {
 code: -32000,
 message: 'Stripe API key required. Provide via X-Stripe-Api-Key header',
 },
 id: null,
 }));
 return;
 }

 // Create Stripe client with user's API key
 const stripeClient = createStripeClient(stripeApiKey);
 
 // Create MCP server with user's Stripe client
 const mcpServer = createMcpServer(stripeClient);
 
 // New initialization request
 transport = new StreamableHTTPServerTransport({
 sessionIdGenerator: () => randomUUID(),
 onsessioninitialized: (sessionId) => {
 streamableTransports[sessionId] = transport;
 }
 });

 // Clean up transport when closed
 transport.onclose = () => {
 if (transport.sessionId) {
 delete streamableTransports[transport.sessionId];
 }
 };

 // Connect server to transport
 await mcpServer.connect(transport);
 
 // Handle the request
 await transport.handleRequest(req, res, requestBody);
 } else if (sessionId && streamableTransports[sessionId]) {
 // Use existing transport
 transport = streamableTransports[sessionId];
 await transport.handleRequest(req, res, requestBody);
 } else {
 // Invalid request
 res.writeHead(400, { 'Content-Type': 'application/json' });
 res.end(JSON.stringify({
 jsonrpc: '2.0',
 error: {
 code: -32000,
 message: 'Bad Request: No valid session ID provided',
 },
 id: null,
 }));
 }
 } catch (error) {
 res.writeHead(400, { 'Content-Type': 'application/json' });
 res.end(JSON.stringify({ 
 jsonrpc: '2.0',
 error: { code: -32700, message: 'Parse error' },
 id: null 
 }));
 }
 });
 return;
 }
 
 // For existing sessions, read body and handle request
 let body = '';
 req.on('data', chunk => body += chunk);
 req.on('end', async () => {
 try {
 const requestBody = JSON.parse(body);
 await transport.handleRequest(req, res, requestBody);
 } catch (error) {
 res.writeHead(400, { 'Content-Type': 'application/json' });
 res.end(JSON.stringify({ 
 jsonrpc: '2.0',
 error: { code: -32700, message: 'Parse error' },
 id: null 
 }));
 }
 });
 
 } else if (req.method === 'GET') {
 // Handle GET requests for SSE notifications (Streamable HTTP)
 const sessionId = req.headers['mcp-session-id'] as string | undefined;
 if (!sessionId || !streamableTransports[sessionId]) {
 res.writeHead(400, { 'Content-Type': 'text/plain' });
 res.end('Invalid or missing session ID');
 return;
 }
 
 const transport = streamableTransports[sessionId];
 await transport.handleRequest(req, res);
 
 } else if (req.method === 'DELETE') {
 // Handle session termination
 const sessionId = req.headers['mcp-session-id'] as string | undefined;
 if (!sessionId || !streamableTransports[sessionId]) {
 res.writeHead(400, { 'Content-Type': 'text/plain' });
 res.end('Invalid or missing session ID');
 return;
 }
 
 const transport = streamableTransports[sessionId];
 await transport.handleRequest(req, res);
 }
 
 // Legacy SSE endpoint for backwards compatibility
 } else if (parsedUrl.pathname === '/sse' && req.method === 'GET') {
 // Extract Stripe API key from headers or use fallback
 const stripeApiKey = req.headers['x-stripe-api-key'] as string || 
 req.headers['stripe-api-key'] as string ||
 process.env.X_STRIPE_API_KEY ||
 process.env.STRIPE_API_KEY ||
 FALLBACK_STRIPE_SECRET_KEY;
 
 if (!stripeApiKey) {
 res.writeHead(400, { 'Content-Type': 'application/json' });
 res.end(JSON.stringify({ error: 'Stripe API key required. Add to Cursor config: "env": {"X-Stripe-Api-Key": "sk_live_..."}' }));
 return;
 }

 // Create Stripe client and MCP server for this session
 const stripeClient = createStripeClient(stripeApiKey);
 const mcpServer = createMcpServer(stripeClient);
 
 const transport = new SSEServerTransport('/messages', res);
 const sessionId = transport.sessionId;
 sseTransports[sessionId] = transport;
 
 res.on("close", () => {
 delete sseTransports[sessionId];
 });
 
 await mcpServer.connect(transport);
 
 } else if (parsedUrl.pathname === '/messages' && req.method === 'POST') {
 // Legacy message endpoint for SSE transport
 const sessionId = parsedUrl.query.sessionId as string;
 const transport = sseTransports[sessionId];
 
 if (transport) {
 let body = '';
 req.on('data', chunk => body += chunk);
 req.on('end', async () => {
 try {
 const message = JSON.parse(body);
 await transport.handlePostMessage(req, res, message);
 } catch (error) {
 res.writeHead(400, { 'Content-Type': 'application/json' });
 res.end(JSON.stringify({ error: 'Invalid JSON' }));
 }
 });
 } else {
 res.writeHead(400, { 'Content-Type': 'application/json' });
 res.end(JSON.stringify({ error: 'No transport found for sessionId' }));
 }
 
 } else if (parsedUrl.pathname === '/health') {
 res.writeHead(200, { 'Content-Type': 'application/json' });
 res.end(JSON.stringify({ 
 status: 'healthy', 
 service: 'stripe-mcp-server',
 version: '1.0.0',
 transport: 'http',
 protocol: 'streamable-http-with-sse-fallback'
 }));
 
 } else if (parsedUrl.pathname === '/') {
 res.writeHead(200, { 'Content-Type': 'application/json' });
 res.end(JSON.stringify({
 name: 'Stripe MCP Server',
 version: '1.0.0',
 description: 'Model Context Protocol server for Stripe integration',
 transport: 'http',
 protocol: 'streamable-http-with-sse-fallback',
 endpoints: {
 mcp: '/mcp (POST/GET/DELETE) - Modern Streamable HTTP',
 sse: '/sse (GET) - Legacy SSE stream',
 messages: '/messages (POST) - Legacy SSE messages', 
 health: '/health - Health check'
 },
 tools: [
 'stripe_connect',
 'stripe_products', 
 'stripe_prices',
 'stripe_webhooks',
 'stripe_portal_config',
 'stripe_query'
 ]
 }));
 
 } else {
 res.writeHead(404, { 'Content-Type': 'application/json' });
 res.end(JSON.stringify({ error: 'Not found' }));
 }
 });
 
 httpServer.listen(PORT, '0.0.0.0', () => {
 console.error(`Stripe MCP Server running on HTTP at port ${PORT}`);
 console.error(`Health check: http://0.0.0.0:${PORT}/health`);
 console.error(`Modern endpoint: http://0.0.0.0:${PORT}/mcp`);
 console.error(`Legacy SSE: http://0.0.0.0:${PORT}/sse`);
 });
 
 } else {
 // Stdio transport for local usage
 if (!defaultStripe) {
 console.error("Stripe API key is required for stdio mode");
 process.exit(1);
 }
 
 const server = createMcpServer(defaultStripe);
 const transport = new StdioServerTransport();
 await server.connect(transport);
 console.error("Stripe MCP Server running on stdio");
 }
}

main().catch((error) => {
 console.error("Failed to start server:", error);
 process.exit(1);
});