/**
 * Convert virtual path to CMS type/slug
 * "docs/build/tutorials/ai-chatbot.mdx" → { type: "doc", slug: "build/tutorials/ai-chatbot" }
 * "blog/blink-vs-bolt.mdx" → { type: "blog", slug: "blink-vs-bolt" }
 */
export function pathToSlug(path: string): { type: 'doc' | 'blog'; slug: string } {
  const clean = path.replace(/^\//, '').replace(/\/$/, '');
  const parts = clean.split('/');
  const type = parts[0] === 'blog' ? 'blog' : 'doc';
  
  // Remove prefix (docs/ or blog/) and .mdx suffix
  let slug = parts.slice(1).join('/').replace(/\.mdx$/, '');
  
  // Handle index files: "build/index" → "build"
  slug = slug.replace(/\/index$/, '');
  if (slug === 'index') slug = '';
  
  return { type, slug };
}

/**
 * Convert CMS type/slug to virtual path
 * { type: "doc", slug: "build/tutorials/ai-chatbot" } → "docs/build/tutorials/ai-chatbot.mdx"
 */
export function slugToPath(type: 'doc' | 'blog', slug: string): string {
  const prefix = type === 'blog' ? 'blog' : 'docs';
  if (!slug) return `${prefix}/index.mdx`;
  return `${prefix}/${slug}.mdx`;
}

/**
 * Get parent path from slug
 * "build/tutorials/ai-chatbot" → "build/tutorials"
 */
export function getParentPath(slug: string): string | null {
  if (!slug) return null;
  const parts = slug.split('/');
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join('/');
}
