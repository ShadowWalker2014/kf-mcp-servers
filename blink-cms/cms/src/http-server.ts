#!/usr/bin/env node
/**
 * Blink CMS MCP - HTTP Server (Streamable HTTP)
 * Proper session management per MCP spec
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createTwoFilesPatch } from 'diff';
import { cmsRequest, revalidateContent } from './cms-client.js';
import { pathToSlug, slugToPath, getParentPath } from './path-utils.js';

// =====================================================
// Text Matching Utilities (inspired by auto-engineer)
// =====================================================

function normalizeLineEndings(str: string): string {
  return str.replace(/\r\n/g, '\n');
}

function generateDiff(original: string, modified: string, path: string): string {
  return createTwoFilesPatch(path, path, original, modified, 'original', 'modified');
}

interface FlexibleMatchResult {
  found: boolean;
  matchCount: number;
  startIndex: number;
  endIndex: number;
}

function findFlexibleMatch(content: string, searchText: string): FlexibleMatchResult {
  const contentLines = content.split('\n');
  const searchLines = searchText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  if (searchLines.length === 0) {
    return { found: false, matchCount: 0, startIndex: -1, endIndex: -1 };
  }
  
  let matchCount = 0;
  let firstMatch: { startIndex: number; endIndex: number } | null = null;
  
  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    let matched = true;
    let endIndex = i;
    
    for (let j = 0; j < searchLines.length; j++) {
      if (contentLines[i + j].trim() !== searchLines[j]) {
        matched = false;
        break;
      }
      endIndex = i + j;
    }
    
    if (matched) {
      matchCount++;
      if (!firstMatch) {
        firstMatch = { startIndex: i, endIndex };
      }
    }
  }
  
  return {
    found: matchCount === 1,
    matchCount,
    startIndex: firstMatch?.startIndex ?? -1,
    endIndex: firstMatch?.endIndex ?? -1,
  };
}

function applyFlexibleReplacement(
  normalizedContent: string,
  matchResult: FlexibleMatchResult,
  newText: string
): string {
  // Content is always normalized (\n only) when passed to this function
  const contentLines = normalizedContent.split('\n');
  
  const originalIndent = contentLines[matchResult.startIndex].match(/^\s*/)?.[0] || '';
  const newLines = newText.split('\n');
  const newBaseIndent = newLines[0]?.match(/^\s*/)?.[0] || '';
  
  const usesOnlyTabs = originalIndent.length > 0 && originalIndent.replace(/\t/g, '') === '';
  const indentUnit = usesOnlyTabs ? '\t' : ' ';
  
  const indentedNewLines = newLines.map((line, j) => {
    if (j === 0) {
      return originalIndent + line.trimStart();
    }
    const newIndent = line.match(/^\s*/)?.[0] || '';
    const relativeCount = Math.max(0, newIndent.length - newBaseIndent.length);
    const extraIndent = relativeCount > 0 ? indentUnit.repeat(relativeCount) : '';
    return originalIndent + extraIndent + line.trimStart();
  });
  
  contentLines.splice(matchResult.startIndex, matchResult.endIndex - matchResult.startIndex + 1, ...indentedNewLines);
  return contentLines.join('\n');
}

const PORT = parseInt(process.env.PORT || '3100');

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'blink-cms',
    version: '1.0.0',
  });

  // Register tools
  server.tool(
    'cms_list_dir',
    'List CMS content in a directory path. Use "docs" for documentation, "blog" for blog posts.',
    { path: z.string().describe('Path like "docs", "docs/build/tutorials", or "blog"') },
    async ({ path }) => {
      const result = await handleListDir(path);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'cms_read_file',
    'Read a CMS content file. Returns current working content (draft if exists, else published).',
    { path: z.string().describe('File path like "docs/build/prompting.mdx" or "blog/blink-vs-bolt.mdx"') },
    async ({ path }) => {
      const result = await handleReadFile(path);
      return { content: [{ type: 'text', text: result.content }] };
    }
  );

  server.tool(
    'cms_write_file',
    'Create or update content. Edits go to draft (NO version created). Use cms_publish to create version and make live.',
    {
      path: z.string().describe('File path like "blog/new-article.mdx"'),
      content: z.string().describe('Full MDX content including frontmatter'),
      publish: z.boolean().optional().describe('Set to true to publish immediately (default: false = save as draft)'),
    },
    async ({ path, content, publish }) => {
      const result = await handleWriteFile(path, content, publish);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'cms_search_replace',
    `Find and replace text in a CMS content file. Features:
- Exact match first, then flexible whitespace matching (tolerates indentation differences)
- Multiple occurrence detection: requires more context or replace_all=true when text appears multiple times
- Cross-platform line ending normalization (\\r\\n → \\n)
- Returns git-style diff showing exactly what changed

CRITICAL: For single replacement, include 3-5 lines of context before/after to uniquely identify the target.`,
    {
      path: z.string().describe('File path'),
      old_string: z.string().describe('Text to find. For single replacement, include surrounding context (3-5 lines) to uniquely identify the target.'),
      new_string: z.string().describe('Replacement text'),
      replace_all: z.boolean().optional().describe('Replace all occurrences (default: false). Use for renaming variables, updating imports, etc.'),
    },
    async ({ path, old_string, new_string, replace_all }) => {
      const result = await handleSearchReplace(path, old_string, new_string, replace_all);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'cms_delete_file',
    'Move a CMS content file to Trash (soft delete). Can be restored later.',
    { path: z.string().describe('File path to delete') },
    async ({ path }) => {
      const result = await handleDeleteFile(path);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'cms_restore_file',
    'Restore a deleted file from Trash',
    { path: z.string().describe('File path to restore') },
    async ({ path }) => {
      const result = await handleRestoreFile(path);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'cms_list_trash',
    'List deleted content in Trash',
    { type: z.enum(['doc', 'blog']).optional().describe('Filter by content type') },
    async ({ type }) => {
      const result = await handleListTrash(type);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'cms_multi_edit',
    `Make multiple edits to a single CMS file in one atomic operation. All edits must succeed or none are applied.
    
Features:
- Edits are applied in sequence, each operating on the result of the previous
- Atomic: all succeed or none are applied
- Each edit has the same capabilities as cms_search_replace (exact + flexible matching)

IMPORTANT:
- Plan edits carefully - earlier edits change content that later edits search
- Use replace_all for renaming across the file`,
    {
      path: z.string().describe('File path to edit'),
      edits: z.array(z.object({
        old_string: z.string().describe('Text to find'),
        new_string: z.string().describe('Replacement text'),
        replace_all: z.boolean().optional().describe('Replace all occurrences (default: false)')
      })).describe('Array of edit operations to apply sequentially'),
    },
    async ({ path, edits }) => {
      const result = await handleMultiEdit(path, edits);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'cms_search',
    'Search CMS content by text query',
    {
      query: z.string().describe('Search query'),
      type: z.enum(['doc', 'blog']).optional().describe('Filter by content type'),
      limit: z.number().optional().describe('Max results (default: 20)'),
    },
    async ({ query, type, limit }) => {
      const result = await handleSearch(query, type, limit);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'cms_grep',
    `Search CMS content with Meilisearch for fuzzy text matching. Returns excerpts with highlighted matches - perfect for finding text to use with cms_search_replace.

Features:
- Fuzzy matching (handles typos and variations)
- Returns relevant excerpts with <<<highlighted>>> matches
- Shows exact match positions in content
- Much faster than scanning all files

Use this BEFORE cms_search_replace to find the exact text you need to replace.`,
    {
      query: z.string().describe('Search query (supports fuzzy matching)'),
      type: z.enum(['doc', 'blog']).optional().describe('Filter by content type'),
      limit: z.number().optional().describe('Max results (default: 10)'),
      cropLength: z.number().optional().describe('Length of excerpt around matches (default: 100 chars)'),
    },
    async ({ query, type, limit, cropLength }) => {
      const result = await handleGrep(query, type, limit, cropLength);
      return { content: [{ type: 'text', text: result }] };
    }
  );

  server.tool(
    'cms_publish',
    'Publish: creates a VERSION SNAPSHOT of current content and makes article visible. Versions are only created on publish.',
    {
      paths: z.array(z.string()).describe('Array of file paths to publish'),
    },
    async ({ paths }) => {
      const result = await handlePublish(paths);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'cms_unpublish',
    'Unpublish: makes article HIDDEN from website. Content and versions preserved.',
    {
      paths: z.array(z.string()).describe('Array of file paths to unpublish'),
    },
    async ({ paths }) => {
      const result = await handleUnpublish(paths);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'cms_discard_draft',
    'Discard unpublished changes. Reverts content to last published version. No version created.',
    {
      paths: z.array(z.string()).describe('Array of file paths to discard drafts for'),
    },
    async ({ paths }) => {
      const result = await handleDiscardDraft(paths);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'cms_list_drafts',
    'List articles with unpublished changes (draft content newer than last publish)',
    {
      type: z.enum(['doc', 'blog']).optional().describe('Filter by content type'),
    },
    async ({ type }) => {
      const result = await handleListDrafts(type);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'cms_activate_version',
    'Rollback: copies a previous version to live content. Does NOT create new version.',
    {
      path: z.string().describe('File path'),
      version: z.number().describe('Version number to rollback to'),
    },
    async ({ path, version }) => {
      const result = await handleActivateVersion(path, version);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'cms_get_versions',
    'Get version history for a content item (shows version numbers, change summaries, who made changes)',
    {
      path: z.string().describe('File path, e.g. "docs/build/tutorials/ai-crm.mdx"'),
    },
    async ({ path }) => {
      const result = await handleGetVersions(path);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'cms_read_version',
    'Read the full content of a specific historical version',
    {
      path: z.string().describe('File path, e.g. "docs/build/tutorials/ai-crm.mdx"'),
      version: z.number().describe('Version number to read'),
    },
    async ({ path, version }) => {
      const result = await handleReadVersion(path, version);
      return { content: [{ type: 'text', text: result.content }] };
    }
  );

  return server;
}

// =====================================================
// Tool Handlers
// =====================================================

async function handleListDir(pathArg: string) {
  const path = pathArg.replace(/^\//, '').replace(/\/$/, '');
  const parts = path.split('/').filter(Boolean);
  
  if (parts.length === 0) {
    return { entries: [
      { name: 'docs', type: 'directory' },
      { name: 'blog', type: 'directory' }
    ]};
  }
  
  const type = parts[0] === 'blog' ? 'blog' : 'doc';
  const parentSlug = parts.slice(1).join('/');
  
  // Don't filter by status - show both published and draft content
  const params = new URLSearchParams({ type, limit: '200' });
  params.set('parent_slug', parentSlug);
  
  const data = await cmsRequest(`/content?${params}`);
  const items = data.items || [];
  
  const entries: { name: string; type: 'file' | 'directory'; slug: string; status?: string }[] = [];
  const seenDirs = new Set<string>();
  
  for (const item of items) {
    const itemSlug = item.slug || '';
    if (!itemSlug) continue;
    const itemParts = itemSlug.split('/');
    const depth = parentSlug ? parentSlug.split('/').length : 0;
    
    if (itemParts.length === depth + 1) {
      const name = itemParts[itemParts.length - 1] || 'index';
      entries.push({ name: `${name}.mdx`, type: 'file', slug: itemSlug, status: item.status });
    } else if (itemParts.length > depth + 1) {
      const dirName = itemParts[depth];
      if (!seenDirs.has(dirName)) {
        seenDirs.add(dirName);
        const dirSlug = itemParts.slice(0, depth + 1).join('/');
        entries.push({ name: dirName, type: 'directory', slug: dirSlug });
      }
    }
  }
  
  const indexSlug = parentSlug;
  const indexItem = items.find((i: any) => i.slug === indexSlug);
  if (indexItem) {
    entries.unshift({ name: 'index.mdx', type: 'file', slug: indexSlug, status: indexItem.status });
  }
  
  return { entries: entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  })};
}

async function handleReadFile(pathArg: string) {
  const { type, slug } = pathToSlug(pathArg);
  const params = new URLSearchParams({ slug, type });
  const data = await cmsRequest(`/content/by-slug?${params}`);
  
  if (!data) throw new Error(`File not found: ${pathArg}`);
  
  // NEW MODEL: cms_content.content IS the working content (draft)
  // Just return it directly - no version table lookup needed
  const hasDraft = data.published_at 
    ? new Date(data.updated_at) > new Date(data.published_at)
    : true; // Never published = everything is draft
  
  const frontmatter = [
    '---',
    `title: "${data.title}"`,
    data.description ? `description: "${data.description}"` : null,
    data.category ? `category: "${data.category}"` : null,
    data.tags?.length ? `tags: [${data.tags.map((t: string) => `"${t}"`).join(', ')}]` : null,
    `status: "${data.status}"`,
    hasDraft ? `# Has unpublished changes` : null,
    '---',
  ].filter(Boolean).join('\n');
  
  return {
    path: pathArg,
    content: `${frontmatter}\n\n${data.content}`,
    metadata: {
      id: data.id,
      type: data.type,
      slug: data.slug,
      title: data.title,
      status: data.status,
      has_draft: hasDraft,
      published_version: data.published_version,
    }
  };
}

async function handleWriteFile(pathArg: string, content: string, publish?: boolean) {
  const { type, slug } = pathToSlug(pathArg);
  const { frontmatter, body } = parseMdx(content);
  const parent_slug = type === 'doc' ? getParentPath(slug) : undefined;
  
  let existing = null;
  try {
    const params = new URLSearchParams({ slug, type });
    existing = await cmsRequest(`/content/by-slug?${params}`);
  } catch { /* not found */ }
  
  const payload: any = {
    type,
    slug,
    title: frontmatter.title || slug.split('/').pop() || 'Untitled',
    description: frontmatter.description,
    content: body,
    category: frontmatter.category,
    tags: frontmatter.tags,
    icon: frontmatter.icon,
    image_url: frontmatter.image_url,
    image_alt: frontmatter.image_alt,
    parent_slug,
  };
  
  if (existing) {
    // UPDATE: just update content directly (NO version created)
    const result = await cmsRequest(`/content/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    
    if (result.no_changes) {
      return { success: true, action: 'no_change', path: pathArg, id: existing.id };
    }
    
    // If publishing, create version and make live
    if (publish) {
      await cmsRequest('/content/publish', {
        method: 'POST',
        body: JSON.stringify({ ids: [existing.id] }),
      });
      await revalidateContent(type, slug);
      return { success: true, action: 'published', path: pathArg, id: existing.id };
    }
    
    return { 
      success: true, 
      action: 'draft_saved', 
      path: pathArg, 
      id: existing.id,
      has_draft: result.has_draft,
      note: 'Draft saved. Use cms_publish to create version and make live.',
    };
  } else {
    // CREATE NEW
    payload.status = publish ? 'published' : 'draft';
    
    const created = await cmsRequest('/content', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    
    if (publish) {
      // Also create initial version
      await cmsRequest('/content/publish', {
        method: 'POST',
        body: JSON.stringify({ ids: [created.id] }),
      });
      await revalidateContent(type, slug);
    }
    
    return { 
      success: true, 
      action: publish ? 'created_and_published' : 'created_as_draft', 
      path: pathArg, 
      id: created.id,
    };
  }
}

async function handleSearchReplace(pathArg: string, old_string: string, new_string: string, replace_all?: boolean) {
  const { type, slug } = pathToSlug(pathArg);
  const params = new URLSearchParams({ slug, type });
  const data = await cmsRequest(`/content/by-slug?${params}`);
  
  if (!data) throw new Error(`File not found: ${pathArg}`);
  
  // NEW MODEL: cms_content.content IS the working content - no version lookup needed
  const normalizedOld = normalizeLineEndings(old_string);
  const normalizedNew = normalizeLineEndings(new_string);
  const normalizedContent = normalizeLineEndings(data.content);
  
  // Guard: no-op replacement
  if (normalizedOld === normalizedNew) {
    return { success: false, message: 'old_string and new_string are identical; nothing to replace.' };
  }
  
  let newContent: string;
  let diff: string;
  let replacementCount = 0;
  
  // Try exact match first - use normalized content for both check AND replace
  if (normalizedContent.includes(normalizedOld)) {
    const occurrences = normalizedContent.split(normalizedOld).length - 1;
    
    if (replace_all) {
      // Replace ALL occurrences on normalized content
      newContent = normalizedContent.replace(new RegExp(escapeRegex(normalizedOld), 'g'), normalizedNew);
      replacementCount = occurrences;
    } else {
      // Single replacement - check for multiple occurrences
      if (occurrences > 1) {
        return {
          success: false,
          message: `The specified text appears ${occurrences} times. Provide more context in old_string to uniquely identify which occurrence to replace, or use replace_all=true.`
        };
      }
      newContent = normalizedContent.replace(normalizedOld, normalizedNew);
      replacementCount = 1;
    }
  } else {
    // Try flexible whitespace matching on normalized content
    const matchResult = findFlexibleMatch(normalizedContent, normalizedOld);
    
    if (!matchResult.found) {
      if (matchResult.matchCount > 1 && !replace_all) {
        return {
          success: false,
          message: `The specified text appears ${matchResult.matchCount} times (flexible match). Provide more context to uniquely identify which occurrence to replace.`
        };
      }
      return { 
        success: false, 
        message: `old_string not found in content. Tried exact and flexible whitespace matching.`,
        hint: 'Make sure the text structure matches, even if indentation differs.'
      };
    }
    
    if (replace_all && matchResult.matchCount > 1) {
      return {
        success: false,
        message: `Found ${matchResult.matchCount} matches with flexible matching, but replace_all with flexible matching is not supported. Use exact text or make individual replacements.`
      };
    }
    
    newContent = applyFlexibleReplacement(normalizedContent, matchResult, normalizedNew);
    replacementCount = 1;
  }
  
  if (newContent === normalizedContent) {
    return { success: false, message: 'old_string not found in content' };
  }
  
  // Generate diff for visibility (use normalized content for consistent diff)
  diff = generateDiff(normalizedContent, newContent, pathArg);
  
  const result = await cmsRequest(`/content/${data.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ content: newContent }),
  });
  
  return { 
    success: true, 
    path: pathArg,
    replacements: replacementCount,
    diff,
    has_draft: result.has_draft,
    note: 'Draft saved. Use cms_publish to create version and make live.',
  };
}

// Helper to escape special regex characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function handleDeleteFile(pathArg: string) {
  const { type, slug } = pathToSlug(pathArg);
  const params = new URLSearchParams({ slug, type });
  const data = await cmsRequest(`/content/by-slug?${params}`);
  
  if (!data) throw new Error(`File not found: ${pathArg}`);
  
  const result = await cmsRequest(`/content/${data.id}`, { method: 'DELETE' });
  await revalidateContent(type, slug);
  return { 
    success: true, 
    path: pathArg,
    action: result.action || 'moved_to_trash',
    note: 'Moved to Trash. Use cms_restore_file to recover.',
  };
}

async function handleRestoreFile(pathArg: string) {
  const { type, slug } = pathToSlug(pathArg);
  const params = new URLSearchParams({ slug, type });
  const data = await cmsRequest(`/content/by-slug?${params}`);
  
  if (!data) throw new Error(`File not found: ${pathArg}`);
  
  const result = await cmsRequest(`/content/${data.id}/restore`, { method: 'POST' });
  await revalidateContent(type, slug);
  return { 
    success: true, 
    path: pathArg,
    restored_status: result.restored_status,
    note: `Restored as ${result.restored_status}`,
  };
}

async function handleListTrash(type?: 'doc' | 'blog') {
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  
  const data = await cmsRequest(`/content/trash?${params}`);
  
  return {
    items: (data.items || []).map((item: any) => ({
      path: slugToPath(item.type, item.slug),
      title: item.title,
      type: item.type,
      deleted_at: item.deleted_at,
      published_version: item.published_version,
    })),
    total: data.total,
  };
}

async function handleMultiEdit(
  pathArg: string, 
  edits: Array<{ old_string: string; new_string: string; replace_all?: boolean }>
) {
  const { type, slug } = pathToSlug(pathArg);
  const params = new URLSearchParams({ slug, type });
  const data = await cmsRequest(`/content/by-slug?${params}`);
  
  if (!data) throw new Error(`File not found: ${pathArg}`);
  
  if (!Array.isArray(edits) || edits.length === 0) {
    return { success: false, message: 'No edits provided.' };
  }
  
  // NEW MODEL: work directly on cms_content.content
  const originalContent = normalizeLineEndings(data.content);
  let workingContent = originalContent;
  const editResults: Array<{ index: number; replacements: number }> = [];
  
  // Apply each edit sequentially (validation pass)
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    const normalizedOld = normalizeLineEndings(edit.old_string);
    const normalizedNew = normalizeLineEndings(edit.new_string);
    
    // Guard: no-op replacement
    if (normalizedOld === normalizedNew) {
      return { 
        success: false, 
        message: `Edit ${i + 1}: old_string and new_string are identical.`,
        failed_at: i + 1
      };
    }
    
    // Try exact match on normalized content
    if (workingContent.includes(normalizedOld)) {
      const occurrences = workingContent.split(normalizedOld).length - 1;
      
      if (edit.replace_all) {
        workingContent = workingContent.replace(new RegExp(escapeRegex(normalizedOld), 'g'), normalizedNew);
        editResults.push({ index: i + 1, replacements: occurrences });
      } else {
        if (occurrences > 1) {
          return {
            success: false,
            message: `Edit ${i + 1}: Text appears ${occurrences} times. Provide more context or use replace_all=true.`,
            failed_at: i + 1
          };
        }
        workingContent = workingContent.replace(normalizedOld, normalizedNew);
        editResults.push({ index: i + 1, replacements: 1 });
      }
    } else {
      // Try flexible whitespace matching on normalized content
      const matchResult = findFlexibleMatch(workingContent, normalizedOld);
      
      if (!matchResult.found) {
        if (matchResult.matchCount > 1 && !edit.replace_all) {
          return {
            success: false,
            message: `Edit ${i + 1}: Text appears ${matchResult.matchCount} times (flexible match). Provide more context.`,
            failed_at: i + 1
          };
        }
        return { 
          success: false, 
          message: `Edit ${i + 1}: old_string not found (tried exact and flexible matching).`,
          failed_at: i + 1
        };
      }
      
      if (edit.replace_all && matchResult.matchCount > 1) {
        return {
          success: false,
          message: `Edit ${i + 1}: Found ${matchResult.matchCount} flexible matches, but replace_all with flexible matching is not supported.`,
          failed_at: i + 1
        };
      }
      
      workingContent = applyFlexibleReplacement(workingContent, matchResult, normalizedNew);
      editResults.push({ index: i + 1, replacements: 1 });
    }
  }
  
  // All edits validated and applied - now save
  const diff = generateDiff(originalContent, workingContent, pathArg);
  
  const result = await cmsRequest(`/content/${data.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ content: workingContent }),
  });
  
  return { 
    success: true, 
    path: pathArg,
    edits_applied: edits.length,
    edit_results: editResults,
    diff,
    has_draft: result.has_draft,
    note: 'Draft saved. Use cms_publish to create version and make live.',
  };
}

async function handleSearch(query: string, type?: 'doc' | 'blog', limit?: number) {
  const params = new URLSearchParams({
    search: query,
    limit: String(limit || 20),
  });
  if (type) params.set('type', type);
  
  const data = await cmsRequest(`/content?${params}`);
  const items = (data.items || []).map((item: any) => ({
    path: slugToPath(item.type, item.slug),
    title: item.title,
    description: item.description,
    type: item.type,
  }));
  
  return { results: items, count: items.length };
}

async function handleGrep(query: string, type?: 'doc' | 'blog', limit?: number, cropLength?: number): Promise<string> {
  try {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit || 10),
      cropLength: String(cropLength || 100),
    });
    if (type) params.set('type', type);
    
    const data = await cmsRequest(`/search?${params}`);
    
    if (!data.hits || data.hits.length === 0) {
      return `No matches found for "${query}"`;
    }
    
    // Format results with excerpts and match info
    const lines: string[] = [
      `Found ${data.totalHits} matches for "${query}":`,
      '',
    ];
    
    for (const hit of data.hits) {
      const path = slugToPath(hit.type, hit.slug);
      lines.push(`📄 ${path}`);
      lines.push(`   Title: ${hit.title}`);
      
      if (hit.excerpt) {
        // Show the excerpt with highlights (<<<text>>> format from Meilisearch)
        lines.push(`   Excerpt: ...${hit.excerpt}...`);
      }
      
      if (hit.matches?.content?.length > 0) {
        const positions = hit.matches.content.slice(0, 3).map((m: { start: number; length: number }) => 
          `position ${m.start} (${m.length} chars)`
        ).join(', ');
        lines.push(`   Match positions: ${positions}`);
      }
      
      lines.push('');
    }
    
    lines.push('💡 Tip: Use cms_read_file to see full content, then cms_search_replace to make changes.');
    
    return lines.join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Search failed: ${message}`;
  }
}

async function handlePublish(paths: string[]) {
  const { docSlugs, blogSlugs } = groupPathsByType(paths);
  const results: { path: string; status: string; version?: number; error?: string }[] = [];
  
  if (docSlugs.length > 0) {
    const data = await cmsRequest('/content/publish', {
      method: 'POST',
      body: JSON.stringify({ slugs: docSlugs, type: 'doc' }),
    });
    for (const r of data.results || []) {
      results.push({ path: slugToPath('doc', r.slug), status: r.status, version: r.version, error: r.error });
      // Revalidate cache for published content
      if (r.status === 'published') {
        await revalidateContent('doc', r.slug);
      }
    }
  }
  
  if (blogSlugs.length > 0) {
    const data = await cmsRequest('/content/publish', {
      method: 'POST',
      body: JSON.stringify({ slugs: blogSlugs, type: 'blog' }),
    });
    for (const r of data.results || []) {
      results.push({ path: slugToPath('blog', r.slug), status: r.status, version: r.version, error: r.error });
      // Revalidate cache for published content
      if (r.status === 'published') {
        await revalidateContent('blog', r.slug);
      }
    }
  }
  
  return formatBulkResult(results, 'published');
}

async function handleUnpublish(paths: string[]) {
  const { docSlugs, blogSlugs } = groupPathsByType(paths);
  const results: { path: string; status: string; error?: string }[] = [];
  
  if (docSlugs.length > 0) {
    const data = await cmsRequest('/content/unpublish', {
      method: 'POST',
      body: JSON.stringify({ slugs: docSlugs, type: 'doc' }),
    });
    for (const r of data.results || []) {
      results.push({ path: slugToPath('doc', r.slug), status: r.status, error: r.error });
      // Revalidate cache for unpublished content (removes from site)
      if (r.status === 'unpublished') {
        await revalidateContent('doc', r.slug);
      }
    }
  }
  
  if (blogSlugs.length > 0) {
    const data = await cmsRequest('/content/unpublish', {
      method: 'POST',
      body: JSON.stringify({ slugs: blogSlugs, type: 'blog' }),
    });
    for (const r of data.results || []) {
      results.push({ path: slugToPath('blog', r.slug), status: r.status, error: r.error });
      // Revalidate cache for unpublished content (removes from site)
      if (r.status === 'unpublished') {
        await revalidateContent('blog', r.slug);
      }
    }
  }
  
  return formatBulkResult(results, 'unpublished');
}

// Helper: group paths by type
function groupPathsByType(paths: string[]) {
  const docSlugs: string[] = [];
  const blogSlugs: string[] = [];
  for (const path of paths) {
    const { type, slug } = pathToSlug(path);
    (type === 'blog' ? blogSlugs : docSlugs).push(slug);
  }
  return { docSlugs, blogSlugs };
}

// Helper: format bulk operation result
function formatBulkResult(results: { path: string; status: string; error?: string }[], successStatus: string) {
  const success = results.filter(r => r.status === successStatus).length;
  const errors = results.filter(r => r.status === 'error').length;
  return { success: errors === 0, [successStatus]: success, errors, results };
}

async function handleListDrafts(type?: 'doc' | 'blog') {
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  
  const data = await cmsRequest(`/content/drafts?${params}`);
  
  return {
    drafts: (data.items || []).map((item: any) => ({
      path: slugToPath(item.type, item.slug),
      title: item.title,
      has_draft: item.has_draft,
      updated_at: item.updated_at,
      published_version: item.published_version,
    })),
    total: data.total,
  };
}

async function handleDiscardDraft(paths: string[]) {
  const results: { path: string; status: string; error?: string }[] = [];
  
  for (const pathArg of paths) {
    const { type, slug } = pathToSlug(pathArg);
    
    try {
      // Get content ID
      const params = new URLSearchParams({ slug, type });
      const content = await cmsRequest(`/content/by-slug?${params}`);
      
      if (!content) {
        results.push({ path: pathArg, status: 'error', error: 'Not found' });
        continue;
      }
      
      // Call discard endpoint
      const data = await cmsRequest('/content/discard-draft', {
        method: 'POST',
        body: JSON.stringify({ ids: [content.id] }),
      });
      
      const result = data.results?.[0];
      if (result?.status === 'discarded') {
        results.push({ path: pathArg, status: 'discarded' });
        await revalidateContent(type, slug);
      } else if (result?.status === 'no_draft') {
        results.push({ path: pathArg, status: 'no_draft' });
      } else {
        results.push({ path: pathArg, status: 'error', error: result?.error || 'Unknown error' });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      results.push({ path: pathArg, status: 'error', error: msg });
    }
  }
  
  const discarded = results.filter(r => r.status === 'discarded').length;
  return { success: results.every(r => r.status !== 'error'), discarded, results };
}

async function handleGetVersions(pathArg: string) {
  const { type, slug } = pathToSlug(pathArg);
  
  // First get the content ID
  const params = new URLSearchParams({ slug, type });
  const content = await cmsRequest(`/content/by-slug?${params}`);
  
  if (!content) {
    throw new Error(`Content not found: ${pathArg}`);
  }
  
  // Get version history
  const data = await cmsRequest(`/content/${content.id}/versions`);
  
  return {
    path: pathArg,
    content: {
      id: data.content.id,
      title: data.content.title,
      status: data.content.status,
      published_version: data.content.published_version,
      has_draft: data.content.published_at 
        ? new Date(data.content.updated_at) > new Date(data.content.published_at)
        : true,
    },
    versions: data.versions,
  };
}

async function handleActivateVersion(pathArg: string, version: number) {
  const { type, slug } = pathToSlug(pathArg);
  
  // First get the content ID
  const params = new URLSearchParams({ slug, type });
  const content = await cmsRequest(`/content/by-slug?${params}`);
  
  if (!content) {
    throw new Error(`Content not found: ${pathArg}`);
  }
  
  // Activate the version (make it the live content)
  const result = await cmsRequest(`/content/${content.id}/activate`, {
    method: 'POST',
    body: JSON.stringify({ version }),
  });
  
  // Revalidate if article is published (visible on site)
  if (result.status === 'published') {
    await revalidateContent(type, slug);
  }
  
  return {
    success: result.success,
    path: pathArg,
    activated_version: result.activated_version,
    article_status: result.status,
    message: result.message,
  };
}

async function handleReadVersion(pathArg: string, version: number) {
  const { type, slug } = pathToSlug(pathArg);
  
  // First get the content ID
  const params = new URLSearchParams({ slug, type });
  const content = await cmsRequest(`/content/by-slug?${params}`);
  
  if (!content) {
    throw new Error(`Content not found: ${pathArg}`);
  }
  
  // Get version content
  const versionData = await cmsRequest(`/content/${content.id}/versions/${version}`);
  
  // Format as MDX with frontmatter
  const frontmatter = [
    '---',
    `title: "${versionData.title}"`,
    versionData.description ? `description: "${versionData.description}"` : null,
    versionData.category ? `category: "${versionData.category}"` : null,
    versionData.tags?.length ? `tags: [${versionData.tags.map((t: string) => `"${t}"`).join(', ')}]` : null,
    versionData.icon ? `icon: "${versionData.icon}"` : null,
    '---',
  ].filter(Boolean).join('\n');
  
  return {
    path: pathArg,
    version: versionData.version,
    is_published: versionData.is_published,
    is_draft: versionData.is_draft,
    change_summary: versionData.change_summary,
    created_by: versionData.created_by,
    created_at: versionData.created_at,
    content: `${frontmatter}\n\n${versionData.content}`,
  };
}

function parseMdx(content: string): { frontmatter: Record<string, any>; body: string } {
  // Normalize line endings before parsing
  const normalized = normalizeLineEndings(content);
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: normalized };
  
  const frontmatter: Record<string, any> = {};
  const lines = match[1].split('\n');
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
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

// =====================================================
// HTTP Server with Proper Session Management
// =====================================================

const app = express();
app.use(cors());
app.use(express.json());

// API key for MCP endpoint authentication
const MCP_API_KEY = process.env.MCP_API_KEY || process.env.CMS_API_KEY;

// Auth middleware for MCP endpoint
function authenticateMCP(req: Request, res: Response, next: () => void) {
  // Skip auth if no key is configured (dev mode)
  if (!MCP_API_KEY) {
    console.warn('⚠️  MCP_API_KEY not set - running without authentication');
    return next();
  }
  
  // Check Authorization header: "Bearer <key>" or just "<key>"
  const authHeader = req.headers.authorization;
  let providedKey: string | undefined;
  
  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      providedKey = authHeader.slice(7);
    } else {
      providedKey = authHeader;
    }
  }
  
  // Also check x-api-key header as fallback
  if (!providedKey) {
    providedKey = req.headers['x-api-key'] as string;
  }
  
  if (!providedKey) {
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'Missing API key. Provide via Authorization header.' 
    });
  }
  
  if (providedKey !== MCP_API_KEY) {
    return res.status(403).json({ 
      error: 'Forbidden', 
      message: 'Invalid API key.' 
    });
  }
  
  next();
}

// Health check with diagnostics (no auth required)
app.get('/health', (_, res) => res.json({ 
  status: 'ok', 
  server: 'blink-cms-mcp',
  env: {
    CMS_API_URL: process.env.CMS_API_URL || 'https://blink.new/api/cms (default)',
    CMS_API_KEY: process.env.CMS_API_KEY ? 'SET' : 'NOT SET',
    MCP_API_KEY: MCP_API_KEY ? 'SET' : 'NOT SET (unauthenticated mode)',
  }
}));

// Streamable HTTP endpoint - requires authentication
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

// GET for SSE streaming - not supported in stateless mode
app.get('/mcp', (_req: Request, res: Response) => {
  res.status(405).json({ error: 'SSE streaming not supported in stateless mode. Use POST.' });
});

// DELETE - not supported in stateless mode
app.delete('/mcp', (_req: Request, res: Response) => {
  res.status(405).json({ error: 'Session deletion not supported in stateless mode.' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Blink CMS MCP Server running on http://localhost:${PORT}`);
  console.log(`   - Streamable HTTP: http://localhost:${PORT}/mcp`);
  console.log(`   - Health: http://localhost:${PORT}/health`);
});
