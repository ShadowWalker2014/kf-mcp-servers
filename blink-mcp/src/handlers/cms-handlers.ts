/**
 * CMS Tool Handlers
 * Implementation of CMS content management operations
 */

import { cmsRequest, revalidateContent } from '../clients/cms-client.js';
import { pathToSlug, slugToPath, getParentPath } from '../utils/path-utils.js';
import {
  normalizeLineEndings,
  generateDiff,
  findFlexibleMatch,
  applyFlexibleReplacement,
  escapeRegex,
} from '../utils/text-matching.js';

// Escape $ in replacement string to prevent regex replacement pattern issues
function escapeReplacement(str: string): string {
  return str.replace(/\$/g, '$$$$');
}

// =====================================================
// List Directory
// =====================================================
export async function handleListDir(pathArg: string) {
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

// =====================================================
// Read File
// =====================================================
export async function handleReadFile(pathArg: string) {
  const { type, slug } = pathToSlug(pathArg);
  const params = new URLSearchParams({ slug, type });
  const data = await cmsRequest(`/content/by-slug?${params}`);
  
  if (!data) throw new Error(`File not found: ${pathArg}`);
  
  const hasDraft = data.published_at 
    ? new Date(data.updated_at) > new Date(data.published_at)
    : true;
  
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

// =====================================================
// Write File
// =====================================================
export async function handleWriteFile(pathArg: string, content: string, publish?: boolean) {
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
    const result = await cmsRequest(`/content/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    
    if (result.no_changes) {
      return { success: true, action: 'no_change', path: pathArg, id: existing.id };
    }
    
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
    payload.status = publish ? 'published' : 'draft';
    
    const created = await cmsRequest('/content', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    
    if (publish) {
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

// =====================================================
// Search Replace
// =====================================================
export async function handleSearchReplace(pathArg: string, old_string: string, new_string: string, replace_all?: boolean) {
  const { type, slug } = pathToSlug(pathArg);
  const params = new URLSearchParams({ slug, type });
  const data = await cmsRequest(`/content/by-slug?${params}`);
  
  if (!data) throw new Error(`File not found: ${pathArg}`);
  
  const normalizedOld = normalizeLineEndings(old_string);
  const normalizedNew = normalizeLineEndings(new_string);
  const normalizedContent = normalizeLineEndings(data.content);
  
  if (normalizedOld === normalizedNew) {
    return { success: false, message: 'old_string and new_string are identical; nothing to replace.' };
  }
  
  let newContent: string;
  let diff: string;
  let replacementCount = 0;
  
  if (normalizedContent.includes(normalizedOld)) {
    const occurrences = normalizedContent.split(normalizedOld).length - 1;
    
    if (replace_all) {
      newContent = normalizedContent.replace(new RegExp(escapeRegex(normalizedOld), 'g'), escapeReplacement(normalizedNew));
      replacementCount = occurrences;
    } else {
      if (occurrences > 1) {
        return {
          success: false,
          message: `The specified text appears ${occurrences} times. Provide more context in old_string to uniquely identify which occurrence to replace, or use replace_all=true.`
        };
      }
      newContent = normalizedContent.replace(normalizedOld, escapeReplacement(normalizedNew));
      replacementCount = 1;
    }
  } else {
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
        message: `Found ${matchResult.matchCount} matches with flexible matching, but replace_all with flexible matching is not supported.`
      };
    }
    
    newContent = applyFlexibleReplacement(normalizedContent, matchResult, normalizedNew);
    replacementCount = 1;
  }
  
  if (newContent === normalizedContent) {
    return { success: false, message: 'old_string not found in content' };
  }
  
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

// =====================================================
// Delete File
// =====================================================
export async function handleDeleteFile(pathArg: string) {
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

// =====================================================
// Restore File
// =====================================================
export async function handleRestoreFile(pathArg: string) {
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

// =====================================================
// List Trash
// =====================================================
export async function handleListTrash(type?: 'doc' | 'blog') {
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

// =====================================================
// Multi Edit
// =====================================================
export async function handleMultiEdit(
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
  
  const originalContent = normalizeLineEndings(data.content);
  let workingContent = originalContent;
  const editResults: Array<{ index: number; replacements: number }> = [];
  
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    const normalizedOld = normalizeLineEndings(edit.old_string);
    const normalizedNew = normalizeLineEndings(edit.new_string);
    
    if (normalizedOld === normalizedNew) {
      return { 
        success: false, 
        message: `Edit ${i + 1}: old_string and new_string are identical.`,
        failed_at: i + 1
      };
    }
    
    if (workingContent.includes(normalizedOld)) {
      const occurrences = workingContent.split(normalizedOld).length - 1;
      
      if (edit.replace_all) {
        workingContent = workingContent.replace(new RegExp(escapeRegex(normalizedOld), 'g'), escapeReplacement(normalizedNew));
        editResults.push({ index: i + 1, replacements: occurrences });
      } else {
        if (occurrences > 1) {
          return {
            success: false,
            message: `Edit ${i + 1}: Text appears ${occurrences} times. Provide more context or use replace_all=true.`,
            failed_at: i + 1
          };
        }
        workingContent = workingContent.replace(normalizedOld, escapeReplacement(normalizedNew));
        editResults.push({ index: i + 1, replacements: 1 });
      }
    } else {
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

// =====================================================
// Search
// =====================================================
export async function handleSearch(query: string, type?: 'doc' | 'blog', limit?: number) {
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

// =====================================================
// Grep (Fuzzy Search)
// =====================================================
export async function handleGrep(query: string, type?: 'doc' | 'blog', limit?: number, cropLength?: number): Promise<string> {
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
    
    const lines: string[] = [
      `Found ${data.totalHits} matches for "${query}":`,
      '',
    ];
    
    for (const hit of data.hits) {
      const path = slugToPath(hit.type, hit.slug);
      lines.push(`📄 ${path}`);
      lines.push(`   Title: ${hit.title}`);
      
      if (hit.excerpt) {
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
    console.error('Grep failed:', error);
    return `Search failed: ${message}`;
  }
}

// =====================================================
// Publish
// =====================================================
export async function handlePublish(paths: string[]) {
  const { docSlugs, blogSlugs } = groupPathsByType(paths);
  const results: { path: string; status: string; version?: number; error?: string }[] = [];
  
  if (docSlugs.length > 0) {
    const data = await cmsRequest('/content/publish', {
      method: 'POST',
      body: JSON.stringify({ slugs: docSlugs, type: 'doc' }),
    });
    for (const r of data.results || []) {
      results.push({ path: slugToPath('doc', r.slug), status: r.status, version: r.version, error: r.error });
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
      if (r.status === 'published') {
        await revalidateContent('blog', r.slug);
      }
    }
  }
  
  return formatBulkResult(results, 'published');
}

// =====================================================
// Unpublish
// =====================================================
export async function handleUnpublish(paths: string[]) {
  const { docSlugs, blogSlugs } = groupPathsByType(paths);
  const results: { path: string; status: string; error?: string }[] = [];
  
  if (docSlugs.length > 0) {
    const data = await cmsRequest('/content/unpublish', {
      method: 'POST',
      body: JSON.stringify({ slugs: docSlugs, type: 'doc' }),
    });
    for (const r of data.results || []) {
      results.push({ path: slugToPath('doc', r.slug), status: r.status, error: r.error });
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
      if (r.status === 'unpublished') {
        await revalidateContent('blog', r.slug);
      }
    }
  }
  
  return formatBulkResult(results, 'unpublished');
}

// =====================================================
// Discard Draft
// =====================================================
export async function handleDiscardDraft(paths: string[]) {
  const results: { path: string; status: string; error?: string }[] = [];
  
  for (const pathArg of paths) {
    const { type, slug } = pathToSlug(pathArg);
    
    try {
      const params = new URLSearchParams({ slug, type });
      const content = await cmsRequest(`/content/by-slug?${params}`);
      
      if (!content) {
        results.push({ path: pathArg, status: 'error', error: 'Not found' });
        continue;
      }
      
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
      console.error('Discard draft failed:', error);
      results.push({ path: pathArg, status: 'error', error: msg });
    }
  }
  
  const discarded = results.filter(r => r.status === 'discarded').length;
  return { success: results.every(r => r.status !== 'error'), discarded, results };
}

// =====================================================
// List Drafts
// =====================================================
export async function handleListDrafts(type?: 'doc' | 'blog') {
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

// =====================================================
// Get Versions
// =====================================================
export async function handleGetVersions(pathArg: string) {
  const { type, slug } = pathToSlug(pathArg);
  const params = new URLSearchParams({ slug, type });
  const content = await cmsRequest(`/content/by-slug?${params}`);
  
  if (!content) throw new Error(`Content not found: ${pathArg}`);
  
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

// =====================================================
// Activate Version
// =====================================================
export async function handleActivateVersion(pathArg: string, version: number) {
  const { type, slug } = pathToSlug(pathArg);
  const params = new URLSearchParams({ slug, type });
  const content = await cmsRequest(`/content/by-slug?${params}`);
  
  if (!content) throw new Error(`Content not found: ${pathArg}`);
  
  const result = await cmsRequest(`/content/${content.id}/activate`, {
    method: 'POST',
    body: JSON.stringify({ version }),
  });
  
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

// =====================================================
// Read Version
// =====================================================
export async function handleReadVersion(pathArg: string, version: number) {
  const { type, slug } = pathToSlug(pathArg);
  const params = new URLSearchParams({ slug, type });
  const content = await cmsRequest(`/content/by-slug?${params}`);
  
  if (!content) throw new Error(`Content not found: ${pathArg}`);
  
  const versionData = await cmsRequest(`/content/${content.id}/versions/${version}`);
  
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

// =====================================================
// Helper Functions
// =====================================================

function groupPathsByType(paths: string[]) {
  const docSlugs: string[] = [];
  const blogSlugs: string[] = [];
  for (const path of paths) {
    const { type, slug } = pathToSlug(path);
    (type === 'blog' ? blogSlugs : docSlugs).push(slug);
  }
  return { docSlugs, blogSlugs };
}

function formatBulkResult(results: { path: string; status: string; error?: string }[], successStatus: string) {
  const success = results.filter(r => r.status === successStatus).length;
  const errors = results.filter(r => r.status === 'error').length;
  return { success: errors === 0, [successStatus]: success, errors, results };
}

function parseMdx(content: string): { frontmatter: Record<string, any>; body: string } {
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
