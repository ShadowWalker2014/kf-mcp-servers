---
name: add-mcp-oauth
description: Add MCP OAuth 2.0 (DCR + PKCE) to an existing HTTP MCP server so Claude Code, Claude Desktop, and other spec-compliant MCP clients can authenticate. Use when the client errors with "Cannot POST /register", "Invalid OAuth error response", "needs authentication", or when adding any new HTTP MCP server that needs per-user upstream credentials.
---

# Add MCP OAuth 2.0 to an HTTP MCP Server

Claude Code follows the **MCP 2025-06-18 spec**, which requires OAuth 2.0 with Dynamic Client Registration + PKCE. A static `Authorization: Bearer <api-key>` gate is NOT OAuth — clients hit `Cannot POST /register` and give up before reaching `/mcp`.

Use this skill **in addition to** `build-http-mcp/SKILL.md` — that one covers the base server, this one bolts OAuth on top.

## Mental model

Your MCP server plays **three roles** at once:
1. **Resource server** — `/mcp` endpoint that validates Bearer tokens.
2. **Authorization server** — issues those tokens via `/authorize` + `/token`.
3. **Consent UI** — the HTML page where the user pastes the *upstream* credential (Railway token, Stripe key, etc.) that the access token will be bound to.

The trick that makes this trivial: **all three "tokens" (client_id, auth code, access_token) are AES-GCM-sealed JSON blobs.** No database, no Maps, no Redis. The token IS the state. Works across container restarts and horizontal replicas.

## The five endpoints Claude Code probes (in order)

| Endpoint | Purpose | Returns |
|----------|---------|---------|
| `POST /mcp` (no auth) | Triggers discovery | **401 with `WWW-Authenticate: Bearer resource_metadata="<url>"`** |
| `GET /.well-known/oauth-protected-resource` | Points at the AS | `{ resource, authorization_servers, scopes_supported }` |
| `GET /.well-known/oauth-authorization-server` | AS metadata | `{ authorization_endpoint, token_endpoint, registration_endpoint, code_challenge_methods_supported }` |
| `POST /register` (RFC 7591 DCR) | Mints `client_id` per client install | `{ client_id, redirect_uris, ... }` |
| `GET /authorize` → `POST /authorize` → `POST /token` | PKCE consent flow | Bearer access token |

Without **all five**, Claude Code's auto-OAuth aborts.

## Drop-in `src/oauth.ts`

Copy this file verbatim into a new MCP server. Replace `UPSTREAM_TOKEN_LABEL` and the placeholder copy in the consent page with your provider's name (Railway, Stripe, etc.). See `railway/src/oauth.ts` in this repo for a complete production example.

```typescript
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import express, { Express, Request, Response } from 'express';

// ─── Stateless encrypted-token design ─────────────────────────────────────────
// All issued credentials (client_id, auth code, access token) are AES-256-GCM
// sealed JSON envelopes. No in-memory state — tokens survive restarts and
// horizontal replicas as long as the signing key env var is stable.

const SIGNING_KEY: Buffer = (() => {
  const explicit = process.env.OAUTH_SIGNING_KEY || process.env.MCP_API_KEY;
  if (explicit) return createHash('sha256').update(explicit).digest();
  console.warn('[oauth] No OAUTH_SIGNING_KEY/MCP_API_KEY — using ephemeral key (tokens lost on restart).');
  return randomBytes(32);
})();

function seal(payload: object): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', SIGNING_KEY, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')), cipher.final()]);
  return Buffer.concat([iv, ct, cipher.getAuthTag()]).toString('base64url');
}

function unseal<T = any>(token: string): T | null {
  try {
    const buf = Buffer.from(token, 'base64url');
    if (buf.length < 28) return null;
    const decipher = createDecipheriv('aes-256-gcm', SIGNING_KEY, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(buf.length - 16));
    const pt = Buffer.concat([decipher.update(buf.subarray(12, buf.length - 16)), decipher.final()]);
    return JSON.parse(pt.toString('utf8')) as T;
  } catch { return null; }
}

interface SealedClient { t: 'c'; cid: string; uris: string[]; name?: string; iat: number; }
interface SealedAuthCode { t: 'ac'; cid: string; uri: string; cc: string; ccm: 'S256' | 'plain'; ut: string; exp: number; }
interface SealedAccessToken { t: 'at'; cid: string; ut: string; exp: number; }
// `ut` = upstream token (the Railway/Stripe/etc. credential bound at /authorize)

export function getBaseUrl(req: Request): string {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0].trim()
    || (req as any).protocol || 'https';
  const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

/** Returns the upstream token bound to a valid OAuth access token, or null. */
export function lookupAccessToken(token: string): string | null {
  const entry = unseal<SealedAccessToken>(token);
  if (!entry || entry.t !== 'at' || entry.exp < Date.now()) return null;
  return entry.ut;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// Customize this for your upstream provider
const UPSTREAM = {
  name: 'Railway',                         // shown to user
  tokenLabel: 'Railway account token',     // form label
  tokenPlaceholder: 'rwy_...',
  tokenDocsUrl: 'https://railway.com/account/tokens',
};

function renderAuthorizePage(p: {
  client_id: string; redirect_uri: string; state: string;
  code_challenge: string; code_challenge_method: string; scope: string; client_name: string;
}): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Authorize ${UPSTREAM.name} MCP</title>
<style>body{font-family:system-ui;background:#0b0d12;color:#e6e6e6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
.card{background:#15181f;border:1px solid #262a33;border-radius:12px;padding:32px;max-width:480px;width:100%}
h1{font-size:20px;margin:0 0 8px}p{color:#9aa1ad;font-size:14px;line-height:1.5}label{display:block;font-size:13px;margin:16px 0 6px}
input{width:100%;box-sizing:border-box;background:#0b0d12;border:1px solid #2a2f3a;color:#e6e6e6;padding:12px;border-radius:8px;font-family:ui-monospace,monospace;font-size:13px}
button{margin-top:20px;width:100%;background:#6366f1;color:white;border:0;padding:12px;border-radius:8px;font-weight:600;cursor:pointer}
a{color:#8b9aff}</style></head><body><div class="card">
<h1>Authorize ${UPSTREAM.name} MCP</h1>
<p><b>${escapeHtml(p.client_name)}</b> wants to access your ${UPSTREAM.name} account.</p>
<p>Paste a ${UPSTREAM.tokenLabel} to authorize. Create one at <a href="${UPSTREAM.tokenDocsUrl}" target="_blank">${UPSTREAM.tokenDocsUrl}</a>.</p>
<form method="POST" action="/authorize">
<label>${UPSTREAM.tokenLabel}</label>
<input name="upstream_token" type="password" autocomplete="off" required placeholder="${UPSTREAM.tokenPlaceholder}"/>
<input type="hidden" name="client_id" value="${escapeHtml(p.client_id)}"/>
<input type="hidden" name="redirect_uri" value="${escapeHtml(p.redirect_uri)}"/>
<input type="hidden" name="state" value="${escapeHtml(p.state)}"/>
<input type="hidden" name="code_challenge" value="${escapeHtml(p.code_challenge)}"/>
<input type="hidden" name="code_challenge_method" value="${escapeHtml(p.code_challenge_method)}"/>
<input type="hidden" name="scope" value="${escapeHtml(p.scope)}"/>
<button type="submit">Authorize</button></form></div></body></html>`;
}

export function mountOAuth(app: Express): void {
  const urlencoded = express.urlencoded({ extended: true });

  // ─── Discovery ───────────────────────────────────────────────────────────
  const prMeta = (req: Request, res: Response) => {
    const base = getBaseUrl(req);
    res.json({
      resource: `${base}/mcp`,
      authorization_servers: [base],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp'],
    });
  };
  app.get('/.well-known/oauth-protected-resource', prMeta);
  app.get('/.well-known/oauth-protected-resource/mcp', prMeta);

  const asMeta = (req: Request, res: Response) => {
    const base = getBaseUrl(req);
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256', 'plain'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['mcp'],
    });
  };
  app.get('/.well-known/oauth-authorization-server', asMeta);
  app.get('/.well-known/oauth-authorization-server/mcp', asMeta);
  app.get('/.well-known/openid-configuration', asMeta);

  // ─── Dynamic Client Registration (RFC 7591) ──────────────────────────────
  app.post('/register', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const redirect_uris = Array.isArray(body.redirect_uris) ? (body.redirect_uris as string[]) : [];
    const client_name = typeof body.client_name === 'string' ? body.client_name : 'MCP Client';
    if (!redirect_uris.length) {
      res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris required' });
      return;
    }
    const cid = randomBytes(16).toString('base64url');
    const client_id = seal({ t: 'c', cid, uris: redirect_uris, name: client_name, iat: Date.now() } as SealedClient);
    res.status(201).json({
      client_id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris, client_name,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'mcp',
    });
  });

  function validateClient(client_id: string, redirect_uri: string): SealedClient | null {
    const c = unseal<SealedClient>(client_id);
    if (!c || c.t !== 'c') return null;
    if (c.uris.length && !c.uris.includes(redirect_uri)) return null;
    return c;
  }

  // ─── /authorize ──────────────────────────────────────────────────────────
  app.get('/authorize', (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    if (!q.client_id || !q.redirect_uri) { res.status(400).type('text/plain').send('Missing client_id or redirect_uri'); return; }
    if (q.response_type && q.response_type !== 'code') { res.status(400).type('text/plain').send('Unsupported response_type'); return; }
    const client = validateClient(q.client_id, q.redirect_uri);
    if (!client) { res.status(400).type('text/plain').send('Invalid client_id / redirect_uri — re-run DCR'); return; }
    const method = q.code_challenge_method === 'S256' || q.code_challenge_method === 'plain'
      ? q.code_challenge_method : (q.code_challenge ? 'plain' : '');
    res.type('html').send(renderAuthorizePage({
      client_id: q.client_id, redirect_uri: q.redirect_uri,
      state: q.state ?? '', code_challenge: q.code_challenge ?? '',
      code_challenge_method: method, scope: q.scope ?? 'mcp',
      client_name: client.name ?? 'MCP Client',
    }));
  });

  app.post('/authorize', urlencoded, (req, res) => {
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    if (!b.client_id || !b.redirect_uri || !b.upstream_token) {
      res.status(400).type('text/plain').send('Missing required fields'); return;
    }
    const client = validateClient(b.client_id, b.redirect_uri);
    if (!client) { res.status(400).type('text/plain').send('Invalid client_id / redirect_uri'); return; }
    const method: 'S256' | 'plain' = b.code_challenge_method === 'S256' ? 'S256' : 'plain';
    const code = seal({
      t: 'ac', cid: client.cid, uri: b.redirect_uri,
      cc: b.code_challenge ?? '', ccm: method,
      ut: b.upstream_token.trim(),
      exp: Date.now() + 5 * 60_000,
    } as SealedAuthCode);
    const url = new URL(b.redirect_uri);
    url.searchParams.set('code', code);
    if (b.state) url.searchParams.set('state', b.state);
    res.redirect(302, url.toString());
  });

  // ─── /token ──────────────────────────────────────────────────────────────
  app.post('/token', urlencoded, (req, res) => {
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    if (b.grant_type !== 'authorization_code') { res.status(400).json({ error: 'unsupported_grant_type' }); return; }
    if (!b.code) { res.status(400).json({ error: 'invalid_request', error_description: 'missing code' }); return; }
    const entry = unseal<SealedAuthCode>(b.code);
    if (!entry || entry.t !== 'ac') { res.status(400).json({ error: 'invalid_grant', error_description: 'unrecognized code' }); return; }
    if (entry.exp < Date.now()) { res.status(400).json({ error: 'invalid_grant', error_description: 'code expired' }); return; }
    if (b.client_id) {
      const c = unseal<SealedClient>(b.client_id);
      if (!c || c.t !== 'c' || c.cid !== entry.cid) { res.status(400).json({ error: 'invalid_grant', error_description: 'client_id mismatch' }); return; }
    }
    if (b.redirect_uri && entry.uri !== b.redirect_uri) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }); return;
    }
    if (entry.cc) {
      if (!b.code_verifier) { res.status(400).json({ error: 'invalid_grant', error_description: 'missing code_verifier' }); return; }
      const computed = entry.ccm === 'S256'
        ? createHash('sha256').update(b.code_verifier).digest('base64url')
        : b.code_verifier;
      if (computed !== entry.cc) { res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE failed' }); return; }
    }
    const expires_in = 60 * 60 * 24 * 30; // 30 days
    const access_token = seal({
      t: 'at', cid: entry.cid, ut: entry.ut,
      exp: Date.now() + expires_in * 1000,
    } as SealedAccessToken);
    res.json({ access_token, token_type: 'Bearer', expires_in, scope: 'mcp' });
  });
}
```

## Wiring into `src/index.ts`

Three changes from the standard `build-http-mcp` template:

```typescript
import { mountOAuth, lookupAccessToken, getBaseUrl } from './oauth.js';

const app = express();
app.set('trust proxy', true);       // ← REQUIRED. Without this, x-forwarded-proto is ignored
                                    //   and discovery metadata advertises http:// URLs that break PKCE.
app.use(express.json());

mountOAuth(app);                    // ← mount BEFORE /mcp so 401 challenges point clients here

app.post('/mcp', async (req, res) => {
  const upstreamToken = authenticateAndResolveToken(req, res);
  if (!upstreamToken) return;       // 401 already sent
  // ... existing transport setup ...
});

function authenticateAndResolveToken(req: Request, res: Response): string | null {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7).trim() : undefined;

  // 1. OAuth-issued token? (decrypt and extract the upstream token bound at /authorize)
  if (bearer) {
    const ut = lookupAccessToken(bearer);
    if (ut) return ut;
  }
  // 2. Legacy/optional: static MCP_API_KEY + X-Upstream-Token header
  if (process.env.MCP_API_KEY) {
    if (bearer !== process.env.MCP_API_KEY) { challenge401(req, res, 'invalid token'); return null; }
    const ut = (req.headers['x-upstream-token'] as string) ?? process.env.UPSTREAM_TOKEN;
    if (!ut) { res.status(400).json({ error: 'no upstream token' }); return null; }
    return ut;
  }
  // 3. Open mode
  const ut = (req.headers['x-upstream-token'] as string) ?? process.env.UPSTREAM_TOKEN;
  if (!ut) { challenge401(req, res, 'no credentials'); return null; }
  return ut;
}

function challenge401(req: Request, res: Response, description: string) {
  const base = getBaseUrl(req);
  res.set('WWW-Authenticate',
    `Bearer realm="my-mcp", error="invalid_token", error_description="${description}", resource_metadata="${base}/.well-known/oauth-protected-resource"`);
  res.status(401).json({ error: 'unauthorized', error_description: description });
}
```

## The five gotchas (in priority order)

1. **State must be in the token, not in `Map`s.** Hosting platforms restart containers and run replicas. In-memory state = "credentials rejected on reconnect" the moment the client hits a different replica. Use AES-GCM-sealed envelopes — the template above already does this.

2. **`app.set('trust proxy', true)` is non-optional behind a reverse proxy.** Railway/Fly/Vercel terminate TLS. Without `trust proxy`, your discovery metadata advertises `http://...` and the PKCE redirect_uri the client registered won't match, breaking `/token`.

3. **Stale `headers` in `~/.claude.json` silently override OAuth.** If a user migrated from a static-key setup to OAuth, their existing `headers: { Authorization: ... }` is still sent on every request, overriding the OAuth-issued token. Symptom: "Got new credentials, but X rejected them on reconnect." Fix: remove the `headers` block entirely.

4. **Always 401 with `WWW-Authenticate`, never 403.** A 403 stops MCP clients cold. 401 with the `Bearer ... resource_metadata="..."` challenge is what tells them "retry via OAuth." Even for a wrong-but-non-empty Bearer, return 401.

5. **The user's upstream credential goes through `/authorize`, not headers.** Don't ask the user to pre-configure an `X-Upstream-Token` header — that's the old model. The OAuth consent page captures it once, seals it into the access token, and reuses for 30 days. One-time browser pop-up, then invisible.

## Discovery noise to expect

Different MCP clients probe different paths. Return the same AS/PR metadata for all of these — costs nothing, prevents weird edge cases:
- `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`
- `/.well-known/oauth-authorization-server` and `/.well-known/oauth-authorization-server/mcp`
- `/.well-known/openid-configuration` (some clients fall back to OIDC discovery)

## Required environment variables

| Var | Required? | Purpose |
|-----|-----------|---------|
| `OAUTH_SIGNING_KEY` | Recommended | Signs/encrypts all sealed tokens. Must be stable across restarts/replicas. |
| `MCP_API_KEY` | Optional fallback | Used as `OAUTH_SIGNING_KEY` if the latter isn't set. Also enables legacy static-Bearer auth. |
| `BASE_URL` | Optional | Overrides auto-detected base URL. Only needed if `x-forwarded-*` headers are wrong. |

**Without a stable signing key, tokens are invalidated on every container restart.** Set `OAUTH_SIGNING_KEY` to any 32+ char random string per service.

## Verification checklist

Before declaring done, exercise the full flow:

```bash
URL="https://your-server.example.com"

# 1. /mcp without auth must 401 with WWW-Authenticate
curl -si -X POST $URL/mcp -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' -H 'Content-Type: application/json' | head -8
# Expect: HTTP/2 401, WWW-Authenticate header with resource_metadata=...

# 2. Discovery
curl -s $URL/.well-known/oauth-protected-resource
curl -s $URL/.well-known/oauth-authorization-server

# 3. DCR
REG=$(curl -s -X POST $URL/register -H 'Content-Type: application/json' \
  -d '{"client_name":"Test","redirect_uris":["http://localhost:8976/cb"]}')
CID=$(echo "$REG" | python3 -c 'import sys,json;print(json.load(sys.stdin)["client_id"])')

# 4. Simulate /authorize POST (PKCE)
VERIFIER=$(python3 -c 'import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode())')
CHALLENGE=$(python3 -c "import hashlib,base64;v='$VERIFIER';print(base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).rstrip(b'=').decode())")
LOC=$(curl -si -X POST $URL/authorize \
  --data-urlencode "client_id=$CID" --data-urlencode "redirect_uri=http://localhost:8976/cb" \
  -d "state=xyz" -d "code_challenge=$CHALLENGE" -d "code_challenge_method=S256" \
  -d "upstream_token=<your-real-upstream-token>" | grep -i '^location:' | sed 's/^[Ll]ocation: //' | tr -d '\r')
CODE=$(python3 -c "from urllib.parse import urlparse,parse_qs;print(parse_qs(urlparse('$LOC').query)['code'][0])")

# 5. /token exchange
ACCESS=$(curl -s -X POST $URL/token \
  --data-urlencode "grant_type=authorization_code" --data-urlencode "code=$CODE" \
  --data-urlencode "redirect_uri=http://localhost:8976/cb" --data-urlencode "client_id=$CID" \
  -d "code_verifier=$VERIFIER" | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

# 6. /mcp with the OAuth token — must succeed
curl -si -X POST $URL/mcp \
  -H "Authorization: Bearer $ACCESS" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | head -3
# Expect: HTTP/2 200, body has "result":{"tools":[...]}
```

If any step fails, the failing step is the bug. There's no fallback to in-memory state to mask it.

## Connecting clients

**Claude Code (~/.claude.json)** — no headers, OAuth handles everything:
```json
{
  "mcpServers": {
    "my-mcp": {
      "type": "http",
      "url": "https://my-server.example.com/mcp"
    }
  }
}
```

The first `/mcp` connect will fail with 401, Claude Code auto-runs DCR + opens a browser for `/authorize`, user pastes the upstream token, and from then on it's seamless across restarts.

**Cursor (~/.cursor/mcp.json)** — same shape, no static Authorization headers when using OAuth.

## Reference implementation

`railway/src/oauth.ts` + `railway/src/index.ts` in this repo are the canonical production example. Copy that pattern directly.
