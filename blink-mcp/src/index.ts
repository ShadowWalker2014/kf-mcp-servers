#!/usr/bin/env node
/**
 * Blink MCP Server - Stdio Transport
 * For local development with Cursor
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';

import { z } from 'zod';
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

// Helper to convert Zod schema to JSON Schema type
function zodToJsonType(zodSchema: z.ZodTypeAny): { type: string; description?: string } {
  const desc = zodSchema.description;
  
  // Unwrap optional
  let inner = zodSchema;
  if (inner instanceof z.ZodOptional) {
    inner = inner._def.innerType;
  }
  
  let jsonType = 'string';
  if (inner instanceof z.ZodNumber) jsonType = 'number';
  else if (inner instanceof z.ZodBoolean) jsonType = 'boolean';
  else if (inner instanceof z.ZodArray) jsonType = 'array';
  else if (inner instanceof z.ZodObject) jsonType = 'object';
  else if (inner instanceof z.ZodEnum) jsonType = 'string';
  
  return desc ? { type: jsonType, description: desc } : { type: jsonType };
}

// Helper to check if Zod field is optional
function isZodOptional(zodSchema: z.ZodTypeAny): boolean {
  return zodSchema instanceof z.ZodOptional || zodSchema.isOptional();
}

// Build tool list for ListToolsRequest
const tools = [
  // CMS Tools
  ...Object.entries(cmsToolSchemas).map(([name, schema]) => ({
    name,
    description: cmsToolDescriptions[name],
    inputSchema: {
      type: 'object' as const,
      properties: Object.fromEntries(
        Object.entries(schema.shape).map(([key, zodSchema]) => [
          key,
          zodToJsonType(zodSchema as z.ZodTypeAny)
        ])
      ),
      required: Object.entries(schema.shape)
        .filter(([_, zodSchema]) => !isZodOptional(zodSchema as z.ZodTypeAny))
        .map(([key]) => key),
    },
  })),
  // Web Tools
  ...Object.entries(webToolSchemas).map(([name, schema]) => ({
    name,
    description: webToolDescriptions[name],
    inputSchema: {
      type: 'object' as const,
      properties: Object.fromEntries(
        Object.entries(schema.shape).map(([key, zodSchema]) => [
          key,
          zodToJsonType(zodSchema as z.ZodTypeAny)
        ])
      ),
      required: Object.entries(schema.shape)
        .filter(([_, zodSchema]) => !isZodOptional(zodSchema as z.ZodTypeAny))
        .map(([key]) => key),
    },
  })),
];

const server = new Server(
  { name: 'blink-mcp', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = args as Record<string, unknown>;

  try {
    // CMS Tools
    if (name === 'cms_list_dir') {
      if (typeof a.path !== 'string') throw new McpError(ErrorCode.InvalidParams, 'path is required');
      const result = await handleListDir(a.path);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
    
    if (name === 'cms_read_file') {
      if (typeof a.path !== 'string') throw new McpError(ErrorCode.InvalidParams, 'path is required');
      const result = await handleReadFile(a.path);
      return { content: [{ type: 'text' as const, text: result.content }] };
    }
    
    if (name === 'cms_write_file') {
      if (typeof a.path !== 'string') throw new McpError(ErrorCode.InvalidParams, 'path is required');
      if (typeof a.content !== 'string') throw new McpError(ErrorCode.InvalidParams, 'content is required');
      const result = await handleWriteFile(a.path, a.content, a.publish as boolean);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
    
    if (name === 'cms_search_replace') {
      if (typeof a.path !== 'string') throw new McpError(ErrorCode.InvalidParams, 'path is required');
      if (typeof a.old_string !== 'string') throw new McpError(ErrorCode.InvalidParams, 'old_string is required');
      if (typeof a.new_string !== 'string') throw new McpError(ErrorCode.InvalidParams, 'new_string is required');
      const result = await handleSearchReplace(a.path, a.old_string, a.new_string, a.replace_all as boolean);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
    
    if (name === 'cms_delete_file') {
      if (typeof a.path !== 'string') throw new McpError(ErrorCode.InvalidParams, 'path is required');
      const result = await handleDeleteFile(a.path);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
    
    if (name === 'cms_restore_file') {
      if (typeof a.path !== 'string') throw new McpError(ErrorCode.InvalidParams, 'path is required');
      const result = await handleRestoreFile(a.path);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
    
    if (name === 'cms_list_trash') {
      const result = await handleListTrash(a.type as 'doc' | 'blog' | undefined);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
    
    if (name === 'cms_multi_edit') {
      if (typeof a.path !== 'string') throw new McpError(ErrorCode.InvalidParams, 'path is required');
      if (!Array.isArray(a.edits)) throw new McpError(ErrorCode.InvalidParams, 'edits is required');
      const result = await handleMultiEdit(a.path, a.edits as any);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
    
    if (name === 'cms_search') {
      if (typeof a.query !== 'string') throw new McpError(ErrorCode.InvalidParams, 'query is required');
      const result = await handleSearch(a.query, a.type as 'doc' | 'blog' | undefined, a.limit as number);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
    
    if (name === 'cms_grep') {
      if (typeof a.query !== 'string') throw new McpError(ErrorCode.InvalidParams, 'query is required');
      const result = await handleGrep(a.query, a.type as 'doc' | 'blog' | undefined, a.limit as number, a.cropLength as number);
      return { content: [{ type: 'text' as const, text: result }] };
    }
    
    if (name === 'cms_publish') {
      if (!Array.isArray(a.paths)) throw new McpError(ErrorCode.InvalidParams, 'paths is required');
      const result = await handlePublish(a.paths as string[]);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
    
    if (name === 'cms_unpublish') {
      if (!Array.isArray(a.paths)) throw new McpError(ErrorCode.InvalidParams, 'paths is required');
      const result = await handleUnpublish(a.paths as string[]);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
    
    if (name === 'cms_discard_draft') {
      if (!Array.isArray(a.paths)) throw new McpError(ErrorCode.InvalidParams, 'paths is required');
      const result = await handleDiscardDraft(a.paths as string[]);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
    
    if (name === 'cms_list_drafts') {
      const result = await handleListDrafts(a.type as 'doc' | 'blog' | undefined);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
    
    if (name === 'cms_get_versions') {
      if (typeof a.path !== 'string') throw new McpError(ErrorCode.InvalidParams, 'path is required');
      const result = await handleGetVersions(a.path);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
    
    if (name === 'cms_activate_version') {
      if (typeof a.path !== 'string') throw new McpError(ErrorCode.InvalidParams, 'path is required');
      if (typeof a.version !== 'number') throw new McpError(ErrorCode.InvalidParams, 'version is required');
      const result = await handleActivateVersion(a.path, a.version);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
    
    if (name === 'cms_read_version') {
      if (typeof a.path !== 'string') throw new McpError(ErrorCode.InvalidParams, 'path is required');
      if (typeof a.version !== 'number') throw new McpError(ErrorCode.InvalidParams, 'version is required');
      const result = await handleReadVersion(a.path, a.version);
      return { content: [{ type: 'text' as const, text: result.content }] };
    }
    
    // Web Tools
    if (name === 'web_search') {
      if (typeof a.query !== 'string') throw new McpError(ErrorCode.InvalidParams, 'query is required');
      const result = await handleWebSearch({ query: a.query, max_results: a.max_results as number });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
    
    if (name === 'fetch_url') {
      if (typeof a.url !== 'string') throw new McpError(ErrorCode.InvalidParams, 'url is required');
      const result = await handleFetchUrl({ url: a.url });
      if (result.success && result.content) {
        let output = result.title ? `# ${result.title}\n\n${result.content}` : result.content;
        if (result.truncated) output += `\n\n[Content truncated - ${result.omittedChars} chars omitted]`;
        return { content: [{ type: 'text' as const, text: output }] };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
    
    if (name === 'google_serp') {
      if (typeof a.q !== 'string') throw new McpError(ErrorCode.InvalidParams, 'q is required');
      const result = await handleGoogleSerp({
        q: a.q,
        location: a.location as string,
        hl: a.hl as string,
        tbm: a.tbm as string,
        num: a.num as number,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
    
    throw new McpError(ErrorCode.MethodNotFound, `Tool "${name}" not found`);
  } catch (error) {
    if (error instanceof McpError) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`Tool execution failed: ${msg}`);
    throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${msg}`);
  }
});

const transport = new StdioServerTransport();
server.connect(transport);
console.error('Blink MCP Server running on stdio');
