/**
 * Web Tool Handlers
 * Implementation of web search, URL fetch, and SERP operations
 */

import { getExaClient } from '../clients/exa-client.js';
import { callSerpApi, type SerpRequest } from '../clients/serp-client.js';
import { extractTextFromHtml, truncateContent } from '../utils/html-parser.js';

const MAX_CONTENT_LENGTH = 50000;

// =====================================================
// Web Search (Exa)
// =====================================================
export async function handleWebSearch(args: { query: string; max_results?: number }) {
  const { query, max_results = 10 } = args;
  
  if (!query?.trim()) {
    return { success: false, error: 'No valid query provided' };
  }
  
  try {
    const exa = getExaClient();
    
    // Use basic search (no contents) for faster results
    const response = await exa.search(query, {
      numResults: Math.min(max_results, 20),
    });
    
    const results = response.results.map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      score: r.score,
    }));
    
    return {
      success: true,
      results,
      query,
      resultCount: results.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Web search failed';
    console.error('Web search error:', error);
    return { success: false, error: message };
  }
}

// =====================================================
// Fetch URL
// =====================================================
export async function handleFetchUrl(args: { url: string }) {
  const { url } = args;
  
  // Validate URL
  let webUrl: URL;
  try {
    webUrl = new URL(url);
    if (!['http:', 'https:'].includes(webUrl.protocol)) {
      throw new Error('Only HTTP and HTTPS URLs are supported');
    }
  } catch {
    return { success: false, error: 'Invalid URL format' };
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Blink-MCP/1.0 (Web Content Fetcher)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      return { success: false, error: `Cannot access webpage (${response.status})` };
    }
    
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/xml')) {
      return { success: false, error: 'URL does not contain readable text content' };
    }
    
    const htmlContent = await response.text();
    
    if (!htmlContent || htmlContent.trim().length === 0) {
      return { success: false, error: 'Webpage returned empty content' };
    }
    
    // Extract clean text
    let title = '';
    let textContent = htmlContent;
    
    if (contentType.includes('text/html')) {
      const extracted = extractTextFromHtml(htmlContent);
      title = extracted.title;
      textContent = extracted.content;
    }
    
    // Truncate if too long
    const processed = truncateContent(textContent, MAX_CONTENT_LENGTH);
    
    return {
      success: true,
      url,
      title: title || webUrl.hostname,
      content: processed.content,
      contentType,
      size: textContent.length,
      truncated: processed.truncated,
      omittedChars: processed.omittedChars,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch webpage';
    console.error('Fetch URL error:', error);
    return { success: false, error: message };
  }
}

// =====================================================
// Google SERP
// =====================================================
export async function handleGoogleSerp(args: SerpRequest) {
  const { q, location, hl, tbm, num } = args;
  
  if (!q?.trim()) {
    return { success: false, error: 'Search query (q) is required' };
  }
  
  try {
    const results = await callSerpApi({ q, location, hl, tbm, num });
    
    return {
      success: true,
      query: q,
      ...results,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SERP request failed';
    console.error('Google SERP error:', error);
    return { success: false, error: message };
  }
}
