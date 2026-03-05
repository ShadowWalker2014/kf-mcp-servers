/**
 * CMS Tool Definitions
 * Content management tools for docs and blog
 */

import { z } from 'zod';

export const cmsToolSchemas = {
  cms_list_dir: z.object({
    path: z.string().describe('Path like "docs", "docs/build/tutorials", or "blog"'),
  }),

  cms_read_file: z.object({
    path: z.string().describe('File path like "docs/build/prompting.mdx" or "blog/blink-vs-bolt.mdx"'),
  }),

  cms_write_file: z.object({
    path: z.string().describe('File path like "blog/new-article.mdx"'),
    content: z.string().describe('Full MDX content including frontmatter'),
    publish: z.boolean().optional().describe('Set to true to publish immediately (default: false = save as draft)'),
  }),

  cms_search_replace: z.object({
    path: z.string().describe('File path'),
    old_string: z.string().describe('Text to find. For single replacement, include surrounding context (3-5 lines) to uniquely identify the target.'),
    new_string: z.string().describe('Replacement text'),
    replace_all: z.boolean().optional().describe('Replace all occurrences (default: false). Use for renaming variables, updating imports, etc.'),
  }),

  cms_delete_file: z.object({
    path: z.string().describe('File path to delete'),
  }),

  cms_restore_file: z.object({
    path: z.string().describe('File path to restore'),
  }),

  cms_list_trash: z.object({
    type: z.enum(['doc', 'blog']).optional().describe('Filter by content type'),
  }),

  cms_multi_edit: z.object({
    path: z.string().describe('File path to edit'),
    edits: z.array(z.object({
      old_string: z.string().describe('Text to find'),
      new_string: z.string().describe('Replacement text'),
      replace_all: z.boolean().optional().describe('Replace all occurrences (default: false)')
    })).describe('Array of edit operations to apply sequentially'),
  }),

  cms_search: z.object({
    query: z.string().describe('Search query'),
    type: z.enum(['doc', 'blog']).optional().describe('Filter by content type'),
    limit: z.number().optional().describe('Max results (default: 20)'),
  }),

  cms_grep: z.object({
    query: z.string().describe('Search query (supports fuzzy matching)'),
    type: z.enum(['doc', 'blog']).optional().describe('Filter by content type'),
    limit: z.number().optional().describe('Max results (default: 10)'),
    cropLength: z.number().optional().describe('Length of excerpt around matches (default: 100 chars)'),
  }),

  cms_publish: z.object({
    paths: z.array(z.string()).describe('Array of file paths to publish'),
  }),

  cms_unpublish: z.object({
    paths: z.array(z.string()).describe('Array of file paths to unpublish'),
  }),

  cms_discard_draft: z.object({
    paths: z.array(z.string()).describe('Array of file paths to discard drafts for'),
  }),

  cms_list_drafts: z.object({
    type: z.enum(['doc', 'blog']).optional().describe('Filter by content type'),
  }),

  cms_activate_version: z.object({
    path: z.string().describe('File path'),
    version: z.number().describe('Version number to rollback to'),
  }),

  cms_get_versions: z.object({
    path: z.string().describe('File path, e.g. "docs/build/tutorials/ai-crm.mdx"'),
  }),

  cms_read_version: z.object({
    path: z.string().describe('File path, e.g. "docs/build/tutorials/ai-crm.mdx"'),
    version: z.number().describe('Version number to read'),
  }),
};

export const cmsToolDescriptions: Record<string, string> = {
  cms_list_dir: 'List CMS content in a directory path. Use "docs" for documentation, "blog" for blog posts.',
  
  cms_read_file: 'Read a CMS content file. Returns current working content (draft if exists, else published).',
  
  cms_write_file: 'Create or update content. Edits go to draft (NO version created). Use cms_publish to create version and make live.',
  
  cms_search_replace: `Find and replace text in a CMS content file. Features:
- Exact match first, then flexible whitespace matching (tolerates indentation differences)
- Multiple occurrence detection: requires more context or replace_all=true when text appears multiple times
- Cross-platform line ending normalization (\\r\\n → \\n)
- Returns git-style diff showing exactly what changed

CRITICAL: For single replacement, include 3-5 lines of context before/after to uniquely identify the target.`,
  
  cms_delete_file: 'Move a CMS content file to Trash (soft delete). Can be restored later.',
  
  cms_restore_file: 'Restore a deleted file from Trash',
  
  cms_list_trash: 'List deleted content in Trash',
  
  cms_multi_edit: `Make multiple edits to a single CMS file in one atomic operation. All edits must succeed or none are applied.
    
Features:
- Edits are applied in sequence, each operating on the result of the previous
- Atomic: all succeed or none are applied
- Each edit has the same capabilities as cms_search_replace (exact + flexible matching)

IMPORTANT:
- Plan edits carefully - earlier edits change content that later edits search
- Use replace_all for renaming across the file`,
  
  cms_search: 'Search CMS content by text query',
  
  cms_grep: `Search CMS content with Meilisearch for fuzzy text matching. Returns excerpts with highlighted matches - perfect for finding text to use with cms_search_replace.

Features:
- Fuzzy matching (handles typos and variations)
- Returns relevant excerpts with <<<highlighted>>> matches
- Shows exact match positions in content
- Much faster than scanning all files

Use this BEFORE cms_search_replace to find the exact text you need to replace.`,
  
  cms_publish: 'Publish: creates a VERSION SNAPSHOT of current content and makes article visible. Versions are only created on publish.',
  
  cms_unpublish: 'Unpublish: makes article HIDDEN from website. Content and versions preserved.',
  
  cms_discard_draft: 'Discard unpublished changes. Reverts content to last published version. No version created.',
  
  cms_list_drafts: 'List articles with unpublished changes (draft content newer than last publish)',
  
  cms_activate_version: 'Rollback: copies a previous version to live content. Does NOT create new version.',
  
  cms_get_versions: 'Get version history for a content item (shows version numbers, change summaries, who made changes)',
  
  cms_read_version: 'Read the full content of a specific historical version',
};
