// Minimal MCP-compliant OAuth 2.0 Authorization Server for Claude Code.
//
// Claude Code (and other MCP clients that follow the 2025-06-18 spec) authenticate
// to MCP servers via OAuth 2.0 with Dynamic Client Registration + PKCE. Without
// these endpoints the client fails on /register or /.well-known/* before it ever
// reaches /mcp.
//
// Strategy: we act as both the resource server AND the authorization server.
// During /authorize the user pastes their Railway account token; we mint an
// access token bound to that Railway token. /mcp then accepts the access token
// as a Bearer credential and uses the underlying Railway token for upstream calls.
//
// State is in-process memory — fine for a single-instance deployment. Restarting
// the server invalidates issued tokens; users re-run the OAuth flow.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import express, { Express, Request, Response } from 'express';

// ─── Stateless encrypted-token design ─────────────────────────────────────────
// Railway restarts and horizontal replicas mean in-memory token state is
// unreliable. Instead we encrypt every issued credential (auth code,
// access token, client_id) with a server-side key. The token IS the state.
//
// Format for all encrypted blobs: base64url( iv(12) || ciphertext || tag(16) )
// Plaintext is a JSON object whose `t` field tags the type.

const SIGNING_KEY: Buffer = (() => {
  const explicit = process.env.OAUTH_SIGNING_KEY || process.env.MCP_API_KEY;
  if (explicit) return createHash('sha256').update(explicit).digest();
  // Fallback: random per-process key. Tokens won't survive a restart in this
  // mode — set OAUTH_SIGNING_KEY in the environment for durability.
  console.warn('[oauth] No OAUTH_SIGNING_KEY/MCP_API_KEY set; using ephemeral key — tokens will not survive restarts.');
  return randomBytes(32);
})();

function seal(payload: object): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', SIGNING_KEY, iv);
  const pt = Buffer.from(JSON.stringify(payload), 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString('base64url');
}

function unseal<T = any>(token: string): T | null {
  try {
    const buf = Buffer.from(token, 'base64url');
    if (buf.length < 12 + 16) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(buf.length - 16);
    const ct = buf.subarray(12, buf.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', SIGNING_KEY, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(pt.toString('utf8')) as T;
  } catch {
    return null;
  }
}

interface SealedClient { t: 'c'; cid: string; uris: string[]; name?: string; iat: number; }
interface SealedAuthCode { t: 'ac'; cid: string; uri: string; cc: string; ccm: 'S256' | 'plain'; rt: string; exp: number; }
interface SealedAccessToken { t: 'at'; cid: string; rt: string; exp: number; }

function randomId(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export function getBaseUrl(req: Request): string {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0].trim()
    || (req as any).protocol
    || 'https';
  const host = (req.headers['x-forwarded-host'] as string | undefined)
    || req.headers.host
    || 'localhost';
  return `${proto}://${host}`;
}

/** Returns the Railway token bound to an issued access token, or null. */
export function lookupAccessToken(token: string): string | null {
  const entry = unseal<SealedAccessToken>(token);
  if (!entry || entry.t !== 'at') return null;
  if (entry.exp < Date.now()) return null;
  return entry.rt;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function renderAuthorizePage(params: {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  client_name: string;
}): string {
  const { client_id, redirect_uri, state, code_challenge, code_challenge_method, scope, client_name } = params;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Authorize Railway MCP</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b0d12; color: #e6e6e6; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
    .card { background: #15181f; border: 1px solid #262a33; border-radius: 12px; padding: 32px; max-width: 480px; width: 100%; box-shadow: 0 20px 50px rgba(0,0,0,0.4); }
    h1 { font-size: 20px; margin: 0 0 8px; }
    p { color: #9aa1ad; font-size: 14px; line-height: 1.5; margin: 8px 0; }
    label { display: block; font-size: 13px; color: #c4c8d0; margin: 16px 0 6px; }
    input { width: 100%; box-sizing: border-box; background: #0b0d12; border: 1px solid #2a2f3a; color: #e6e6e6; padding: 12px; border-radius: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
    input:focus { outline: none; border-color: #6366f1; }
    button { margin-top: 20px; width: 100%; background: #6366f1; color: white; border: 0; padding: 12px; border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer; }
    button:hover { background: #5558ee; }
    a { color: #8b9aff; }
    code { background: #1d2129; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
    .client { color: #c4c8d0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authorize Railway MCP</h1>
    <p><span class="client">${escapeHtml(client_name)}</span> wants to access your Railway account through this MCP server.</p>
    <p>Paste a Railway account token to authorize. Create one at <a href="https://railway.com/account/tokens" target="_blank" rel="noopener">railway.com/account/tokens</a>.</p>
    <form method="POST" action="/authorize">
      <label for="railway_token">Railway account token</label>
      <input id="railway_token" name="railway_token" type="password" autocomplete="off" required placeholder="rwy_..." />
      <input type="hidden" name="client_id" value="${escapeHtml(client_id)}" />
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirect_uri)}" />
      <input type="hidden" name="state" value="${escapeHtml(state)}" />
      <input type="hidden" name="code_challenge" value="${escapeHtml(code_challenge)}" />
      <input type="hidden" name="code_challenge_method" value="${escapeHtml(code_challenge_method)}" />
      <input type="hidden" name="scope" value="${escapeHtml(scope)}" />
      <button type="submit">Authorize</button>
    </form>
    <p style="margin-top: 20px; font-size: 12px; color: #6b7280;">Your token is stored only in this server's memory and used to call the Railway API on your behalf.</p>
  </div>
</body>
</html>`;
}

export function mountOAuth(app: Express): void {
  // Some clients send urlencoded for /authorize and /token. Parse on demand.
  const urlencoded = express.urlencoded({ extended: true });

  // ─── Discovery: protected resource ─────────────────────────────────────
  const protectedResourceMetadata = (req: Request, res: Response) => {
    const base = getBaseUrl(req);
    res.json({
      resource: `${base}/mcp`,
      authorization_servers: [base],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp'],
      resource_documentation: `${base}/health`,
    });
  };
  app.get('/.well-known/oauth-protected-resource', protectedResourceMetadata);
  app.get('/.well-known/oauth-protected-resource/mcp', protectedResourceMetadata);

  // ─── Discovery: authorization server ───────────────────────────────────
  const asMetadata = (req: Request, res: Response) => {
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
  app.get('/.well-known/oauth-authorization-server', asMetadata);
  app.get('/.well-known/oauth-authorization-server/mcp', asMetadata);
  // OpenID-style discovery — some clients probe this path
  app.get('/.well-known/openid-configuration', asMetadata);

  // ─── Dynamic Client Registration (RFC 7591) ────────────────────────────
  app.post('/register', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const redirect_uris = Array.isArray(body.redirect_uris) ? (body.redirect_uris as string[]) : [];
    const client_name = typeof body.client_name === 'string' ? body.client_name : 'MCP Client';
    if (!redirect_uris.length) {
      res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris required' });
      return;
    }
    const cid = randomId(16);
    // client_id is itself a sealed envelope so we can validate redirect_uris
    // statelessly on /authorize without needing a server-side clients table.
    const sealed: SealedClient = { t: 'c', cid, uris: redirect_uris, name: client_name, iat: Date.now() };
    const client_id = seal(sealed);
    res.status(201).json({
      client_id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris,
      client_name,
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

  // ─── /authorize GET → consent page ─────────────────────────────────────
  app.get('/authorize', (req: Request, res: Response) => {
    const q = req.query as Record<string, string | undefined>;
    const { client_id, redirect_uri, response_type, code_challenge, code_challenge_method, state, scope } = q;
    if (!client_id || !redirect_uri) {
      res.status(400).type('text/plain').send('Missing client_id or redirect_uri');
      return;
    }
    if (response_type && response_type !== 'code') {
      res.status(400).type('text/plain').send('Unsupported response_type — only "code" is supported');
      return;
    }
    const client = validateClient(client_id, redirect_uri);
    if (!client) {
      res.status(400).type('text/plain').send('Unknown or invalid client_id / redirect_uri — re-run dynamic client registration');
      return;
    }
    const method = code_challenge_method === 'S256' || code_challenge_method === 'plain'
      ? code_challenge_method
      : (code_challenge ? 'plain' : '');
    res.type('html').send(renderAuthorizePage({
      client_id,
      redirect_uri,
      state: state ?? '',
      code_challenge: code_challenge ?? '',
      code_challenge_method: method,
      scope: scope ?? 'mcp',
      client_name: client.name ?? 'MCP Client',
    }));
  });

  // ─── /authorize POST → issue code, redirect back ───────────────────────
  app.post('/authorize', urlencoded, (req: Request, res: Response) => {
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    const { client_id, redirect_uri, state, code_challenge, code_challenge_method, railway_token } = b;
    if (!client_id || !redirect_uri || !railway_token) {
      res.status(400).type('text/plain').send('Missing required fields');
      return;
    }
    const client = validateClient(client_id, redirect_uri);
    if (!client) {
      res.status(400).type('text/plain').send('Unknown or invalid client_id / redirect_uri');
      return;
    }
    const method: 'S256' | 'plain' = code_challenge_method === 'S256' ? 'S256' : 'plain';
    const sealedCode: SealedAuthCode = {
      t: 'ac',
      cid: client.cid,
      uri: redirect_uri,
      cc: code_challenge ?? '',
      ccm: method,
      rt: railway_token.trim(),
      exp: Date.now() + 5 * 60_000,
    };
    const code = seal(sealedCode);
    const url = new URL(redirect_uri);
    url.searchParams.set('code', code);
    if (state) url.searchParams.set('state', state);
    res.redirect(302, url.toString());
  });

  // ─── /token POST → exchange code for access_token ──────────────────────
  app.post('/token', urlencoded, (req: Request, res: Response) => {
    // Accept either application/x-www-form-urlencoded (most clients) or JSON.
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    const grant_type = b.grant_type;
    if (grant_type !== 'authorization_code') {
      res.status(400).json({ error: 'unsupported_grant_type' });
      return;
    }
    const { code, redirect_uri, client_id, code_verifier } = b;
    if (!code) { res.status(400).json({ error: 'invalid_request', error_description: 'missing code' }); return; }
    const entry = unseal<SealedAuthCode>(code);
    if (!entry || entry.t !== 'ac') {
      res.status(400).json({ error: 'invalid_grant', error_description: 'unrecognized code' });
      return;
    }
    if (entry.exp < Date.now()) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'code expired' }); return;
    }
    if (client_id) {
      const c = unseal<SealedClient>(client_id);
      if (!c || c.t !== 'c' || c.cid !== entry.cid) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'client_id mismatch' });
        return;
      }
    }
    if (redirect_uri && entry.uri !== redirect_uri) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }); return;
    }
    // PKCE
    if (entry.cc) {
      if (!code_verifier) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'missing code_verifier' });
        return;
      }
      const computed = entry.ccm === 'S256'
        ? createHash('sha256').update(code_verifier).digest('base64url')
        : code_verifier;
      if (computed !== entry.cc) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
        return;
      }
    }
    const expires_in = 60 * 60 * 24 * 30; // 30 days
    const sealedAt: SealedAccessToken = {
      t: 'at',
      cid: entry.cid,
      rt: entry.rt,
      exp: Date.now() + expires_in * 1000,
    };
    const access_token = seal(sealedAt);
    res.json({
      access_token,
      token_type: 'Bearer',
      expires_in,
      scope: 'mcp',
    });
  });
}
