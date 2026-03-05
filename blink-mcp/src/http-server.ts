#!/usr/bin/env node
/**
 * Blink MCP Server - HTTP Transport
 * Unified MCP server with CMS and Web tools
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { cmsToolSchemas, cmsToolDescriptions, webToolSchemas, webToolDescriptions } from './tools/index.js';
import {
  handleListDir,
  handleReadFile,
  handleWriteFile,
  handleSearchReplace,
  handleDeleteFile,
  handleRestoreFile,
  handleListTrash,
  handleMultiEdit,
  handleSearch,
  handleGrep,
  handlePublish,
  handleUnpublish,
  handleDiscardDraft,
  handleListDrafts,
  handleGetVersions,
  handleActivateVersion,
  handleReadVersion,
} from './handlers/cms-handlers.js';
import {
  handleWebSearch,
  handleFetchUrl,
  handleGoogleSerp,
} from './handlers/web-handlers.js';

const PORT = parseInt(process.env.PORT || '3100');

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'blink-mcp',
    version: '2.0.0',
  });

  // =====================================================
  // CMS Tools - use .shape to get raw zod shape
  // =====================================================
  
  server.tool('cms_list_dir', cmsToolDescriptions.cms_list_dir, cmsToolSchemas.cms_list_dir.shape, async ({ path }) => {
    const result = await handleListDir(path);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('cms_read_file', cmsToolDescriptions.cms_read_file, cmsToolSchemas.cms_read_file.shape, async ({ path }) => {
    const result = await handleReadFile(path);
    return { content: [{ type: 'text', text: result.content }] };
  });

  server.tool('cms_write_file', cmsToolDescriptions.cms_write_file, cmsToolSchemas.cms_write_file.shape, async ({ path, content, publish }) => {
    const result = await handleWriteFile(path, content, publish);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('cms_search_replace', cmsToolDescriptions.cms_search_replace, cmsToolSchemas.cms_search_replace.shape, async ({ path, old_string, new_string, replace_all }) => {
    const result = await handleSearchReplace(path, old_string, new_string, replace_all);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('cms_delete_file', cmsToolDescriptions.cms_delete_file, cmsToolSchemas.cms_delete_file.shape, async ({ path }) => {
    const result = await handleDeleteFile(path);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('cms_restore_file', cmsToolDescriptions.cms_restore_file, cmsToolSchemas.cms_restore_file.shape, async ({ path }) => {
    const result = await handleRestoreFile(path);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('cms_list_trash', cmsToolDescriptions.cms_list_trash, cmsToolSchemas.cms_list_trash.shape, async ({ type }) => {
    const result = await handleListTrash(type);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('cms_multi_edit', cmsToolDescriptions.cms_multi_edit, cmsToolSchemas.cms_multi_edit.shape, async ({ path, edits }) => {
    const result = await handleMultiEdit(path, edits);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('cms_search', cmsToolDescriptions.cms_search, cmsToolSchemas.cms_search.shape, async ({ query, type, limit }) => {
    const result = await handleSearch(query, type, limit);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('cms_grep', cmsToolDescriptions.cms_grep, cmsToolSchemas.cms_grep.shape, async ({ query, type, limit, cropLength }) => {
    const result = await handleGrep(query, type, limit, cropLength);
    return { content: [{ type: 'text', text: result }] };
  });

  server.tool('cms_publish', cmsToolDescriptions.cms_publish, cmsToolSchemas.cms_publish.shape, async ({ paths }) => {
    const result = await handlePublish(paths);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('cms_unpublish', cmsToolDescriptions.cms_unpublish, cmsToolSchemas.cms_unpublish.shape, async ({ paths }) => {
    const result = await handleUnpublish(paths);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('cms_discard_draft', cmsToolDescriptions.cms_discard_draft, cmsToolSchemas.cms_discard_draft.shape, async ({ paths }) => {
    const result = await handleDiscardDraft(paths);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('cms_list_drafts', cmsToolDescriptions.cms_list_drafts, cmsToolSchemas.cms_list_drafts.shape, async ({ type }) => {
    const result = await handleListDrafts(type);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('cms_activate_version', cmsToolDescriptions.cms_activate_version, cmsToolSchemas.cms_activate_version.shape, async ({ path, version }) => {
    const result = await handleActivateVersion(path, version);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('cms_get_versions', cmsToolDescriptions.cms_get_versions, cmsToolSchemas.cms_get_versions.shape, async ({ path }) => {
    const result = await handleGetVersions(path);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('cms_read_version', cmsToolDescriptions.cms_read_version, cmsToolSchemas.cms_read_version.shape, async ({ path, version }) => {
    const result = await handleReadVersion(path, version);
    return { content: [{ type: 'text', text: result.content }] };
  });

  // =====================================================
  // Web Tools
  // =====================================================
  
  server.tool('web_search', webToolDescriptions.web_search, webToolSchemas.web_search.shape, async ({ query, max_results }) => {
    const result = await handleWebSearch({ query, max_results });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('fetch_url', webToolDescriptions.fetch_url, webToolSchemas.fetch_url.shape, async ({ url }) => {
    const result = await handleFetchUrl({ url });
    if (result.success && result.content) {
      let output = result.title ? `# ${result.title}\n\n${result.content}` : result.content;
      if (result.truncated) {
        output += `\n\n[Content truncated - ${result.omittedChars} chars omitted]`;
      }
      return { content: [{ type: 'text', text: output }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('google_serp', webToolDescriptions.google_serp, webToolSchemas.google_serp.shape, async ({ q, location, hl, tbm, num }) => {
    const result = await handleGoogleSerp({ q, location, hl, tbm, num });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  return server;
}

// =====================================================
// HTTP Server
// =====================================================

const app = express();
app.use(cors());
app.use(express.json());

const MCP_API_KEY = process.env.MCP_API_KEY;

function authenticateMCP(req: Request, res: Response, next: () => void) {
  if (!MCP_API_KEY) {
    console.warn('⚠️  MCP_API_KEY not set - running without authentication');
    return next();
  }
  
  const authHeader = req.headers.authorization;
  let providedKey: string | undefined;
  
  if (authHeader) {
    providedKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  }
  if (!providedKey) {
    providedKey = req.headers['x-api-key'] as string;
  }
  
  if (!providedKey) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Missing API key.' });
  }
  if (providedKey !== MCP_API_KEY) {
    return res.status(403).json({ error: 'Forbidden', message: 'Invalid API key.' });
  }
  
  next();
}

app.get('/health', (_, res) => res.json({ 
  status: 'ok', 
  server: 'blink-mcp',
  version: '2.0.0',
  tools: {
    cms: ['cms_list_dir', 'cms_read_file', 'cms_write_file', 'cms_search_replace', 'cms_delete_file', 'cms_restore_file', 'cms_list_trash', 'cms_multi_edit', 'cms_search', 'cms_grep', 'cms_publish', 'cms_unpublish', 'cms_discard_draft', 'cms_list_drafts', 'cms_activate_version', 'cms_get_versions', 'cms_read_version'],
    web: ['web_search', 'fetch_url', 'google_serp'],
  },
  env: {
    CMS_API_URL: process.env.CMS_API_URL || 'https://blink.new/api/cms (default)',
    MCP_API_KEY: MCP_API_KEY ? 'SET' : 'NOT SET (unauthenticated mode)',
    EXA_API_KEY: process.env.EXA_API_KEY ? 'SET' : 'NOT SET',
    VALUE_SERP_API_KEY: process.env.VALUE_SERP_API_KEY ? 'SET' : 'NOT SET',
  }
}));

app.post('/mcp', authenticateMCP, async (req: Request, res: Response) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on('close', () => transport.close());

  const server = createMcpServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', (_req: Request, res: Response) => {
  res.status(405).json({ error: 'SSE streaming not supported in stateless mode. Use POST.' });
});

app.delete('/mcp', (_req: Request, res: Response) => {
  res.status(405).json({ error: 'Session deletion not supported in stateless mode.' });
});

app.listen(PORT, () => {
  console.log(`🚀 Blink MCP Server running on http://localhost:${PORT}`);
  console.log(`   - Streamable HTTP: http://localhost:${PORT}/mcp`);
  console.log(`   - Health: http://localhost:${PORT}/health`);
  console.log(`   - Tools: CMS (17), Web (3)`);
});
