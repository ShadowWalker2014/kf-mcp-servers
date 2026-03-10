const BASE = 'https://api.tolt.com/v1';

async function request(apiKey: string, method: string, path: string, params?: Record<string, unknown>) {
  const url = new URL(`${BASE}${path}`);
  const init: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  };

  if (method === 'GET' && params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(`${k}[]`, String(item));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  } else if (params && Object.keys(params).length > 0) {
    init.body = JSON.stringify(params);
  }

  const res = await fetch(url.toString(), init);
  return res.json();
}

// Partners
export const listPartners = (key: string, p: Record<string, unknown>) => request(key, 'GET', '/partners', p);
export const getPartner = (key: string, id: string) => request(key, 'GET', `/partners/${id}`);
export const createPartner = (key: string, body: Record<string, unknown>) => request(key, 'POST', '/partners', body);
export const updatePartner = (key: string, id: string, body: Record<string, unknown>) => request(key, 'PATCH', `/partners/${id}`, body);
export const deletePartner = (key: string, id: string) => request(key, 'DELETE', `/partners/${id}`);

// Customers
export const listCustomers = (key: string, p: Record<string, unknown>) => request(key, 'GET', '/customers', p);
export const getCustomer = (key: string, id: string) => request(key, 'GET', `/customers/${id}`);
export const createCustomer = (key: string, body: Record<string, unknown>) => request(key, 'POST', '/customers', body);
export const updateCustomer = (key: string, id: string, body: Record<string, unknown>) => request(key, 'PATCH', `/customers/${id}`, body);
export const deleteCustomer = (key: string, id: string) => request(key, 'DELETE', `/customers/${id}`);

// Transactions
export const listTransactions = (key: string, p: Record<string, unknown>) => request(key, 'GET', '/transactions', p);
export const getTransaction = (key: string, id: string) => request(key, 'GET', `/transactions/${id}`);
export const createTransaction = (key: string, body: Record<string, unknown>) => request(key, 'POST', '/transactions', body);
export const updateTransaction = (key: string, id: string, body: Record<string, unknown>) => request(key, 'PATCH', `/transactions/${id}`, body);
export const deleteTransaction = (key: string, id: string) => request(key, 'DELETE', `/transactions/${id}`);
export const refundTransaction = (key: string, id: string) => request(key, 'POST', `/transactions/${id}/refund`);

// Commissions
export const listCommissions = (key: string, p: Record<string, unknown>) => request(key, 'GET', '/commissions', p);
export const getCommission = (key: string, id: string) => request(key, 'GET', `/commissions/${id}`);
export const createCommission = (key: string, body: Record<string, unknown>) => request(key, 'POST', '/commissions', body);
export const updateCommission = (key: string, id: string, body: Record<string, unknown>) => request(key, 'PATCH', `/commissions/${id}`, body);
export const deleteCommission = (key: string, id: string) => request(key, 'DELETE', `/commissions/${id}`);

// Links
export const listLinks = (key: string, p: Record<string, unknown>) => request(key, 'GET', '/links', p);
export const getLink = (key: string, id: string) => request(key, 'GET', `/links/${id}`);
export const createLink = (key: string, body: Record<string, unknown>) => request(key, 'POST', '/links', body);
export const updateLink = (key: string, id: string, body: Record<string, unknown>) => request(key, 'PATCH', `/links/${id}`, body);
export const deleteLink = (key: string, id: string) => request(key, 'DELETE', `/links/${id}`);

// Clicks
export const createClick = (key: string, body: Record<string, unknown>) => request(key, 'POST', '/clicks', body);

// Promotion Codes
export const listPromoCodes = (key: string, p: Record<string, unknown>) => request(key, 'GET', '/promotion-codes', p);
export const getPromoCode = (key: string, id: string) => request(key, 'GET', `/promotion-codes/${id}`);
export const createPromoCode = (key: string, body: Record<string, unknown>) => request(key, 'POST', '/promotion-codes', body);
export const updatePromoCode = (key: string, id: string, body: Record<string, unknown>) => request(key, 'PATCH', `/promotion-codes/${id}`, body);
export const deletePromoCode = (key: string, id: string) => request(key, 'DELETE', `/promotion-codes/${id}`);
