/**
 * HTML text extraction utilities
 * Converts HTML to clean readable text
 */

export function extractTextFromHtml(html: string): { title: string; content: string } {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';
  
  // Remove script, style, and noscript tags
  let cleanHtml = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');
  
  // Convert common HTML elements to text
  cleanHtml = cleanHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n');
  
  // Remove all remaining HTML tags
  const content = cleanHtml
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&hellip;/g, '...')
    .replace(/\s+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  return { title, content };
}

/**
 * Truncate content to max length (does not add notice - caller handles that)
 */
export function truncateContent(content: string, maxLength: number): { content: string; truncated: boolean; omittedChars: number } {
  if (content.length <= maxLength) {
    return { content, truncated: false, omittedChars: 0 };
  }
  
  const truncated = content.substring(0, maxLength);
  const lastNewline = truncated.lastIndexOf('\n');
  const cleanCut = lastNewline > maxLength * 0.8 ? truncated.substring(0, lastNewline) : truncated;
  
  return {
    content: cleanCut,
    truncated: true,
    omittedChars: content.length - cleanCut.length
  };
}
