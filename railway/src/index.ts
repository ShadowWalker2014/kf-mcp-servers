import express, { NextFunction, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import {
  listProjects, listServices, listEnvironments,
  listDeployments, getDeploymentLogs, getBuildLogs,
  getVariables, upsertVariable, redeployService,
  restartDeployment, createEnvironment, generateDomain,
} from './api.js';

const MCP_API_KEY = process.env.MCP_API_KEY;
const PORT = parseInt(process.env.PORT || '3400');
if (isNaN(PORT)) throw new Error(`Invalid PORT env var: "${process.env.PORT}"`);

// ─── MCP server factory ────────────────────────────────────────────────────────

function createMcpServer(railwayToken: string): McpServer {
  const server = new McpServer({ name: 'railway-mcp', version: '1.0.0' });

  server.tool('list_projects', 'List all Railway projects in a workspace.',
    { workspace_id: z.string().describe('Railway workspace ID') },
    async ({ workspace_id }) => {
      const projects = await listProjects(railwayToken, workspace_id);
      return { content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }] };
    }
  );

  server.tool('list_services', 'List all services in a Railway project.',
    { project_id: z.string().describe('Railway project ID') },
    async ({ project_id }) => {
      const services = await listServices(railwayToken, project_id);
      return { content: [{ type: 'text', text: JSON.stringify(services, null, 2) }] };
    }
  );

  server.tool('list_environments', 'List all environments in a Railway project.',
    { project_id: z.string().describe('Railway project ID') },
    async ({ project_id }) => {
      const envs = await listEnvironments(railwayToken, project_id);
      return { content: [{ type: 'text', text: JSON.stringify(envs, null, 2) }] };
    }
  );

  server.tool('list_deployments', 'List recent deployments for a service.',
    {
      project_id: z.string().describe('Railway project ID'),
      environment_id: z.string().describe('Railway environment ID'),
      service_id: z.string().describe('Railway service ID'),
      limit: z.number().optional().describe('Max deployments to return (default 10)'),
    },
    async ({ project_id, environment_id, service_id, limit }) => {
      const deployments = await listDeployments(railwayToken, project_id, environment_id, service_id, limit);
      return { content: [{ type: 'text', text: JSON.stringify(deployments, null, 2) }] };
    }
  );

  server.tool('get_logs', 'Get build or deploy logs for a deployment.',
    {
      deployment_id: z.string().describe('Railway deployment ID'),
      log_type: z.enum(['build', 'deploy']).describe('Type of logs: build or deploy'),
    },
    async ({ deployment_id, log_type }) => {
      const logs = log_type === 'build'
        ? await getBuildLogs(railwayToken, deployment_id)
        : await getDeploymentLogs(railwayToken, deployment_id);
      const text = logs.map((l) => `[${l.timestamp}] ${l.severity}: ${l.message}`).join('\n');
      return { content: [{ type: 'text', text: text || 'No logs found.' }] };
    }
  );

  server.tool('list_variables', 'List environment variables for a service.',
    {
      project_id: z.string().describe('Railway project ID'),
      environment_id: z.string().describe('Railway environment ID'),
      service_id: z.string().optional().describe('Service ID (omit for shared env variables)'),
    },
    async ({ project_id, environment_id, service_id }) => {
      const vars = await getVariables(railwayToken, project_id, environment_id, service_id);
      return { content: [{ type: 'text', text: JSON.stringify(vars, null, 2) }] };
    }
  );

  server.tool('set_variable', 'Set (upsert) an environment variable for a service.',
    {
      project_id: z.string().describe('Railway project ID'),
      environment_id: z.string().describe('Railway environment ID'),
      service_id: z.string().describe('Railway service ID'),
      name: z.string().describe('Variable name'),
      value: z.string().describe('Variable value'),
    },
    async ({ project_id, environment_id, service_id, name, value }) => {
      await upsertVariable(railwayToken, project_id, environment_id, service_id, name, value);
      return { content: [{ type: 'text', text: `Set ${name} on service ${service_id}` }] };
    }
  );

  server.tool('redeploy', 'Redeploy the latest deployment of a service.',
    {
      environment_id: z.string().describe('Railway environment ID'),
      service_id: z.string().describe('Railway service ID'),
    },
    async ({ environment_id, service_id }) => {
      await redeployService(railwayToken, environment_id, service_id);
      return { content: [{ type: 'text', text: `Redeploy triggered for service ${service_id}` }] };
    }
  );

  server.tool('restart_deployment', 'Restart a specific deployment by ID.',
    { deployment_id: z.string().describe('Railway deployment ID') },
    async ({ deployment_id }) => {
      await restartDeployment(railwayToken, deployment_id);
      return { content: [{ type: 'text', text: `Restarted deployment ${deployment_id}` }] };
    }
  );

  server.tool('create_environment', 'Create a new environment in a Railway project.',
    {
      project_id: z.string().describe('Railway project ID'),
      name: z.string().describe('Name for the new environment'),
    },
    async ({ project_id, name }) => {
      const env = await createEnvironment(railwayToken, project_id, name);
      return { content: [{ type: 'text', text: JSON.stringify(env, null, 2) }] };
    }
  );

  server.tool('generate_domain', 'Generate a Railway domain for a service.',
    {
      environment_id: z.string().describe('Railway environment ID'),
      service_id: z.string().describe('Railway service ID'),
    },
    async ({ environment_id, service_id }) => {
      const domain = await generateDomain(railwayToken, environment_id, service_id);
      return { content: [{ type: 'text', text: `Domain generated: ${domain}` }] };
    }
  );

  return server;
}

// ─── Auth middleware ───────────────────────────────────────────────────────────

function authenticate(req: Request, res: Response, next: NextFunction) {
  if (!MCP_API_KEY) return next();
  const key = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : (req.headers['x-api-key'] as string | undefined);
  if (!key) { res.status(401).json({ error: 'Missing API key' }); return; }
  if (key !== MCP_API_KEY) { res.status(403).json({ error: 'Invalid API key' }); return; }
  next();
}

function resolveRailwayToken(req: Request): string | null {
  return (req.headers['x-railway-token'] as string | undefined)
    ?? process.env.RAILWAY_TOKEN
    ?? null;
}

// ─── Express app (v5 — async errors propagate automatically) ─────────────────

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({
  status: 'ok', server: 'railway-mcp', version: '1.0.0',
  auth: MCP_API_KEY ? 'enabled' : 'disabled',
  token_mode: process.env.RAILWAY_TOKEN ? 'env (RAILWAY_TOKEN)' : 'per-request (X-Railway-Token header)',
}));

app.post('/mcp', authenticate, async (req: Request, res: Response) => {
  const railwayToken = resolveRailwayToken(req);
  if (!railwayToken) {
    res.status(400).json({ error: 'No Railway token. Set RAILWAY_TOKEN env or pass X-Railway-Token header.' });
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on('close', () => transport.close());

  const server = createMcpServer(railwayToken);
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// Authenticated stubs — prevent unauthenticated probing
app.get('/mcp', authenticate, (_req, res) => res.status(405).json({ error: 'Use POST /mcp' }));
app.delete('/mcp', authenticate, (_req, res) => res.status(405).json({ error: 'Stateless mode' }));

app.listen(PORT, () => {
  console.log(`railway-mcp running on http://0.0.0.0:${PORT}`);
  console.log(`  Token: ${process.env.RAILWAY_TOKEN ? 'RAILWAY_TOKEN env' : 'X-Railway-Token header per request'}`);
});
