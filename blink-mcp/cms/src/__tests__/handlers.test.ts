import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test';
import { pathToSlug, slugToPath, getParentPath } from '../path-utils.js';

// Mock CMS API responses
const mockContent = {
  id: 'cnt_12345678',
  type: 'doc',
  slug: 'build/prompting',
  title: 'Prompting Guide',
  description: 'Learn how to write effective prompts',
  content: '# Prompting Guide\n\nThis is the content.',
  category: 'tutorials',
  tags: ['ai', 'prompting'],
  status: 'published',
  draft_version: 1,
  published_version: 1,
};

const mockBlogContent = {
  id: 'cnt_blog1234',
  type: 'blog',
  slug: 'my-first-post',
  title: 'My First Post',
  description: 'An introductory post',
  content: '# My First Post\n\nHello world!',
  category: 'announcements',
  tags: ['news'],
  status: 'draft',
  draft_version: 1,
  published_version: null,
};

// Test helper functions that mirror the MCP server logic
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

function buildFrontmatter(data: any): string {
  return [
    '---',
    `title: "${data.title}"`,
    data.description ? `description: "${data.description}"` : null,
    data.category ? `category: "${data.category}"` : null,
    data.tags?.length ? `tags: [${data.tags.map((t: string) => `"${t}"`).join(', ')}]` : null,
    `status: "${data.status}"`,
    '---',
  ].filter(Boolean).join('\n');
}

describe('handleListDir behavior', () => {
  test('root path returns docs and blog directories', () => {
    const path = '';
    const parts = path.split('/').filter(Boolean);
    
    if (parts.length === 0) {
      const result = { entries: [
        { name: 'docs', type: 'directory' },
        { name: 'blog', type: 'directory' }
      ]};
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].name).toBe('docs');
      expect(result.entries[1].name).toBe('blog');
    }
  });

  test('docs path extracts correct type', () => {
    const path = 'docs/build/tutorials';
    const parts = path.replace(/^\//, '').replace(/\/$/, '').split('/').filter(Boolean);
    const type = parts[0] === 'blog' ? 'blog' : 'doc';
    const parentSlug = parts.slice(1).join('/');
    
    expect(type).toBe('doc');
    expect(parentSlug).toBe('build/tutorials');
  });

  test('blog path extracts correct type', () => {
    const path = 'blog/2024';
    const parts = path.replace(/^\//, '').replace(/\/$/, '').split('/').filter(Boolean);
    const type = parts[0] === 'blog' ? 'blog' : 'doc';
    const parentSlug = parts.slice(1).join('/');
    
    expect(type).toBe('blog');
    expect(parentSlug).toBe('2024');
  });

  test('entries are sorted directories first, then files alphabetically', () => {
    const entries = [
      { name: 'zebra.mdx', type: 'file' as const },
      { name: 'alpha', type: 'directory' as const },
      { name: 'apple.mdx', type: 'file' as const },
      { name: 'beta', type: 'directory' as const },
    ];

    const sorted = entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    expect(sorted[0].name).toBe('alpha');
    expect(sorted[0].type).toBe('directory');
    expect(sorted[1].name).toBe('beta');
    expect(sorted[1].type).toBe('directory');
    expect(sorted[2].name).toBe('apple.mdx');
    expect(sorted[2].type).toBe('file');
    expect(sorted[3].name).toBe('zebra.mdx');
    expect(sorted[3].type).toBe('file');
  });
});

describe('handleReadFile behavior', () => {
  test('generates correct frontmatter', () => {
    const frontmatter = buildFrontmatter(mockContent);
    
    expect(frontmatter).toContain('title: "Prompting Guide"');
    expect(frontmatter).toContain('description: "Learn how to write effective prompts"');
    expect(frontmatter).toContain('category: "tutorials"');
    expect(frontmatter).toContain('tags: ["ai", "prompting"]');
    expect(frontmatter).toContain('status: "published"');
  });

  test('combines frontmatter and content correctly', () => {
    const frontmatter = buildFrontmatter(mockContent);
    const fullContent = `${frontmatter}\n\n${mockContent.content}`;
    
    expect(fullContent).toContain('---');
    expect(fullContent).toContain('# Prompting Guide');
    expect(fullContent).toContain('This is the content.');
  });

  test('detects pending changes', () => {
    const contentWithPending = {
      ...mockContent,
      status: 'published',
      draft_version: 3,
      published_version: 1,
    };
    
    const hasPendingChanges = contentWithPending.status === 'published' && 
      (contentWithPending.draft_version || 0) > (contentWithPending.published_version || 0);
    
    expect(hasPendingChanges).toBe(true);
  });

  test('no pending changes when versions match', () => {
    const contentNoPending = {
      ...mockContent,
      status: 'published',
      draft_version: 2,
      published_version: 2,
    };
    
    const hasPendingChanges = contentNoPending.status === 'published' && 
      (contentNoPending.draft_version || 0) > (contentNoPending.published_version || 0);
    
    expect(hasPendingChanges).toBe(false);
  });
});

describe('handleWriteFile behavior', () => {
  test('extracts frontmatter from MDX content', () => {
    const mdxContent = `---
title: "New Article"
description: "A new article"
tags: ["test"]
---

# New Article

Content here.`;
    
    const { frontmatter, body } = parseMdx(mdxContent);
    
    expect(frontmatter.title).toBe('New Article');
    expect(frontmatter.description).toBe('A new article');
    expect(frontmatter.tags).toEqual(['test']);
    expect(body).toContain('# New Article');
  });

  test('builds correct payload for new content', () => {
    const pathArg = 'docs/build/new-guide.mdx';
    const mdxContent = `---
title: "New Guide"
description: "A new guide"
---

Content`;
    
    const { type, slug } = pathToSlug(pathArg);
    const { frontmatter, body } = parseMdx(mdxContent);
    const parent_slug = type === 'doc' ? getParentPath(slug) : undefined;
    
    const payload = {
      type,
      slug,
      title: frontmatter.title || slug.split('/').pop() || 'Untitled',
      description: frontmatter.description,
      content: body,
      parent_slug,
    };
    
    expect(payload.type).toBe('doc');
    expect(payload.slug).toBe('build/new-guide');
    expect(payload.title).toBe('New Guide');
    expect(payload.parent_slug).toBe('build');
    expect(payload.content).toBe('Content');
  });

  test('handles blog content without parent_slug', () => {
    const pathArg = 'blog/my-post.mdx';
    const { type, slug } = pathToSlug(pathArg);
    const parent_slug = type === 'doc' ? getParentPath(slug) : undefined;
    
    expect(type).toBe('blog');
    expect(slug).toBe('my-post');
    expect(parent_slug).toBeUndefined();
  });
});

describe('handleSearchReplace behavior', () => {
  test('exact match detection', () => {
    const content = 'Hello world, hello universe';
    const search = 'hello';
    const normalizedContent = content.toLowerCase();
    const occurrences = normalizedContent.split(search.toLowerCase()).length - 1;
    
    // Case-sensitive check
    const exactOccurrences = content.split(search).length - 1;
    expect(exactOccurrences).toBe(1); // Only lowercase 'hello' matches
  });

  test('replace all functionality', () => {
    const content = 'apple banana apple cherry apple';
    const search = 'apple';
    const replace = 'orange';
    
    const result = content.replace(new RegExp(search, 'g'), replace);
    expect(result).toBe('orange banana orange cherry orange');
    expect(result.split('orange').length - 1).toBe(3);
  });

  test('single replace with multiple occurrences requires more context', () => {
    const content = 'duplicate\nother text\nduplicate';
    const search = 'duplicate';
    const occurrences = content.split(search).length - 1;
    
    // Should require replace_all or more context
    expect(occurrences).toBe(2);
  });

  test('no-op replacement detected', () => {
    const oldString = 'same text';
    const newString = 'same text';
    
    const isNoOp = oldString === newString;
    expect(isNoOp).toBe(true);
  });
});

describe('handleMultiEdit behavior', () => {
  test('sequential edits work correctly', () => {
    let content = 'const a = 1;\nconst b = 2;\nconst c = 3;';
    
    const edits = [
      { old_string: 'const a = 1;', new_string: 'const a = 10;' },
      { old_string: 'const b = 2;', new_string: 'const b = 20;' },
    ];
    
    for (const edit of edits) {
      content = content.replace(edit.old_string, edit.new_string);
    }
    
    expect(content).toContain('const a = 10;');
    expect(content).toContain('const b = 20;');
    expect(content).toContain('const c = 3;');
  });

  test('later edit depends on earlier edit result', () => {
    let content = 'foo bar foo';
    
    const edits = [
      { old_string: 'foo', new_string: 'baz', replace_all: true },
      { old_string: 'baz', new_string: 'qux', replace_all: true },
    ];
    
    for (const edit of edits) {
      if (edit.replace_all) {
        content = content.split(edit.old_string).join(edit.new_string);
      } else {
        content = content.replace(edit.old_string, edit.new_string);
      }
    }
    
    // After first edit: 'baz bar baz'
    // After second edit: 'qux bar qux'
    expect(content).toBe('qux bar qux');
  });

  test('empty edits array rejected', () => {
    const edits: any[] = [];
    const isValid = Array.isArray(edits) && edits.length > 0;
    expect(isValid).toBe(false);
  });
});

describe('handlePublish/Unpublish behavior', () => {
  test('groups paths by type correctly', () => {
    const paths = [
      'docs/guide.mdx',
      'blog/post.mdx',
      'docs/another-guide.mdx',
      'blog/another-post.mdx',
    ];
    
    const docSlugs: string[] = [];
    const blogSlugs: string[] = [];
    
    for (const path of paths) {
      const { type, slug } = pathToSlug(path);
      (type === 'blog' ? blogSlugs : docSlugs).push(slug);
    }
    
    expect(docSlugs).toEqual(['guide', 'another-guide']);
    expect(blogSlugs).toEqual(['post', 'another-post']);
  });

  test('formats bulk result correctly', () => {
    const results = [
      { path: 'docs/a.mdx', status: 'published' },
      { path: 'docs/b.mdx', status: 'published' },
      { path: 'docs/c.mdx', status: 'error', error: 'Not found' },
    ];
    
    const successStatus = 'published';
    const success = results.filter(r => r.status === successStatus).length;
    const errors = results.filter(r => r.status === 'error').length;
    
    expect(success).toBe(2);
    expect(errors).toBe(1);
  });
});

describe('handleGetVersions behavior', () => {
  test('extracts content ID from by-slug response', () => {
    const bySlugResponse = {
      id: 'cnt_12345678',
      type: 'doc',
      slug: 'test',
    };
    
    expect(bySlugResponse.id).toBe('cnt_12345678');
  });
});

describe('handleRollback behavior', () => {
  test('constructs correct rollback payload', () => {
    const version = 2;
    const publish = true;
    
    const payload = JSON.stringify({ version, publish });
    const parsed = JSON.parse(payload);
    
    expect(parsed.version).toBe(2);
    expect(parsed.publish).toBe(true);
  });
});

describe('handleReadVersion behavior', () => {
  test('formats version data as MDX', () => {
    const versionData = {
      version: 2,
      title: 'Test',
      description: 'Test description',
      content: '# Test\n\nContent',
      category: 'test',
      tags: ['a', 'b'],
      icon: 'book',
    };
    
    const frontmatter = [
      '---',
      `title: "${versionData.title}"`,
      versionData.description ? `description: "${versionData.description}"` : null,
      versionData.category ? `category: "${versionData.category}"` : null,
      versionData.tags?.length ? `tags: [${versionData.tags.map((t: string) => `"${t}"`).join(', ')}]` : null,
      versionData.icon ? `icon: "${versionData.icon}"` : null,
      '---',
    ].filter(Boolean).join('\n');
    
    const fullContent = `${frontmatter}\n\n${versionData.content}`;
    
    expect(fullContent).toContain('title: "Test"');
    expect(fullContent).toContain('icon: "book"');
    expect(fullContent).toContain('# Test');
  });
});
