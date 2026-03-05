const CMS_API_URL = process.env.CMS_API_URL || 'https://blink.new/api/cms';
const CMS_API_KEY = process.env.CMS_API_KEY;

console.log(`CMS Client initialized: URL=${CMS_API_URL}, KEY=${CMS_API_KEY ? 'SET' : 'NOT SET'}`);

export async function cmsRequest(path: string, options: RequestInit = {}): Promise<any> {
  if (!CMS_API_KEY) {
    throw new Error('CMS_API_KEY not set');
  }

  const url = `${CMS_API_URL}${path}`;
  console.log(`CMS Request: ${options.method || 'GET'} ${url}`);
  
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CMS_API_KEY}`,
        ...options.headers,
      },
    });
    
    console.log(`CMS Response: ${res.status}`);
    
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
    }
    
    const contentType = res.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return res.json();
    }
    
    return null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`CMS Error: ${msg}`);
    throw new Error(`CMS: ${msg}`);
  }
}

// Trigger cache revalidation after content changes (for SEO/performance)
export async function revalidateContent(type: 'doc' | 'blog', slug?: string): Promise<void> {
  try {
    await cmsRequest('/revalidate', {
      method: 'POST',
      body: JSON.stringify({ type, slug }),
    });
    console.log(`Cache revalidated: ${type}${slug ? `/${slug}` : ''}`);
  } catch (error) {
    // Don't throw - revalidation failure shouldn't break write operations
    console.error('Revalidation failed:', error);
  }
}
