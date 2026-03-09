import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { gmail_v1 } from 'googleapis'
import { getGmailClient } from '../gmail.js'

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[], name: string): string {
  return headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''
}

function extractBody(part: gmail_v1.Schema$MessagePart): { text: string; html: string } {
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return { text: Buffer.from(part.body.data, 'base64url').toString('utf8'), html: '' }
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    return { text: '', html: Buffer.from(part.body.data, 'base64url').toString('utf8') }
  }
  if (part.parts) {
    let text = '', html = ''
    for (const p of part.parts) {
      const r = extractBody(p)
      if (r.text) text = r.text
      if (r.html) html = r.html
    }
    return { text, html }
  }
  return { text: '', html: '' }
}

function extractAttachments(part: gmail_v1.Schema$MessagePart): { name: string; mime_type: string }[] {
  const atts: { name: string; mime_type: string }[] = []
  if (part.filename && part.body?.attachmentId) {
    atts.push({ name: part.filename, mime_type: part.mimeType ?? 'application/octet-stream' })
  }
  if (part.parts) {
    for (const p of part.parts) atts.push(...extractAttachments(p))
  }
  return atts
}

function parseMessage(msg: gmail_v1.Schema$Message) {
  const headers = msg.payload?.headers ?? []
  const { text, html } = extractBody(msg.payload ?? {})
  const body = text || (html ? stripHtml(html) : '')
  return {
    id: msg.id,
    thread_id: msg.threadId,
    from: getHeader(headers, 'From'),
    to: getHeader(headers, 'To'),
    cc: getHeader(headers, 'Cc'),
    date: getHeader(headers, 'Date'),
    subject: getHeader(headers, 'Subject'),
    body,
    attachments: extractAttachments(msg.payload ?? {}),
    unread: msg.labelIds?.includes('UNREAD') ?? false,
  }
}

export function registerInboxTools(server: McpServer, userId: string) {
  server.tool(
    'list-emails',
    'List recent emails from inbox or a specific label.',
    {
      account_name: z.string().optional().describe('Gmail account name (default: "default")'),
      max: z.number().optional().describe('Max emails to return (default: 20)'),
      label: z.string().optional().describe('Label to filter by (default: "INBOX")'),
      next_page: z.string().optional().describe('Page token for next page of results'),
    },
    async ({ account_name = 'default', max = 20, label = 'INBOX', next_page }) => {
      const gmail = await getGmailClient(userId, account_name)
      const listRes = await gmail.users.messages.list({
        userId: 'me',
        maxResults: max,
        labelIds: [label],
        pageToken: next_page,
      })
      const messages = listRes.data.messages ?? []
      const results = await Promise.all(messages.map(async (m) => {
        const msg = await gmail.users.messages.get({
          userId: 'me',
          id: m.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        })
        const headers = msg.data.payload?.headers ?? []
        return {
          id: msg.data.id,
          thread_id: msg.data.threadId,
          date: getHeader(headers, 'Date'),
          from: getHeader(headers, 'From'),
          subject: getHeader(headers, 'Subject'),
          unread: msg.data.labelIds?.includes('UNREAD') ?? false,
        }
      }))
      return { content: [{ type: 'text', text: JSON.stringify({ messages: results, next_page_token: listRes.data.nextPageToken ?? null }) }] }
    }
  )

  server.tool(
    'search-emails',
    'Search emails using Gmail query syntax (e.g. "from:foo@bar.com subject:hello is:unread").',
    {
      query: z.string().describe('Gmail search query'),
      account_name: z.string().optional().describe('Gmail account name (default: "default")'),
      max: z.number().optional().describe('Max results (default: 20)'),
      next_page: z.string().optional().describe('Page token for next page'),
    },
    async ({ query, account_name = 'default', max = 20, next_page }) => {
      const gmail = await getGmailClient(userId, account_name)
      const listRes = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: max, pageToken: next_page })
      const messages = listRes.data.messages ?? []
      const results = await Promise.all(messages.map(async (m) => {
        const msg = await gmail.users.messages.get({
          userId: 'me',
          id: m.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        })
        const headers = msg.data.payload?.headers ?? []
        return {
          id: msg.data.id,
          thread_id: msg.data.threadId,
          date: getHeader(headers, 'Date'),
          from: getHeader(headers, 'From'),
          subject: getHeader(headers, 'Subject'),
          unread: msg.data.labelIds?.includes('UNREAD') ?? false,
        }
      }))
      return { content: [{ type: 'text', text: JSON.stringify({ messages: results, next_page_token: listRes.data.nextPageToken ?? null }) }] }
    }
  )

  server.tool(
    'read-email',
    'Read the full content of an email or thread.',
    {
      id: z.string().describe('Message ID to read'),
      account_name: z.string().optional().describe('Gmail account name (default: "default")'),
      thread: z.boolean().optional().describe('If true, read the full thread (default: false)'),
    },
    async ({ id, account_name = 'default', thread = false }) => {
      const gmail = await getGmailClient(userId, account_name)

      if (thread) {
        const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' })
        const threadId = msg.data.threadId!
        const threadRes = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' })
        const messages = (threadRes.data.messages ?? []).map(parseMessage)
        return { content: [{ type: 'text', text: JSON.stringify({ thread_id: threadId, messages }) }] }
      }

      const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' })
      const parsed = parseMessage(msg.data)
      return { content: [{ type: 'text', text: JSON.stringify({ thread_id: parsed.thread_id, messages: [parsed] }) }] }
    }
  )
}
