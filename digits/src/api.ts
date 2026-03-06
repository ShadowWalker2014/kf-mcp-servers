// Digits Connect API client
const BASE = 'https://connect.digits.com/v1';

async function get<T>(token: string, path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.set(k, v); });

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Digits API GET ${path} → ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(token: string, path: string, body: unknown): Promise<T> {
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
  return res.json() as Promise<T>;
}

// ─── Company ──────────────────────────────────────────────────────────────────

export const getCompany = (token: string) =>
  get<object>(token, '/company');

// ─── Categories (Chart of Accounts) ───────────────────────────────────────────

export const getCategories = (token: string) =>
  get<object>(token, '/ledger/categories');

// ─── Parties (Vendors / Customers) ────────────────────────────────────────────

export const getParties = (token: string) =>
  get<object>(token, '/ledger/parties');

// ─── Sources (Bank Feeds) ─────────────────────────────────────────────────────

export const getSources = (token: string) =>
  get<object>(token, '/connections/sources');

// ─── Financial Statements ─────────────────────────────────────────────────────

export const getProfitAndLoss = (token: string, params: {
  startDate?: string; endDate?: string;
  interval?: 'Month' | 'Quarter' | 'Year';
  fiscalYearStartMonth?: string;
}) => get<object>(token, '/ledger/statement/profit-and-loss', params as Record<string, string>);

export const getBalanceSheet = (token: string, params: {
  startDate?: string; endDate?: string;
  interval?: 'Month' | 'Quarter' | 'Year';
  fiscalYearStartMonth?: string;
}) => get<object>(token, '/ledger/statement/balance-sheet', params as Record<string, string>);

export const getCashFlow = (token: string, params: {
  startDate?: string; endDate?: string;
  interval?: 'Month' | 'Quarter' | 'Year';
  fiscalYearStartMonth?: string;
}) => get<object>(token, '/ledger/statement/cash-flow', params as Record<string, string>);

// ─── Transactions / Entries ───────────────────────────────────────────────────

export const listEntries = (token: string, params?: {
  limit?: string; cursor?: string;
}) => get<object>(token, '/ledger/entries', params);

export const queryEntries = (token: string, filters: {
  occurredAfter?: string;
  occurredBefore?: string;
  minimumAmount?: number;
  maximumAmount?: number;
  filterTerm?: string;
  fieldSearchTerm?: { field: string; term: string };
  partyIds?: string[];
  categoryIds?: string[];
  categoryTypes?: string[];
  departmentIds?: string[];
  locationIds?: string[];
  type?: 'Credit' | 'Debit';
  linkedObjectType?: 'Bill' | 'Invoice';
  limit?: number;
  cursor?: string;
}) => {
  const { limit, cursor, ...rest } = filters;
  return post<object>(token, '/ledger/entries/query', { filters: rest, limit, cursor });
};

export const getTransaction = (token: string, transactionId: string) =>
  get<object>(token, `/ledger/transactions/${transactionId}`);
