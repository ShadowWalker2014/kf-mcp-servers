import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getOAuth2Client } from '../gmail.js'
import { saveOAuthState, listGmailAccounts, deleteGmailAccount, createApiKey, listApiKeys, deleteApiKey } from '../db.js'

const IDENTITY_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
]

const ACCOUNT_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
]

export function registerIdentityTools(server: McpServer, userId: string | null, getBaseUrl: () => string) {
  server.tool(
    'link-identity',
    'Start Google OAuth to sign in and receive an API key. No auth required. Opens a browser URL.',
    { account_name: z.string().optional().describe('Name for the primary Gmail account (default: "default")') },
    async ({ account_name = 'default' }) => {
      const auth = getOAuth2Client(`${getBaseUrl()}/oauth/callback`)
      const state = await saveOAuthState(null, account_name, 'identity')
      const auth_url = auth.generateAuthUrl({
        access_type: 'offline',
        scope: IDENTITY_SCOPES,
        state,
        prompt: 'consent',
      })
      return { content: [{ type: 'text', text: JSON.stringify({ auth_url, message: 'Open this URL in your browser to sign in with Google and get your API key' }) }] }
    }
  )

  const requireAuth = () => {
    if (!userId) return { content: [{ type: 'text' as const, text: 'Not authenticated. Call link-identity first to get an API key, then add it as X-API-Key header.' }] }
    return null
  }

  server.tool(
    'link-account',
    'Link an additional Gmail account to your identity. Returns a URL to open in your browser.',
    { account_name: z.string().describe('Name for this Gmail account (e.g. "work", "personal")') },
    async ({ account_name }) => {
      const err = requireAuth(); if (err) return err
      const auth = getOAuth2Client(`${getBaseUrl()}/oauth/callback`)
      const state = await saveOAuthState(userId!, account_name, 'account')
      const auth_url = auth.generateAuthUrl({
        access_type: 'offline',
        scope: ACCOUNT_SCOPES,
        state,
        prompt: 'consent',
      })
      return { content: [{ type: 'text', text: JSON.stringify({ auth_url, message: `Open this URL to link account '${account_name}'` }) }] }
    }
  )

  server.tool(
    'list-accounts',
    'List all linked Gmail accounts.',
    {},
    async () => {
      const err = requireAuth(); if (err) return err
      const accounts = await listGmailAccounts(userId!)
      return { content: [{ type: 'text', text: JSON.stringify(accounts) }] }
    }
  )

  server.tool(
    'unlink-account',
    'Remove a linked Gmail account.',
    { account_name: z.string().describe('Account name to unlink') },
    async ({ account_name }) => {
      const err = requireAuth(); if (err) return err
      await deleteGmailAccount(userId!, account_name)
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Account '${account_name}' unlinked` }) }] }
    }
  )

  server.tool(
    'issue-api-key',
    'Issue a new API key for your account. Save it — it will not be shown again.',
    { name: z.string().optional().describe('Label for this key') },
    async ({ name }) => {
      const err = requireAuth(); if (err) return err
      const key = await createApiKey(userId!, name)
      return { content: [{ type: 'text', text: JSON.stringify({ api_key: key, message: 'Save this key — it will not be shown again' }) }] }
    }
  )

  server.tool(
    'revoke-api-key',
    'Revoke an API key by its prefix.',
    { key_prefix: z.string().describe('Key prefix (first 12 chars) to revoke') },
    async ({ key_prefix }) => {
      const err = requireAuth(); if (err) return err
      await deleteApiKey(userId!, key_prefix)
      return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] }
    }
  )

  server.tool(
    'list-api-keys',
    'List all your API keys (prefixes only, not full keys).',
    {},
    async () => {
      const err = requireAuth(); if (err) return err
      const keys = await listApiKeys(userId!)
      return { content: [{ type: 'text', text: JSON.stringify(keys) }] }
    }
  )
}
