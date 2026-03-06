// Digits Connect API client
const BASE = 'https://connect.digits.com/v1';
async function get(token, path, params) {
    const url = new URL(`${BASE}${path}`);
    if (params)
        Object.entries(params).forEach(([k, v]) => { if (v)
            url.searchParams.set(k, v); });
    const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Digits API GET ${path} → ${res.status}: ${body}`);
    }
    return res.json();
}
async function post(token, path, body) {
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Digits API POST ${path} → ${res.status}: ${text}`);
    }
    return res.json();
}
// ─── Company ──────────────────────────────────────────────────────────────────
export const getCompany = (token) => get(token, '/company');
// ─── Categories (Chart of Accounts) ───────────────────────────────────────────
export const getCategories = (token) => get(token, '/ledger/categories');
// ─── Parties (Vendors / Customers) ────────────────────────────────────────────
export const getParties = (token) => get(token, '/ledger/parties');
// ─── Sources (Bank Feeds) ─────────────────────────────────────────────────────
export const getSources = (token) => get(token, '/connections/sources');
// ─── Financial Statements ─────────────────────────────────────────────────────
export const getProfitAndLoss = (token, params) => get(token, '/ledger/statement/profit-and-loss', params);
export const getBalanceSheet = (token, params) => get(token, '/ledger/statement/balance-sheet', params);
export const getCashFlow = (token, params) => get(token, '/ledger/statement/cash-flow', params);
// ─── Transactions / Entries ───────────────────────────────────────────────────
export const listEntries = (token, params) => get(token, '/ledger/entries', params);
export const queryEntries = (token, filters) => {
    const { limit, cursor, ...rest } = filters;
    return post(token, '/ledger/entries/query', { filters: rest, limit, cursor });
};
export const getTransaction = (token, transactionId) => get(token, `/ledger/transactions/${transactionId}`);
//# sourceMappingURL=api.js.map