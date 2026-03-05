import { describe, expect, test } from 'bun:test';
import { pathToSlug, slugToPath, getParentPath } from '../path-utils.js';

describe('pathToSlug', () => {
  describe('docs paths', () => {
    test('converts simple doc path', () => {
      expect(pathToSlug('docs/prompting.mdx')).toEqual({ type: 'doc', slug: 'prompting' });
    });

    test('converts nested doc path', () => {
      expect(pathToSlug('docs/build/tutorials/ai-crm.mdx')).toEqual({ type: 'doc', slug: 'build/tutorials/ai-crm' });
    });

    test('handles leading slash', () => {
      expect(pathToSlug('/docs/build/prompting.mdx')).toEqual({ type: 'doc', slug: 'build/prompting' });
    });

    test('handles trailing slash', () => {
      expect(pathToSlug('docs/build/')).toEqual({ type: 'doc', slug: 'build' });
    });

    test('converts index file to empty slug', () => {
      expect(pathToSlug('docs/index.mdx')).toEqual({ type: 'doc', slug: '' });
    });

    test('converts nested index file', () => {
      expect(pathToSlug('docs/build/index.mdx')).toEqual({ type: 'doc', slug: 'build' });
    });

    test('handles path without .mdx extension', () => {
      expect(pathToSlug('docs/build/prompting')).toEqual({ type: 'doc', slug: 'build/prompting' });
    });
  });

  describe('blog paths', () => {
    test('converts simple blog path', () => {
      expect(pathToSlug('blog/my-post.mdx')).toEqual({ type: 'blog', slug: 'my-post' });
    });

    test('converts blog index', () => {
      expect(pathToSlug('blog/index.mdx')).toEqual({ type: 'blog', slug: '' });
    });

    test('handles nested blog path', () => {
      expect(pathToSlug('blog/2024/january/post.mdx')).toEqual({ type: 'blog', slug: '2024/january/post' });
    });
  });

  describe('edge cases', () => {
    test('defaults non-blog paths to doc type', () => {
      expect(pathToSlug('other/something.mdx')).toEqual({ type: 'doc', slug: 'something' });
    });

    test('handles just "docs"', () => {
      expect(pathToSlug('docs')).toEqual({ type: 'doc', slug: '' });
    });

    test('handles just "blog"', () => {
      expect(pathToSlug('blog')).toEqual({ type: 'blog', slug: '' });
    });
  });
});

describe('slugToPath', () => {
  describe('doc type', () => {
    test('converts simple slug to doc path', () => {
      expect(slugToPath('doc', 'prompting')).toBe('docs/prompting.mdx');
    });

    test('converts nested slug to doc path', () => {
      expect(slugToPath('doc', 'build/tutorials/ai-crm')).toBe('docs/build/tutorials/ai-crm.mdx');
    });

    test('converts empty slug to index.mdx', () => {
      expect(slugToPath('doc', '')).toBe('docs/index.mdx');
    });
  });

  describe('blog type', () => {
    test('converts simple slug to blog path', () => {
      expect(slugToPath('blog', 'my-post')).toBe('blog/my-post.mdx');
    });

    test('converts empty slug to index.mdx', () => {
      expect(slugToPath('blog', '')).toBe('blog/index.mdx');
    });
  });
});

describe('getParentPath', () => {
  test('returns parent for nested path', () => {
    expect(getParentPath('build/tutorials/ai-crm')).toBe('build/tutorials');
  });

  test('returns parent for two-level path', () => {
    expect(getParentPath('build/prompting')).toBe('build');
  });

  test('returns null for single-level path', () => {
    expect(getParentPath('prompting')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(getParentPath('')).toBeNull();
  });
});

describe('round-trip conversion', () => {
  test('doc path round-trips correctly', () => {
    const original = 'docs/build/tutorials/ai-crm.mdx';
    const { type, slug } = pathToSlug(original);
    const converted = slugToPath(type, slug);
    expect(converted).toBe(original);
  });

  test('blog path round-trips correctly', () => {
    const original = 'blog/my-awesome-post.mdx';
    const { type, slug } = pathToSlug(original);
    const converted = slugToPath(type, slug);
    expect(converted).toBe(original);
  });

  test('index path round-trips correctly', () => {
    const original = 'docs/index.mdx';
    const { type, slug } = pathToSlug(original);
    const converted = slugToPath(type, slug);
    expect(converted).toBe(original);
  });
});
