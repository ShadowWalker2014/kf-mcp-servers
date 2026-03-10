import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { gmail_v1 } from 'googleapis'
import { getGmailClient } from '../gmail.js'

interface MimeOptions {
  to?: string
  subject?: string
  body?: string
  html?: string
  cc?: string
  bcc?: string
  inReplyTo?: string
  references?: string
  attachments?: { name: string; content_base64: string; mime_type: string }[]
}

function buildMime(opts: MimeOptions): string {
  const { to, subject, body, html, cc, bcc, inReplyTo, references, attachments = [] } = opts
  const boundary = `boundary_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
  const lines: string[] = []

  if (to) lines.push(`To: ${to}`)
  if (cc) lines.push(`Cc: ${cc}`)
  if (bcc) lines.push(`Bcc: ${bcc}`)
  if (subject) lines.push(`Subject: ${subject}`)
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`)
  if (references) lines.push(`References: ${references}`)
  lines.push('MIME-Version: 1.0')
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)
  lines.push('')
  lines.push(`--${boundary}`)

  if (html) {
    const innerBoundary = `inner_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
    lines.push(`Content-Type: multipart/alternative; boundary="${innerBoundary}"`)
    lines.push('')
    if (body) {
      lines.push(`--${innerBoundary}`)
      lines.push('Content-Type: text/plain; charset=utf-8')
      lines.push('Content-Transfer-Encoding: base64')
      lines.push('')
      lines.push(Buffer.from(body).toString('base64'))
    }
    lines.push(`--${innerBoundary}`)
    lines.push('Content-Type: text/html; charset=utf-8')
    lines.push('Content-Transfer-Encoding: base64')
    lines.push('')
    lines.push(Buffer.from(html).toString('base64'))
    lines.push(`--${innerBoundary}--`)
  } else {
    lines.push('Content-Type: text/plain; charset=utf-8')
    lines.push('Content-Transfer-Encoding: base64')
    lines.push('')
    lines.push(Buffer.from(body ?? '').toString('base64'))
  }

  for (const att of attachments) {
    lines.push(`--${boundary}`)
    lines.push(`Content-Type: ${att.mime_type}; name="${att.name}"`)
    lines.push('Content-Transfer-Encoding: base64')
    lines.push(`Content-Disposition: attachment; filename="${att.name}"`)
    lines.push('')
    lines.push(att.content_base64)
  }

  lines.push(`--${boundary}--`)
  return Buffer.from(lines.join('\r\n')).toString('base64url')
}

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[], name: string): string {
  return headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''
}

const attachmentSchema = z.array(z.object({
  name: z.string().describe('Filename'),
  content_base64: z.string().describe('Base64-encoded file content'),
  mime_type: z.string().describe('MIME type (e.g. "application/pdf")'),
})).optional()

export function registerComposeTools(server: McpServer, userId: string | null) {
  const requireAuth = () => {
    if (!userId) return { content: [{ type: 'text' as const, text: 'Not authenticated. Call link-identity first to get an API key, then add it as X-API-Key header.' }] }
    return null
  }
  server.tool(
    'send-email',
    'Send an email.',
    {
      to: z.string().describe('Recipient email address'),
      subject: z.string().describe('Email subject'),
      body: z.string().describe('Email body (plain text)'),
      account_name: z.string().optional().describe('Gmail account name (default: "default")'),
      html: z.string().optional().describe('HTML body — if provided, sends multipart/alternative'),
      cc: z.string().optional().describe('CC recipients'),
      bcc: z.string().optional().describe('BCC recipients'),
      attachments: attachmentSchema,
    },
    async ({ to, subject, body, account_name = 'default', html, cc, bcc, attachments }) => {
      const err = requireAuth(); if (err) return err
      const gmail = await getGmailClient(userId!, account_name)
      const raw = buildMime({ to, subject, body, html, cc, bcc, attachments })
      const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
      return { content: [{ type: 'text', text: JSON.stringify({ message_id: res.data.id }) }] }
    }
  )

  server.tool(
    'reply-email',
    'Reply to an email, automatically filling threading headers.',
    {
      message_id: z.string().describe('ID of the message to reply to'),
      body: z.string().describe('Reply body (plain text)'),
      account_name: z.string().optional().describe('Gmail account name (default: "default")'),
      html: z.string().optional().describe('HTML reply body'),
      cc: z.string().optional().describe('CC recipients'),
      bcc: z.string().optional().describe('BCC recipients'),
      attachments: attachmentSchema,
    },
    async ({ message_id, body, account_name = 'default', html, cc, bcc, attachments }) => {
      const err = requireAuth(); if (err) return err
      const gmail = await getGmailClient(userId!, account_name)
      const orig = await gmail.users.messages.get({
        userId: 'me',
        id: message_id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Message-ID', 'References'],
      })
      const headers = orig.data.payload?.headers ?? []
      const subject = getHeader(headers, 'Subject')
      const from = getHeader(headers, 'From')
      const msgId = getHeader(headers, 'Message-ID')
      const refs = getHeader(headers, 'References')

      const raw = buildMime({
        to: from,
        subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
        body, html, cc, bcc, attachments,
        inReplyTo: msgId,
        references: refs ? `${refs} ${msgId}` : msgId,
      })
      const res = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw, threadId: orig.data.threadId! },
      })
      return { content: [{ type: 'text', text: JSON.stringify({ message_id: res.data.id, thread_id: res.data.threadId }) }] }
    }
  )

  server.tool(
    'label-email',
    'Modify labels on a message (mark read/unread, archive, trash, star, or provide custom label IDs).',
    {
      message_id: z.string().describe('Message ID'),
      action: z.enum(['mark-read', 'mark-unread', 'archive', 'trash', 'star', 'unstar']).optional().describe('Preset action'),
      add_labels: z.array(z.string()).optional().describe('Label IDs to add'),
      remove_labels: z.array(z.string()).optional().describe('Label IDs to remove'),
      account_name: z.string().optional().describe('Gmail account name (default: "default")'),
    },
    async ({ message_id, action, add_labels = [], remove_labels = [], account_name = 'default' }) => {
      const err = requireAuth(); if (err) return err
      const gmail = await getGmailClient(userId!, account_name)
      const addLabelIds = [...add_labels]
      const removeLabelIds = [...remove_labels]

      if (action === 'mark-read') removeLabelIds.push('UNREAD')
      else if (action === 'mark-unread') addLabelIds.push('UNREAD')
      else if (action === 'archive') removeLabelIds.push('INBOX')
      else if (action === 'trash') addLabelIds.push('TRASH')
      else if (action === 'star') addLabelIds.push('STARRED')
      else if (action === 'unstar') removeLabelIds.push('STARRED')

      await gmail.users.messages.modify({
        userId: 'me',
        id: message_id,
        requestBody: { addLabelIds, removeLabelIds },
      })
      return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] }
    }
  )

  server.tool(
    'draft-email',
    'Manage email drafts: create, list, read, send, or delete.',
    {
      action: z.enum(['create', 'list', 'read', 'send', 'delete']).describe('Draft action to perform'),
      account_name: z.string().optional().describe('Gmail account name (default: "default")'),
      draft_id: z.string().optional().describe('Draft ID — required for read, send, delete'),
      to: z.string().optional().describe('Recipient (for create)'),
      subject: z.string().optional().describe('Subject (for create)'),
      body: z.string().optional().describe('Plain text body (for create)'),
      html: z.string().optional().describe('HTML body (for create)'),
      cc: z.string().optional().describe('CC recipients (for create)'),
      bcc: z.string().optional().describe('BCC recipients (for create)'),
      reply_to_message_id: z.string().optional().describe('Message ID to reply to (for creating a draft reply)'),
    },
    async ({ action, account_name = 'default', draft_id, to, subject, body, html, cc, bcc, reply_to_message_id }) => {
      const err = requireAuth(); if (err) return err
      const gmail = await getGmailClient(userId!, account_name)

      if (action === 'create') {
        let raw: string
        if (reply_to_message_id) {
          const orig = await gmail.users.messages.get({
            userId: 'me',
            id: reply_to_message_id,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'Message-ID', 'References'],
          })
          const headers = orig.data.payload?.headers ?? []
          const origSubject = getHeader(headers, 'Subject')
          const from = getHeader(headers, 'From')
          const msgId = getHeader(headers, 'Message-ID')
          const refs = getHeader(headers, 'References')
          raw = buildMime({
            to: to ?? from,
            subject: subject ?? (origSubject.startsWith('Re:') ? origSubject : `Re: ${origSubject}`),
            body, html, cc, bcc,
            inReplyTo: msgId,
            references: refs ? `${refs} ${msgId}` : msgId,
          })
        } else {
          raw = buildMime({ to, subject, body, html, cc, bcc })
        }
        const res = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } })
        return { content: [{ type: 'text', text: JSON.stringify({ draft_id: res.data.id }) }] }
      }

      if (action === 'list') {
        const res = await gmail.users.drafts.list({ userId: 'me' })
        return { content: [{ type: 'text', text: JSON.stringify(res.data.drafts ?? []) }] }
      }

      if (action === 'read') {
        const res = await gmail.users.drafts.get({ userId: 'me', id: draft_id! })
        return { content: [{ type: 'text', text: JSON.stringify(res.data) }] }
      }

      if (action === 'send') {
        const res = await gmail.users.drafts.send({ userId: 'me', requestBody: { id: draft_id } })
        return { content: [{ type: 'text', text: JSON.stringify({ message_id: res.data.id }) }] }
      }

      if (action === 'delete') {
        await gmail.users.drafts.delete({ userId: 'me', id: draft_id! })
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] }
      }

      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Unknown action' }) }] }
    }
  )
}
