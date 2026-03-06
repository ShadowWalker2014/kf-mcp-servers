// DataFast API client
// Base URL: https://datafa.st/api/v1/
// Auth: Authorization: Bearer <API_KEY>

const BASE = 'https://datafa.st/api/v1';

async function request<T>(
  apiKey: string,
  path: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DataFast API HTTP ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { status: string; data?: T; error?: unknown };
  if (json.status !== 'success') throw new Error(`DataFast API error: ${JSON.stringify(json.error)}`);
  return json.data as T;
}

// ─── Shared query param builder ───────────────────────────────────────────────

export function buildParams(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const str = p.toString();
  return str ? `?${str}` : '';
}

// ─── Analytics endpoints ───────────────────────────────────────────────────────

export async function getOverview(apiKey: string, params: {
  startAt?: string; endAt?: string; timezone?: string; fields?: string;
}) {
  return request<object[]>(apiKey, `/analytics/overview${buildParams(params)}`);
}

export async function getTimeseries(apiKey: string, params: {
  fields?: string; interval?: string; startAt?: string; endAt?: string;
  timezone?: string; limit?: number; offset?: number;
  filter_country?: string; filter_device?: string; filter_referrer?: string;
  filter_page?: string; filter_utm_source?: string; filter_utm_medium?: string;
  filter_utm_campaign?: string; filter_utm_content?: string; filter_utm_term?: string;
  filter_browser?: string; filter_os?: string; filter_hostname?: string;
}) {
  return request<object>(apiKey, `/analytics/timeseries${buildParams(params as Record<string, string | number | boolean | undefined>)}`);
}

export async function getRealtime(apiKey: string) {
  return request<object[]>(apiKey, '/analytics/realtime');
}

export async function getRealtimeMap(apiKey: string) {
  return request<object>(apiKey, '/analytics/realtime/map');
}

export async function getMetadata(apiKey: string) {
  return request<object[]>(apiKey, '/analytics/metadata');
}

export async function getPages(apiKey: string, params: {
  startAt?: string; endAt?: string; timezone?: string; limit?: number; offset?: number;
  filter_country?: string; filter_device?: string; filter_referrer?: string;
}) {
  return request<object>(apiKey, `/analytics/pages${buildParams(params as Record<string, string | number | boolean | undefined>)}`);
}

export async function getReferrers(apiKey: string, params: {
  startAt?: string; endAt?: string; timezone?: string; limit?: number; offset?: number;
  filter_country?: string; filter_device?: string; filter_page?: string;
}) {
  return request<object>(apiKey, `/analytics/referrers${buildParams(params as Record<string, string | number | boolean | undefined>)}`);
}

export async function getCampaigns(apiKey: string, params: {
  startAt?: string; endAt?: string; timezone?: string; limit?: number; offset?: number;
  fields?: string;
}) {
  return request<object>(apiKey, `/analytics/campaigns${buildParams(params as Record<string, string | number | boolean | undefined>)}`);
}

export async function getGoals(apiKey: string, params: {
  startAt?: string; endAt?: string; timezone?: string; limit?: number; offset?: number;
  fields?: string;
}) {
  return request<object>(apiKey, `/analytics/goals${buildParams(params as Record<string, string | number | boolean | undefined>)}`);
}

export async function getCountries(apiKey: string, params: {
  startAt?: string; endAt?: string; timezone?: string; limit?: number; offset?: number;
  filter_device?: string; filter_referrer?: string; filter_page?: string;
}) {
  return request<object>(apiKey, `/analytics/countries${buildParams(params as Record<string, string | number | boolean | undefined>)}`);
}

export async function getRegions(apiKey: string, params: {
  startAt?: string; endAt?: string; timezone?: string; limit?: number; offset?: number;
}) {
  return request<object>(apiKey, `/analytics/regions${buildParams(params as Record<string, string | number | boolean | undefined>)}`);
}

export async function getCities(apiKey: string, params: {
  startAt?: string; endAt?: string; timezone?: string; limit?: number; offset?: number;
}) {
  return request<object>(apiKey, `/analytics/cities${buildParams(params as Record<string, string | number | boolean | undefined>)}`);
}

export async function getDevices(apiKey: string, params: {
  startAt?: string; endAt?: string; timezone?: string; limit?: number; offset?: number;
  filter_country?: string; filter_referrer?: string; filter_page?: string;
}) {
  return request<object>(apiKey, `/analytics/devices${buildParams(params as Record<string, string | number | boolean | undefined>)}`);
}

export async function getBrowsers(apiKey: string, params: {
  startAt?: string; endAt?: string; timezone?: string; limit?: number; offset?: number;
}) {
  return request<object>(apiKey, `/analytics/browsers${buildParams(params as Record<string, string | number | boolean | undefined>)}`);
}

export async function getOperatingSystems(apiKey: string, params: {
  startAt?: string; endAt?: string; timezone?: string; limit?: number; offset?: number;
}) {
  return request<object>(apiKey, `/analytics/operating-systems${buildParams(params as Record<string, string | number | boolean | undefined>)}`);
}

export async function getHostnames(apiKey: string, params: {
  startAt?: string; endAt?: string; timezone?: string; limit?: number; offset?: number;
}) {
  return request<object>(apiKey, `/analytics/hostnames${buildParams(params as Record<string, string | number | boolean | undefined>)}`);
}

// ─── Visitor ───────────────────────────────────────────────────────────────────

export async function getVisitor(apiKey: string, visitorId: string) {
  return request<object>(apiKey, `/visitors/${encodeURIComponent(visitorId)}`);
}

// ─── Goals ─────────────────────────────────────────────────────────────────────

export async function trackGoal(apiKey: string, payload: {
  datafast_visitor_id: string;
  name: string;
  metadata?: Record<string, string>;
}) {
  return request<object>(apiKey, '/goals', 'POST', payload);
}

export async function deleteGoals(apiKey: string, params: {
  datafast_visitor_id?: string;
  name?: string;
  startAt?: string;
  endAt?: string;
}) {
  return request<object>(apiKey, `/goals${buildParams(params as Record<string, string | number | boolean | undefined>)}`, 'DELETE');
}

// ─── Payments ──────────────────────────────────────────────────────────────────

export async function trackPayment(apiKey: string, payload: {
  amount: number;
  currency: string;
  transaction_id: string;
  datafast_visitor_id?: string;
  email?: string;
  name?: string;
  customer_id?: string;
  renewal?: boolean;
  refunded?: boolean;
  timestamp?: string;
}) {
  return request<object>(apiKey, '/payments', 'POST', payload);
}

export async function deletePayments(apiKey: string, params: {
  transaction_id?: string;
  datafast_visitor_id?: string;
  startAt?: string;
  endAt?: string;
}) {
  return request<object>(apiKey, `/payments${buildParams(params as Record<string, string | number | boolean | undefined>)}`, 'DELETE');
}
