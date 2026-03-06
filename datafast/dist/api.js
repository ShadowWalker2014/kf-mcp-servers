// DataFast API client
// Base URL: https://datafa.st/api/v1/
// Auth: Authorization: Bearer <API_KEY>
const BASE = 'https://datafa.st/api/v1';
async function request(apiKey, path, method = 'GET', body) {
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
    const json = (await res.json());
    if (json.status !== 'success')
        throw new Error(`DataFast API error: ${JSON.stringify(json.error)}`);
    return json.data;
}
// ─── Shared query param builder ───────────────────────────────────────────────
export function buildParams(params) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== '')
            p.set(k, String(v));
    }
    const str = p.toString();
    return str ? `?${str}` : '';
}
// ─── Analytics endpoints ───────────────────────────────────────────────────────
export async function getOverview(apiKey, params) {
    return request(apiKey, `/analytics/overview${buildParams(params)}`);
}
export async function getTimeseries(apiKey, params) {
    return request(apiKey, `/analytics/timeseries${buildParams(params)}`);
}
export async function getRealtime(apiKey) {
    return request(apiKey, '/analytics/realtime');
}
export async function getRealtimeMap(apiKey) {
    return request(apiKey, '/analytics/realtime/map');
}
export async function getMetadata(apiKey) {
    return request(apiKey, '/analytics/metadata');
}
export async function getPages(apiKey, params) {
    return request(apiKey, `/analytics/pages${buildParams(params)}`);
}
export async function getReferrers(apiKey, params) {
    return request(apiKey, `/analytics/referrers${buildParams(params)}`);
}
export async function getCampaigns(apiKey, params) {
    return request(apiKey, `/analytics/campaigns${buildParams(params)}`);
}
export async function getGoals(apiKey, params) {
    return request(apiKey, `/analytics/goals${buildParams(params)}`);
}
export async function getCountries(apiKey, params) {
    return request(apiKey, `/analytics/countries${buildParams(params)}`);
}
export async function getRegions(apiKey, params) {
    return request(apiKey, `/analytics/regions${buildParams(params)}`);
}
export async function getCities(apiKey, params) {
    return request(apiKey, `/analytics/cities${buildParams(params)}`);
}
export async function getDevices(apiKey, params) {
    return request(apiKey, `/analytics/devices${buildParams(params)}`);
}
export async function getBrowsers(apiKey, params) {
    return request(apiKey, `/analytics/browsers${buildParams(params)}`);
}
export async function getOperatingSystems(apiKey, params) {
    return request(apiKey, `/analytics/operating-systems${buildParams(params)}`);
}
export async function getHostnames(apiKey, params) {
    return request(apiKey, `/analytics/hostnames${buildParams(params)}`);
}
// ─── Visitor ───────────────────────────────────────────────────────────────────
export async function getVisitor(apiKey, visitorId) {
    return request(apiKey, `/visitors/${encodeURIComponent(visitorId)}`);
}
// ─── Goals ─────────────────────────────────────────────────────────────────────
export async function trackGoal(apiKey, payload) {
    return request(apiKey, '/goals', 'POST', payload);
}
export async function deleteGoals(apiKey, params) {
    return request(apiKey, `/goals${buildParams(params)}`, 'DELETE');
}
// ─── Payments ──────────────────────────────────────────────────────────────────
export async function trackPayment(apiKey, payload) {
    return request(apiKey, '/payments', 'POST', payload);
}
export async function deletePayments(apiKey, params) {
    return request(apiKey, `/payments${buildParams(params)}`, 'DELETE');
}
//# sourceMappingURL=api.js.map