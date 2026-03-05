/**
 * Web Tool Definitions
 * Tools for web search, URL fetching, and SERP analysis
 */

import { z } from 'zod';

export const webToolSchemas = {
  web_search: z.object({
    query: z.string().describe('Search query string. Use natural language for best results.'),
    max_results: z.number().min(1).max(20).optional().describe('Maximum results (default: 10, max: 20).'),
  }),

  fetch_url: z.object({
    url: z.string().describe('The web page URL to fetch. Must be a valid HTTP/HTTPS URL.'),
  }),

  google_serp: z.object({
    q: z.string().describe('Search query (required)'),
    location: z.string().optional().describe('Location for localized results, e.g. "San Francisco,CA,United States"'),
    hl: z.string().optional().describe('Language code (default: "en")'),
    tbm: z.string().optional().describe('Search type: "nws" for news, "isch" for images'),
    num: z.number().optional().describe('Number of results to return'),
  }),
};

export const webToolDescriptions: Record<string, string> = {
  web_search: `Search the web for real-time information using Exa AI. Returns relevant results with titles, URLs, and snippets.

WHEN TO USE:
- Current events, news, and time-sensitive information
- Latest documentation, API references, and technical guides
- Research and fact-checking
- Any query requiring information beyond LLM's knowledge cutoff

QUERY TIPS:
- Be specific and descriptive for better results
- Use natural language queries (not keyword stuffing)

LIMITATIONS:
- Returns search results, not full page content
- For full page content, use fetch_url on specific URLs from results`,

  fetch_url: `Fetches and extracts clean text content from any web page URL for reading and analysis.

WHEN TO USE:
- Reading documentation, articles, blog posts
- Extracting content from URLs in search results
- Accessing Google Sheets, Google Docs as text
- Any content-focused web access

WHAT IT DOES:
- Fetches the webpage
- Extracts clean readable text (removes scripts, styles, HTML tags)
- Returns title and text content

LIMITATIONS:
- Content over 50000 chars is truncated
- Only works with public/accessible URLs
- Cannot execute JavaScript or interact with pages`,

  google_serp: `Get Google Search Engine Results Page (SERP) data for SEO analysis.

WHEN TO USE:
- SEO keyword research and ranking analysis
- Competitive analysis
- Finding "People Also Ask" questions
- Local search results analysis
- News and shopping results

WHAT IT RETURNS:
- Organic search results with position, title, link, snippet
- Related searches
- People Also Ask questions
- Local results (if applicable)
- News results (if applicable)

PARAMETERS:
- q: Search query (required)
- location: For localized results
- hl: Language code (default: en)
- tbm: "nws" for news, "isch" for images
- num: Number of results`,
};
