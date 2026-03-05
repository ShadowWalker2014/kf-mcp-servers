export const tools = [
  {
    name: 'cms_list_dir',
    description: 'List CMS content in a directory path. Use "docs" for documentation, "blog" for blog posts.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path like "docs", "docs/build/tutorials", or "blog"',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'cms_read_file',
    description: 'Read a CMS content file by path. Returns MDX content with frontmatter.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path like "docs/build/prompting.mdx" or "blog/blink-vs-bolt.mdx"',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'cms_write_file',
    description: 'Create or update a CMS content file. Content should include frontmatter (---title: ...---) and MDX body.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path like "blog/new-article.mdx"',
        },
        content: {
          type: 'string',
          description: 'Full MDX content including frontmatter',
        },
        publish: {
          type: 'boolean',
          description: 'Set to true to publish immediately (default: false = draft)',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'cms_search_replace',
    description: `Find and replace text in a CMS content file. Features:
- Exact match first, then flexible whitespace matching (tolerates indentation differences)
- Multiple occurrence detection: requires more context or replace_all=true when text appears multiple times
- Cross-platform line ending normalization
- Returns git-style diff showing exactly what changed

CRITICAL: For single replacement, include 3-5 lines of context before/after to uniquely identify the target.`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path',
        },
        old_string: {
          type: 'string',
          description: 'Text to find. For single replacement, include surrounding context (3-5 lines) to uniquely identify the target.',
        },
        new_string: {
          type: 'string',
          description: 'Replacement text',
        },
        replace_all: {
          type: 'boolean',
          description: 'Replace all occurrences (default: false). Use for renaming variables, updating imports, etc.',
        },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'cms_multi_edit',
    description: `Make multiple edits to a single CMS file in one atomic operation. All edits must succeed or none are applied.
    
Features:
- Edits are applied in sequence, each operating on the result of the previous
- Atomic: all succeed or none are applied
- Each edit has the same capabilities as cms_search_replace

IMPORTANT: Plan edits carefully - earlier edits change content that later edits search.`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to edit',
        },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              old_string: {
                type: 'string',
                description: 'Text to find',
              },
              new_string: {
                type: 'string',
                description: 'Replacement text',
              },
              replace_all: {
                type: 'boolean',
                description: 'Replace all occurrences (default: false)',
              },
            },
            required: ['old_string', 'new_string'],
          },
          description: 'Array of edit operations to apply sequentially',
        },
      },
      required: ['path', 'edits'],
    },
  },
  {
    name: 'cms_delete_file',
    description: 'Delete a CMS content file',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to delete',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'cms_search',
    description: 'Search CMS content by text query',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        type: {
          type: 'string',
          enum: ['doc', 'blog'],
          description: 'Filter by content type',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 20)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'cms_grep',
    description: `Search CMS content with Meilisearch for fuzzy text matching. Returns excerpts with highlighted matches - perfect for finding text to use with cms_search_replace.

Features:
- Fuzzy matching (handles typos and variations)
- Returns relevant excerpts with <<<highlighted>>> matches
- Shows exact match positions in content
- Much faster than scanning all files

Use this BEFORE cms_search_replace to find the exact text you need to replace.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (supports fuzzy matching)',
        },
        type: {
          type: 'string',
          enum: ['doc', 'blog'],
          description: 'Filter by content type',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 10)',
        },
        cropLength: {
          type: 'number',
          description: 'Length of excerpt around matches (default: 100 chars)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'cms_publish',
    description: 'Make content VISIBLE on the website. Publishes draft changes to live.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of file paths to publish',
        },
      },
      required: ['paths'],
    },
  },
  {
    name: 'cms_unpublish',
    description: 'Make content HIDDEN from the website. Content becomes a draft (not deleted).',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of file paths to unpublish',
        },
      },
      required: ['paths'],
    },
  },
  {
    name: 'cms_list_drafts',
    description: 'List all draft/unpublished content (not visible on website)',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['doc', 'blog'],
          description: 'Filter by content type',
        },
      },
      required: [],
    },
  },
  {
    name: 'cms_rollback',
    description: 'Rollback content to a previous version',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path',
        },
        version: {
          type: 'number',
          description: 'Version number to rollback to',
        },
        publish: {
          type: 'boolean',
          description: 'If true, immediately publish the rolled-back version',
        },
      },
      required: ['path', 'version'],
    },
  },
  {
    name: 'cms_get_versions',
    description: 'Get version history for a content item (shows version numbers, change summaries, who made changes)',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'cms_read_version',
    description: 'Read the full content of a specific historical version',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path',
        },
        version: {
          type: 'number',
          description: 'Version number to read',
        },
      },
      required: ['path', 'version'],
    },
  },
];
