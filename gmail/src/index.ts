import express, { Request, Response } from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { google } from 'googleapis'
import { initDb, getUserByApiKey, getUserByGoogleSub, createUser, saveGmailAccount, consumeOAuthState, createApiKey } from './db.js'
import { getOAuth2Client, getCredentials } from './gmail.js'
import { registerIdentityTools } from './tools/identity.js'
import { registerInboxTools } from './tools/inbox.js'
import { registerComposeTools } from './tools/compose.js'
import { encrypt } from './crypto.js'

const PORT = parseInt(process.env.PORT ?? '3000')

function getBaseUrl(): string {
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN
  return domain ? `https://${domain}` : `http://localhost:${PORT}`
}

function createMcpServer(userId: string | null): McpServer {
  const server = new McpServer({ name: 'gmail-mcp', version: '1.0.0' })
  registerIdentityTools(server, userId, getBaseUrl)
  registerInboxTools(server, userId)
  registerComposeTools(server, userId)
  return server
}

// ── HTML templates ────────────────────────────────────────────────────────────

function successIdentityHtml(email: string, name: string, apiKey: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Gmail MCP — Linked!</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 560px; margin: 80px auto; padding: 24px; color: #111; }
    h1 { font-size: 1.4rem; margin-bottom: 8px; }
    .key-box { background: #f5f5f5; border: 1px solid #ddd; padding: 16px 20px; border-radius: 8px; font-family: monospace; font-size: 13px; word-break: break-all; margin: 16px 0; }
    p { color: #555; line-height: 1.5; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
  </style>
</head>
<body>
  <h1>✅ Signed in as ${escapeHtml(name)} (${escapeHtml(email)})</h1>
  <p>Your API key — copy it now, it will <strong>not</strong> be shown again:</p>
  <div class="key-box">${escapeHtml(apiKey)}</div>
  <p>Add it to your MCP client config as:<br>
  <code>X-API-Key: ${escapeHtml(apiKey)}</code></p>
  <p>You can close this window.</p>
</body>
</html>`
}

function successAccountHtml(accountName: string, email: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>Gmail MCP — Account Linked</title></head>
<body style="font-family:system-ui,sans-serif;max-width:500px;margin:80px auto;padding:24px">
  <h1>✅ Account '${escapeHtml(accountName)}' linked</h1>
  <p>${escapeHtml(email)} is now available as account <strong>${escapeHtml(accountName)}</strong>.</p>
  <p>You can close this window.</p>
</body>
</html>`
}

function errorHtml(message: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>Gmail MCP — Error</title></head>
<body style="font-family:system-ui,sans-serif;max-width:500px;margin:80px auto;padding:24px">
  <h1>❌ Error</h1>
  <p>${escapeHtml(message)}</p>
</body>
</html>`
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express()
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() })
})

app.get('/oauth/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string>

  if (error) {
    res.status(400).send(errorHtml(error))
    return
  }
  if (!code || !state) {
    res.status(400).send(errorHtml('Missing code or state parameter'))
    return
  }

  const stateData = await consumeOAuthState(state)
  if (!stateData) {
    res.status(400).send(errorHtml('Invalid or expired OAuth state. Please try again.'))
    return
  }

  const redirectUri = `${getBaseUrl()}/oauth/callback`
  const auth = getOAuth2Client(redirectUri)
  const { tokens } = await auth.getToken(code)
  auth.setCredentials(tokens)

  if (stateData.flow_type === 'identity') {
    const { client_id } = getCredentials()
    const ticket = await auth.verifyIdToken({ idToken: tokens.id_token!, audience: client_id })
    const payload = ticket.getPayload()!
    const sub = payload.sub
    const email = payload.email ?? ''
    const name = payload.name ?? email

    let userId: string
    const existingUser = await getUserByGoogleSub(sub)
    if (existingUser) {
      userId = existingUser.id
    } else {
      userId = await createUser(sub, email, name)
    }

    const encrypted = encrypt(JSON.stringify(tokens))
    await saveGmailAccount(userId, stateData.account_name, email, encrypted)
    const apiKey = await createApiKey(userId, 'initial')
    res.send(successIdentityHtml(email, name, apiKey))
  } else {
    const gmail = google.gmail({ version: 'v1', auth })
    const profile = await gmail.users.getProfile({ userId: 'me' })
    const email = profile.data.emailAddress!
    const userId = stateData.user_id!

    const encrypted = encrypt(JSON.stringify(tokens))
    await saveGmailAccount(userId, stateData.account_name, email, encrypted)
    res.send(successAccountHtml(stateData.account_name, email))
  }
})

app.post('/mcp', async (req: Request, res: Response) => {
  const rawKey = (req.headers['x-api-key'] as string | undefined)
    ?? (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined)

  let userId: string | null = null
  if (rawKey) {
    userId = await getUserByApiKey(rawKey)
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on('close', () => transport.close())

  const server = createMcpServer(userId)
  await server.connect(transport)
  await transport.handleRequest(req, res, req.body)
})

app.get('/mcp', (_req, res) => res.status(405).json({ error: 'Use POST /mcp' }))
app.delete('/mcp', (_req, res) => res.status(405).json({ error: 'Stateless mode — no session to delete' }))

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`gmail-mcp running on http://0.0.0.0:${PORT}`)
    console.log(`  OAuth callback: ${getBaseUrl()}/oauth/callback`)
  })
}).catch((err) => {
  console.error('Failed to initialize database:', err)
  process.exit(1)
})
