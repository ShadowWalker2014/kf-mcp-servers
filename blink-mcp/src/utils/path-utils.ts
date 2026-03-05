/**
 * Path utilities for CMS content
 * Convert between file paths and slugs
 */

export function pathToSlug(path: string): { type: 'doc' | 'blog'; slug: string } {
  const cleanPath = path.replace(/^\//, '').replace(/\.mdx$/, '');
  const parts = cleanPath.split('/').filter(Boolean);
  
  if (parts[0] === 'blog') {
    return { type: 'blog', slug: parts.slice(1).join('/') };
  }
  
  // Default to doc - strip 'docs' prefix if present
  const slug = parts[0] === 'docs' ? parts.slice(1).join('/') : parts.join('/');
  return { type: 'doc', slug };
}

export function slugToPath(type: 'doc' | 'blog', slug: string): string {
  if (type === 'blog') {
    return slug ? `blog/${slug}.mdx` : 'blog/index.mdx';
  }
  return slug ? `docs/${slug}.mdx` : 'docs/index.mdx';
}

export function getParentPath(slug: string): string | null {
  if (!slug) return null;
  const parts = slug.split('/');
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join('/');
}
