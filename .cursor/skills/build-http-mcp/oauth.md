# OAuth Pattern

Use this when the upstream API requires OAuth 2.0 authorization code flow (e.g., Google, GitHub OAuth Apps, Digits).

## Routes to add

Add two routes **before** `/mcp` in `src/index.ts`:

```typescript
const CLIENT_ID = process.env.OAUTH_CLIENT_ID!;
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET!;
const BASE_URL = process.env.BASE_URL!; // e.g. https://my-server.example.com
const AUTHORIZE_URL = 'https://provider.example.com/oauth/authorize';
const TOKEN_URL = 'https://provider.example.com/oauth/token';

// Step 1: Redirect user to provider
app.get('/auth/start', (_req, res) => {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', `${BASE_URL}/auth/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'required:scopes');
  res.redirect(url.toString());
});

// Step 2: Exchange code → tokens, display refresh_token to user
app.get('/auth/callback', async (req, res) => {
  const code = req.query.code as string;
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: `${BASE_URL}/auth/callback`,
      code,
    }),
  });
  const tokens = await tokenRes.json();
  // Display refresh_token — user copies it into their MCP client header
  res.send(`
    <h2>Authorization successful</h2>
    <p>Copy your refresh token into <code>X-Refresh-Token</code>:</p>
    <pre>${tokens.refresh_token}</pre>
  `);
});
```

The user visits `https://my-server.example.com/auth/start`, completes the OAuth flow, and copies the `refresh_token` from the callback page. They then pass it as `X-Refresh-Token` in MCP requests.

## Token refresh caching

Access tokens expire. Cache them in memory, keyed by refresh token, and refresh automatically.

```typescript
interface CachedToken {
  accessToken: string;
  expiresAt: number; // unix ms
}

const tokenCache = new Map<string, CachedToken>();

async function getAccessToken(refreshToken: string): Promise<string> {
  const cached = tokenCache.get(refreshToken);
  // Refresh if missing or within 60 seconds of expiry
  if (cached && cached.expiresAt - Date.now() > 60_000) {
    return cached.accessToken;
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });
  const data = await res.json();

  tokenCache.set(refreshToken, {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });

  return data.access_token;
}
```

## Wiring into `createMcpServer`

```typescript
// resolveCredential returns the refresh_token
function resolveCredential(req: Request): string | null {
  return (req.headers['x-refresh-token'] as string | undefined)
    ?? process.env.REFRESH_TOKEN ?? null;
}

function createMcpServer(refreshToken: string): McpServer {
  const server = new McpServer({ name: 'my-server', version: '1.0.0' });

  server.tool('some_tool', 'Does something.', { id: z.string() }, async ({ id }) => {
    const accessToken = await getAccessToken(refreshToken);
    const result = await callUpstreamApi(accessToken, id);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  return server;
}
```

## Env vars needed

| Var | Description |
|-----|-------------|
| `OAUTH_CLIENT_ID` | App's client ID from provider |
| `OAUTH_CLIENT_SECRET` | App's client secret |
| `BASE_URL` | Public URL of this server (for redirect URI) |
| `REFRESH_TOKEN` | Optional fallback for single-account deployments |

## Notes

- `tokenCache` is in-process memory — resets on restart. Acceptable for most MCP use cases.
- For multi-instance deployments, use Redis or a shared cache.
- The `/auth/start` and `/auth/callback` routes do **not** need the `authenticate` middleware — they're the setup flow for human users.
