/**
 * SERP API Client (ValueSerp)
 * Google search results for SEO analysis
 */

export interface SerpRequest {
  q: string;
  location?: string;
  hl?: string;
  tbm?: string;
  num?: number;
}

export interface SerpResult {
  position?: number;
  title: string;
  link: string;
  snippet?: string;
}

export interface SerpResponse {
  organic_results: SerpResult[];
  total_results?: string;
  related_searches?: string[];
  people_also_ask?: Array<{
    question: string;
    snippet: string;
    link: string;
  }>;
  local_results?: Array<{
    title: string;
    address: string;
    rating: number;
    reviews: number;
    phone?: string;
  }>;
  news_results?: Array<{
    title: string;
    link: string;
    snippet: string;
    date: string;
    source: string;
  }>;
}

export async function callSerpApi(params: SerpRequest): Promise<SerpResponse> {
  const apiKey = process.env.VALUE_SERP_API_KEY;
  if (!apiKey) {
    throw new Error('VALUE_SERP_API_KEY environment variable is not configured');
  }

  const urlParams = new URLSearchParams();
  urlParams.append('api_key', apiKey);
  urlParams.append('q', params.q);
  
  if (params.location) urlParams.append('location', params.location);
  if (params.hl) urlParams.append('hl', params.hl);
  else urlParams.append('hl', 'en');
  if (params.tbm) urlParams.append('tbm', params.tbm);
  if (params.num) urlParams.append('num', params.num.toString());

  const url = `https://api.valueserp.com/search?${urlParams.toString()}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': 'Blink-MCP/1.0' }
  });

  if (!response.ok) {
    throw new Error(`Value SERP API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return stripProviderMetadata(data);
}

function stripProviderMetadata(data: any): SerpResponse {
  const { request_info, credits_used, credits_remaining, ...cleanData } = data;
  
  const response: SerpResponse = {
    organic_results: cleanData.organic_results || []
  };

  if (cleanData.search_information?.total_results) {
    response.total_results = cleanData.search_information.total_results;
  }
  if (cleanData.related_searches) {
    response.related_searches = cleanData.related_searches.map((item: any) => item.query || item);
  }
  if (cleanData.people_also_ask) {
    response.people_also_ask = cleanData.people_also_ask.map((item: any) => ({
      question: item.question || '',
      snippet: item.snippet || '',
      link: item.link || ''
    }));
  }
  if (cleanData.local_results?.places) {
    response.local_results = cleanData.local_results.places.map((place: any) => ({
      title: place.title || '',
      address: place.address || '',
      rating: place.rating || 0,
      reviews: place.reviews || 0,
      phone: place.phone
    }));
  }
  if (cleanData.news_results) {
    response.news_results = cleanData.news_results.map((item: any) => ({
      title: item.title || '',
      link: item.link || '',
      snippet: item.snippet || '',
      date: item.date || '',
      source: item.source || ''
    }));
  }

  return response;
}
