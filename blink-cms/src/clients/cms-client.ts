/**
 * CMS API Client
 * Handles communication with blink.new CMS API
 */

// Lazy-loaded env vars
function getCmsApiUrl(): string {
  return process.env.CMS_API_URL || 'https://blink.new/api/cms';
}

function getMcpApiKey(): string {
  const key = process.env.MCP_API_KEY;
  if (!key) throw new Error('MCP_API_KEY environment variable is not configured');
  return key;
}

export async function cmsRequest(path: string, options: RequestInit = {}): Promise<any> {
  const apiKey = getMcpApiKey();
  const url = `${getCmsApiUrl()}${path}`;
  
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...options.headers,
    },
  });
  
  if (!res.ok) {
    const text = await res.text();
    console.error(`CMS Error: API ${res.status}: ${text.slice(0, 200)}`);
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }
  
  const contentType = res.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    return res.json();
  }
  
  return null;
}

export async function revalidateContent(type: 'doc' | 'blog', slug?: string): Promise<void> {
  try {
    await cmsRequest('/revalidate', {
      method: 'POST',
      body: JSON.stringify({ type, slug }),
    });
  } catch (error) {
    console.error('Revalidation failed:', error);
  }
}
