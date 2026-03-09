import { google, gmail_v1 } from 'googleapis'
import { getGmailAccount, updateGmailTokens } from './db.js'
import { encrypt, decrypt } from './crypto.js'

export function getCredentials(): { client_id: string; client_secret: string } {
  const raw = process.env.GMAIL_CREDENTIALS
  if (!raw) throw new Error('GMAIL_CREDENTIALS env var is required (base64 JSON from Google Cloud Console)')
  const json = Buffer.from(raw, 'base64').toString('utf8')
  const creds = JSON.parse(json)
  const src = creds.web ?? creds.installed ?? creds
  return { client_id: src.client_id, client_secret: src.client_secret }
}

export function getOAuth2Client(redirectUri?: string) {
  const { client_id, client_secret } = getCredentials()
  return new google.auth.OAuth2(client_id, client_secret, redirectUri)
}

export async function getGmailClient(userId: string, accountName: string): Promise<gmail_v1.Gmail> {
  const account = await getGmailAccount(userId, accountName)
  if (!account) throw new Error(`No Gmail account '${accountName}' linked. Use link-identity or link-account tool first.`)

  const tokens = JSON.parse(decrypt(account.tokens_encrypted))
  const auth = getOAuth2Client()
  auth.setCredentials(tokens)

  auth.on('tokens', async (newTokens) => {
    const merged = { ...tokens, ...newTokens }
    const encrypted = encrypt(JSON.stringify(merged))
    await updateGmailTokens(userId, accountName, encrypted)
  })

  return google.gmail({ version: 'v1', auth })
}
