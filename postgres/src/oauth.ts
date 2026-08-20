import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import express, { Express, Request, Response } from 'express';

// ─── Stateless encrypted-token design ─────────────────────────────────────────
// All issued credentials (client_id, auth code, access token) are AES-256-GCM
// sealed JSON envelopes. No in-memory state — tokens survive restarts and
// horizontal replicas as long as the signing key env var is stable.
// Pattern: .cursor/skills/add-mcp-oauth/SKILL.md, reference impl: railway/src/oauth.ts
//
// Deliberately DIFFERENT from the Railway reference in one respect: the OAuth
// path on THIS server has a single, fixed purpose (Blink's PG2 analytics
// replica), not "any user's own credential for any database." So the consent
// screen never asks anyone to type or paste a connection string —
// OAUTH_DATABASE_URL is read from this server's own environment at /authorize
// time, exactly once, server-side. The OAuth flow exists purely to satisfy
// the MCP 2025-06-18 spec (DCR + PKCE), which Claude Code / Claude.ai
// connectors require before they'll call /mcp at all — it is not a per-user
// credential-collection mechanism here.
//
// This is deployed on a server that ALSO serves many other local projects via
// the legacy static-key + X-Database-URL-header path (see index.ts) — that
// path is untouched by anything in this file. OAUTH_DATABASE_URL is its own
// env var, separate from DATABASE_URL, specifically so adding OAuth can never
// change what any existing per-header caller connects to.

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
// `ut` = upstream token — here, the PG2 analytics connection string, bound at
// /authorize from this server's own DATABASE_URL env var (never user input).

export function getBaseUrl(req: Request): string {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0].trim()
    || (req as any).protocol || 'https';
  const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

/** Returns the upstream connection string bound to a valid OAuth access token, or null. */
export function lookupAccessToken(token: string): string | null {
  const entry = unseal<SealedAccessToken>(token);
  if (!entry || entry.t !== 'at' || entry.exp < Date.now()) return null;
  return entry.ut;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Optional extra gate on the consent screen. Unset by default (matches the
// open reference pattern); set CONSENT_SECRET to require it before Approve.
const CONSENT_SECRET = process.env.CONSENT_SECRET || '';

function renderAuthorizePage(p: {
  client_id: string; redirect_uri: string; state: string;
  code_challenge: string; code_challenge_method: string; scope: string; client_name: string;
  error?: string;
}): string {
  const secretField = CONSENT_SECRET
    ? `<label for="secret">Access passphrase</label>
<input id="secret" name="consent_secret" type="password" autocomplete="off" required placeholder="Enter the shared passphrase"/>`
    : '';
  const errorBanner = p.error
    ? `<div class="error">${escapeHtml(p.error)}</div>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Authorize PG2 Analytics — Blink</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif;background:#0a0b0f;color:#e8e9ed;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
.card{background:#131520;border:1px solid #22242f;border-radius:16px;padding:36px;max-width:460px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.4)}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:24px}
.brand-mark{width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:white;flex-shrink:0}
.brand-name{font-size:13px;font-weight:600;color:#9aa1ad;letter-spacing:.02em}
h1{font-size:21px;margin:0 0 6px;font-weight:650;letter-spacing:-.01em}
.subtitle{color:#8b92a0;font-size:14px;line-height:1.5;margin:0 0 20px}
.scope-box{background:#0e1018;border:1px solid #1e2029;border-radius:10px;padding:16px;margin-bottom:20px}
.scope-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:10px}
.scope-item{display:flex;gap:10px;align-items:flex-start;font-size:13px;color:#c7cad1;line-height:1.5;margin-bottom:8px}
.scope-item:last-child{margin-bottom:0}
.scope-icon{flex-shrink:0;width:16px;height:16px;margin-top:1px}
.scope-icon.allow{color:#22c55e}
.scope-icon.deny{color:#f43f5e}
.client-name{color:#e8e9ed;font-weight:600}
label{display:block;font-size:13px;font-weight:500;margin:16px 0 6px;color:#c7cad1}
input{width:100%;background:#0a0b0f;border:1px solid #262a37;color:#e8e9ed;padding:12px 14px;border-radius:9px;font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:13px;transition:border-color .15s}
input:focus{outline:none;border-color:#6366f1}
button{margin-top:22px;width:100%;background:#6366f1;color:white;border:0;padding:13px;border-radius:9px;font-weight:600;font-size:14px;cursor:pointer;transition:background .15s}
button:hover{background:#5457e5}
.footer{margin-top:18px;font-size:12px;color:#5a6072;text-align:center;line-height:1.5}
.error{background:#2a1215;border:1px solid #4a1f24;color:#fca5b0;font-size:13px;padding:10px 14px;border-radius:8px;margin-bottom:16px}
</style></head><body><div class="card">
<div class="brand"><div class="brand-mark">B</div><div class="brand-name">BLINK.NEW</div></div>
<h1>Authorize PG2 Analytics access</h1>
<p class="subtitle"><span class="client-name">${escapeHtml(p.client_name)}</span> is requesting access to Blink's PG2 analytics database.</p>
${errorBanner}
<div class="scope-box">
<div class="scope-title">This grants</div>
<div class="scope-item"><svg class="scope-icon allow" viewBox="0 0 16 16" fill="none"><path d="M13.5 4L6 11.5L2.5 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>Read-only SQL queries (SELECT) against the analytics replica</div>
<div class="scope-item"><svg class="scope-icon deny" viewBox="0 0 16 16" fill="none"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>No write, update, or delete access — enforced at the transaction level on every query</div>
<div class="scope-item"><svg class="scope-icon deny" viewBox="0 0 16 16" fill="none"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>Never the production primary — this connects only to the read replica</div>
</div>
<form method="POST" action="/authorize">
${secretField}
<input type="hidden" name="client_id" value="${escapeHtml(p.client_id)}"/>
<input type="hidden" name="redirect_uri" value="${escapeHtml(p.redirect_uri)}"/>
<input type="hidden" name="state" value="${escapeHtml(p.state)}"/>
<input type="hidden" name="code_challenge" value="${escapeHtml(p.code_challenge)}"/>
<input type="hidden" name="code_challenge_method" value="${escapeHtml(p.code_challenge_method)}"/>
<input type="hidden" name="scope" value="${escapeHtml(p.scope)}"/>
<button type="submit">Approve access</button>
</form>
<p class="footer">Only approve if you recognize this application. You can revoke access at any time by rotating the server's signing key.</p>
</div></body></html>`;
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
    if (!b.client_id || !b.redirect_uri) {
      res.status(400).type('text/plain').send('Missing required fields'); return;
    }
    const client = validateClient(b.client_id, b.redirect_uri);
    if (!client) { res.status(400).type('text/plain').send('Invalid client_id / redirect_uri'); return; }

    if (CONSENT_SECRET && !timingSafeEqualStr(b.consent_secret ?? '', CONSENT_SECRET)) {
      res.status(401).type('html').send(renderAuthorizePage({
        client_id: b.client_id, redirect_uri: b.redirect_uri,
        state: b.state ?? '', code_challenge: b.code_challenge ?? '',
        code_challenge_method: (b.code_challenge_method === 'S256' ? 'S256' : 'plain'),
        scope: b.scope ?? 'mcp', client_name: client.name ?? 'MCP Client',
        error: 'Incorrect passphrase. Try again.',
      }));
      return;
    }

    // The upstream credential is THIS SERVER'S OWN env var — never user input.
    // OAUTH_DATABASE_URL is deliberately separate from DATABASE_URL: this
    // deployment is shared by many local projects, each supplying its own
    // X-Database-URL header per request via the legacy static-key path (see
    // authenticateAndResolveDatabaseUrl in index.ts) — DATABASE_URL itself is
    // NOT set on the live service, and must stay that way so existing callers
    // keep working exactly as before. OAuth is a separate, additive path with
    // its own fixed target (PG2 analytics) and its own env var, so the two
    // never collide and neither can accidentally affect the other's behavior.
    const databaseUrl = process.env.OAUTH_DATABASE_URL || process.env.DATABASE_URL;
    if (!databaseUrl) {
      res.status(500).type('text/plain').send('Server misconfigured: OAUTH_DATABASE_URL not set.'); return;
    }

    const method: 'S256' | 'plain' = b.code_challenge_method === 'S256' ? 'S256' : 'plain';
    const code = seal({
      t: 'ac', cid: client.cid, uri: b.redirect_uri,
      cc: b.code_challenge ?? '', ccm: method,
      ut: databaseUrl,
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
