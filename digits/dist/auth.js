// Digits OAuth 2.0 token management
// Access tokens expire after 1 hour — auto-refresh using stored refresh_token
const TOKEN_URL = 'https://connect.digits.com/v1/oauth/token';
// In-memory cache: refresh_token → TokenSet
const cache = new Map();
export async function getAccessToken(clientId, clientSecret, refreshToken) {
    const cached = cache.get(refreshToken);
    if (cached && cached.expires_at > Date.now() + 60_000) {
        return cached.access_token;
    }
    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            grant_type: 'refresh_token',
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
        }),
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Digits token refresh failed (${res.status}): ${body}`);
    }
    const data = (await res.json());
    const tokenSet = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + data.expires_in * 1000,
    };
    cache.set(refreshToken, tokenSet);
    // Also cache by new refresh token if it rotated
    if (data.refresh_token !== refreshToken) {
        cache.set(data.refresh_token, tokenSet);
    }
    return tokenSet.access_token;
}
export async function exchangeCode(clientId, clientSecret, code, redirectUri) {
    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            grant_type: 'authorization_code',
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri,
        }),
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Digits code exchange failed (${res.status}): ${body}`);
    }
    return res.json();
}
//# sourceMappingURL=auth.js.map