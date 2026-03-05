#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { cmsRequest } from './cms-client.js';
import { pathToSlug, slugToPath, getParentPath } from './path-utils.js';
import { tools } from './tools.js';

const server = new Server(
  { name: 'blink-cms', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = args as Record<string, unknown>;

  try {
    switch (name) {
      case 'cms_list_dir':
        if (typeof a.path !== 'string') throw new McpError(ErrorCode.InvalidParams, 'path is required');
        return await handleListDir({ path: a.path });
      case 'cms_read_file':
        if (typeof a.path !== 'string') throw new McpError(ErrorCode.InvalidParams, 'path is required');
        return await handleReadFile({ path: a.path });
      case 'cms_write_file':
        if (typeof a.path !== 'string') throw new McpError(ErrorCode.InvalidParams, 'path is required');
        if (typeof a.content !== 'string') throw new McpError(ErrorCode.InvalidParams, 'content is required');
        return await handleWriteFile({ path: a.path, content: a.content, publish: a.publish as boolean });
      case 'cms_search_replace':
        if (typeof a.path !== 'string') throw new McpError(ErrorCode.InvalidParams, 'path is required');
        if (typeof a.old_string !== 'string') throw new McpError(ErrorCode.InvalidParams, 'old_string is required');
        if (typeof a.new_string !== 'string') throw new McpError(ErrorCode.InvalidParams, 'new_string is required');
        return await handleSearchReplace({ path: a.path, old_string: a.old_string, new_string: a.new_string, replace_all: a.replace_all as boolean });
      case 'cms_delete_file':
        if (typeof a.path !== 'string') throw new McpError(ErrorCode.InvalidParams, 'path is required');
        return await handleDeleteFile({ path: a.path });
      case 'cms_search':
        if (typeof a.query !== 'string') throw new McpError(ErrorCode.InvalidParams, 'query is required');
        return await handleSearch({ query: a.query, type: a.type as 'doc' | 'blog', limit: a.limit as number });
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Tool "${name}" not found`);
    }
  } catch (error) {
    if (error instanceof McpError) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${msg}`);
  }
});

async function handleListDir(args: { path: string }) {
  const path = args.path.replace(/^\//, '').replace(/\/$/, '');
  const parts = path.split('/').filter(Boolean);
  
  if (parts.length === 0) {
    // Root: return docs and blog as directories
    return textResult({ entries: [
      { name: 'docs', type: 'directory' },
      { name: 'blog', type: 'directory' }
    ]});
  }
  
  const type = parts[0] === 'blog' ? 'blog' : 'doc';
  const parentSlug = parts.slice(1).join('/');
  
  // Fetch content at this level
  // For root level (empty parentSlug), we pass empty string to get items where parent_slug IS NULL
  const params = new URLSearchParams({ type, status: 'published', limit: '200' });
  params.set('parent_slug', parentSlug); // Always set - empty string for root level
  
  const data = await cmsRequest(`/content?${params}`);
  const items = data.items || [];
  
  // Build entries
  const entries: { name: string; type: 'file' | 'directory'; slug: string }[] = [];
  const seenDirs = new Set<string>();
  
  for (const item of items) {
    const itemSlug = item.slug || '';
    if (!itemSlug) continue; // Skip empty slugs (root index)
    const itemParts = itemSlug.split('/');
    const depth = parentSlug ? parentSlug.split('/').length : 0;
    
    if (itemParts.length === depth + 1) {
      // Direct child - it's a file
      const name = itemParts[itemParts.length - 1] || 'index';
      entries.push({ name: `${name}.mdx`, type: 'file', slug: itemSlug });
    } else if (itemParts.length > depth + 1) {
      // Nested - parent is a directory
      const dirName = itemParts[depth];
      if (!seenDirs.has(dirName)) {
        seenDirs.add(dirName);
        const dirSlug = itemParts.slice(0, depth + 1).join('/');
        entries.push({ name: dirName, type: 'directory', slug: dirSlug });
      }
    }
  }
  
  // Check if current path has an index file
  // For root level (parentSlug=''), look for empty slug. For subdirs, look for exact match.
  const indexSlug = parentSlug; // '' for root, 'build' for build dir, etc.
  const indexItem = items.find((i: any) => i.slug === indexSlug);
  if (indexItem) {
    entries.unshift({ name: 'index.mdx', type: 'file', slug: indexSlug });
  }
  
  return textResult({ entries: entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  })});
}

async function handleReadFile(args: { path: string }) {
  const { type, slug } = pathToSlug(args.path);
  
  const params = new URLSearchParams({ slug, type });
  const data = await cmsRequest(`/content/by-slug?${params}`);
  
  if (!data) {
    throw new McpError(ErrorCode.InvalidRequest, `File not found: ${args.path}`);
  }
  
  // Return content with frontmatter
  const frontmatter = [
    '---',
    `title: "${data.title}"`,
    data.description ? `description: "${data.description}"` : null,
    data.category ? `category: "${data.category}"` : null,
    data.tags?.length ? `tags: [${data.tags.map((t: string) => `"${t}"`).join(', ')}]` : null,
    data.status ? `status: "${data.status}"` : null,
    '---',
  ].filter(Boolean).join('\n');
  
  return textResult({
    path: args.path,
    content: `${frontmatter}\n\n${data.content}`,
    metadata: {
      id: data.id,
      type: data.type,
      slug: data.slug,
      title: data.title,
      description: data.description,
      category: data.category,
      tags: data.tags,
      status: data.status,
      created_at: data.created_at,
      updated_at: data.updated_at,
    }
  });
}

async function handleWriteFile(args: { path: string; content: string; publish?: boolean }) {
  const { type, slug } = pathToSlug(args.path);
  
  // Parse frontmatter and content
  const { frontmatter, body } = parseMdx(args.content);
  
  // Determine parent_slug for docs
  const parent_slug = type === 'doc' ? getParentPath(slug) : undefined;
  
  // Check if exists
  let existing = null;
  try {
    const params = new URLSearchParams({ slug, type });
    existing = await cmsRequest(`/content/by-slug?${params}`);
  } catch { /* not found */ }
  
  const payload = {
    type,
    slug,
    title: frontmatter.title || slug.split('/').pop() || 'Untitled',
    description: frontmatter.description,
    content: body,
    category: frontmatter.category,
    tags: frontmatter.tags,
    parent_slug,
    status: args.publish ? 'published' : (frontmatter.status || 'draft'),
    published_at: args.publish ? new Date().toISOString() : undefined,
  };
  
  if (existing) {
    // Update
    await cmsRequest(`/content/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return textResult({ success: true, action: 'updated', path: args.path, id: existing.id });
  } else {
    // Create
    const created = await cmsRequest('/content', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return textResult({ success: true, action: 'created', path: args.path, id: created.id });
  }
}

async function handleSearchReplace(args: { path: string; old_string: string; new_string: string; replace_all?: boolean }) {
  const { type, slug } = pathToSlug(args.path);
  
  // Get existing content
  const params = new URLSearchParams({ slug, type });
  const data = await cmsRequest(`/content/by-slug?${params}`);
  
  if (!data) {
    throw new McpError(ErrorCode.InvalidRequest, `File not found: ${args.path}`);
  }
  
  // Replace in content
  let newContent = data.content;
  if (args.replace_all) {
    newContent = newContent.split(args.old_string).join(args.new_string);
  } else {
    newContent = newContent.replace(args.old_string, args.new_string);
  }
  
  if (newContent === data.content) {
    return textResult({ success: false, message: 'old_string not found in content' });
  }
  
  // Update
  await cmsRequest(`/content/${data.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ content: newContent }),
  });
  
  return textResult({ success: true, path: args.path });
}

async function handleDeleteFile(args: { path: string }) {
  const { type, slug } = pathToSlug(args.path);
  
  // Get existing
  const params = new URLSearchParams({ slug, type });
  const data = await cmsRequest(`/content/by-slug?${params}`);
  
  if (!data) {
    throw new McpError(ErrorCode.InvalidRequest, `File not found: ${args.path}`);
  }
  
  await cmsRequest(`/content/${data.id}`, { method: 'DELETE' });
  
  return textResult({ success: true, deleted: args.path });
}

async function handleSearch(args: { query: string; type?: 'doc' | 'blog'; limit?: number }) {
  const params = new URLSearchParams({
    search: args.query,
    limit: String(args.limit || 20),
  });
  if (args.type) params.set('type', args.type);
  
  const data = await cmsRequest(`/content?${params}`);
  const items = (data.items || []).map((item: any) => ({
    path: slugToPath(item.type, item.slug),
    title: item.title,
    description: item.description,
    type: item.type,
  }));
  
  return textResult({ results: items, count: items.length });
}

// Helpers
function textResult(data: any) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function parseMdx(content: string): { frontmatter: Record<string, any>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  
  const frontmatter: Record<string, any> = {};
  const lines = match[1].split('\n');
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Remove quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Parse arrays
    if (value.startsWith('[') && value.endsWith(']')) {
      try {
        frontmatter[key] = JSON.parse(value.replace(/'/g, '"'));
      } catch {
        frontmatter[key] = value;
      }
    } else {
      frontmatter[key] = value;
    }
  }
  
  return { frontmatter, body: match[2].trim() };
}

// Start server
const transport = new StdioServerTransport();
server.connect(transport);
console.error('Blink CMS MCP Server running on stdio');
