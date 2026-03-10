const BASE = 'https://api.tolt.com/v1';
async function request(apiKey, method, path, params) {
    const url = new URL(`${BASE}${path}`);
    const init = {
        method,
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
    };
    if (method === 'GET' && params) {
        for (const [k, v] of Object.entries(params)) {
            if (v === undefined || v === null)
                continue;
            if (Array.isArray(v)) {
                for (const item of v)
                    url.searchParams.append(`${k}[]`, String(item));
            }
            else {
                url.searchParams.set(k, String(v));
            }
        }
    }
    else if (params && Object.keys(params).length > 0) {
        init.body = JSON.stringify(params);
    }
    const res = await fetch(url.toString(), init);
    return res.json();
}
// Partners
export const listPartners = (key, p) => request(key, 'GET', '/partners', p);
export const getPartner = (key, id) => request(key, 'GET', `/partners/${id}`);
export const createPartner = (key, body) => request(key, 'POST', '/partners', body);
export const updatePartner = (key, id, body) => request(key, 'PATCH', `/partners/${id}`, body);
export const deletePartner = (key, id) => request(key, 'DELETE', `/partners/${id}`);
// Customers
export const listCustomers = (key, p) => request(key, 'GET', '/customers', p);
export const getCustomer = (key, id) => request(key, 'GET', `/customers/${id}`);
export const createCustomer = (key, body) => request(key, 'POST', '/customers', body);
export const updateCustomer = (key, id, body) => request(key, 'PATCH', `/customers/${id}`, body);
export const deleteCustomer = (key, id) => request(key, 'DELETE', `/customers/${id}`);
// Transactions
export const listTransactions = (key, p) => request(key, 'GET', '/transactions', p);
export const getTransaction = (key, id) => request(key, 'GET', `/transactions/${id}`);
export const createTransaction = (key, body) => request(key, 'POST', '/transactions', body);
export const updateTransaction = (key, id, body) => request(key, 'PATCH', `/transactions/${id}`, body);
export const deleteTransaction = (key, id) => request(key, 'DELETE', `/transactions/${id}`);
export const refundTransaction = (key, id) => request(key, 'POST', `/transactions/${id}/refund`);
// Commissions
export const listCommissions = (key, p) => request(key, 'GET', '/commissions', p);
export const getCommission = (key, id) => request(key, 'GET', `/commissions/${id}`);
export const createCommission = (key, body) => request(key, 'POST', '/commissions', body);
export const updateCommission = (key, id, body) => request(key, 'PATCH', `/commissions/${id}`, body);
export const deleteCommission = (key, id) => request(key, 'DELETE', `/commissions/${id}`);
// Links
export const listLinks = (key, p) => request(key, 'GET', '/links', p);
export const getLink = (key, id) => request(key, 'GET', `/links/${id}`);
export const createLink = (key, body) => request(key, 'POST', '/links', body);
export const updateLink = (key, id, body) => request(key, 'PATCH', `/links/${id}`, body);
export const deleteLink = (key, id) => request(key, 'DELETE', `/links/${id}`);
// Clicks
export const createClick = (key, body) => request(key, 'POST', '/clicks', body);
// Promotion Codes
export const listPromoCodes = (key, p) => request(key, 'GET', '/promotion-codes', p);
export const getPromoCode = (key, id) => request(key, 'GET', `/promotion-codes/${id}`);
export const createPromoCode = (key, body) => request(key, 'POST', '/promotion-codes', body);
export const updatePromoCode = (key, id, body) => request(key, 'PATCH', `/promotion-codes/${id}`, body);
export const deletePromoCode = (key, id) => request(key, 'DELETE', `/promotion-codes/${id}`);
//# sourceMappingURL=api.js.map