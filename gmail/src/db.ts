import pg from 'pg'
import crypto from 'crypto'

const { Pool } = pg
let pool: pg.Pool

export function getDb() {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  return pool
}

export async function initDb() {
  const db = getDb()
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      google_sub TEXT UNIQUE NOT NULL,
      email TEXT,
      name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      key_hash TEXT PRIMARY KEY,
      key_prefix TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      name TEXT DEFAULT 'default',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS gmail_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      account_name TEXT NOT NULL DEFAULT 'default',
      email TEXT,
      tokens_encrypted TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, account_name)
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      account_name TEXT NOT NULL,
      flow_type TEXT NOT NULL DEFAULT 'identity',
      expires_at TIMESTAMPTZ NOT NULL
    );
  `)
}

export function generateId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`
}

export function hashKey(key: string) {
  return crypto.createHash('sha256').update(key).digest('hex')
}

// ── User ops ──────────────────────────────────────────────────────────────────

export async function createUser(googleSub: string, email: string, name: string) {
  const db = getDb()
  const id = generateId('usr')
  await db.query('INSERT INTO users(id, google_sub, email, name) VALUES($1,$2,$3,$4)', [id, googleSub, email, name])
  return id
}

export async function getUserByGoogleSub(sub: string) {
  const db = getDb()
  const { rows } = await db.query('SELECT * FROM users WHERE google_sub=$1', [sub])
  return rows[0] as { id: string; google_sub: string; email: string; name: string } | undefined
}

export async function getUserById(id: string) {
  const db = getDb()
  const { rows } = await db.query('SELECT * FROM users WHERE id=$1', [id])
  return rows[0] as { id: string; google_sub: string; email: string; name: string } | undefined
}

// ── API key ops ───────────────────────────────────────────────────────────────

export async function createApiKey(userId: string, name = 'default') {
  const db = getDb()
  const raw = `gmk_${crypto.randomBytes(24).toString('hex')}`
  const hash = hashKey(raw)
  const prefix = raw.slice(0, 12)
  await db.query(
    'INSERT INTO api_keys(key_hash, key_prefix, user_id, name) VALUES($1,$2,$3,$4)',
    [hash, prefix, userId, name]
  )
  return raw
}

export async function getUserByApiKey(rawKey: string) {
  const db = getDb()
  const hash = hashKey(rawKey)
  const { rows } = await db.query('SELECT user_id FROM api_keys WHERE key_hash=$1', [hash])
  return rows[0]?.user_id as string | null
}

export async function listApiKeys(userId: string) {
  const db = getDb()
  const { rows } = await db.query(
    'SELECT key_prefix, name, created_at FROM api_keys WHERE user_id=$1 ORDER BY created_at',
    [userId]
  )
  return rows
}

export async function deleteApiKey(userId: string, keyPrefix: string) {
  const db = getDb()
  await db.query('DELETE FROM api_keys WHERE user_id=$1 AND key_prefix=$2', [userId, keyPrefix])
}

// ── Gmail account ops ─────────────────────────────────────────────────────────

export async function saveGmailAccount(userId: string, accountName: string, email: string, tokensEncrypted: string) {
  const db = getDb()
  const id = generateId('gma')
  await db.query(`
    INSERT INTO gmail_accounts(id, user_id, account_name, email, tokens_encrypted)
    VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(user_id, account_name)
    DO UPDATE SET email=$4, tokens_encrypted=$5, updated_at=NOW()
  `, [id, userId, accountName, email, tokensEncrypted])
}

export async function getGmailAccount(userId: string, accountName: string) {
  const db = getDb()
  const { rows } = await db.query(
    'SELECT * FROM gmail_accounts WHERE user_id=$1 AND account_name=$2',
    [userId, accountName]
  )
  return rows[0] as { id: string; user_id: string; account_name: string; email: string; tokens_encrypted: string } | null
}

export async function listGmailAccounts(userId: string) {
  const db = getDb()
  const { rows } = await db.query(
    'SELECT account_name, email, created_at FROM gmail_accounts WHERE user_id=$1 ORDER BY created_at',
    [userId]
  )
  return rows
}

export async function deleteGmailAccount(userId: string, accountName: string) {
  const db = getDb()
  await db.query('DELETE FROM gmail_accounts WHERE user_id=$1 AND account_name=$2', [userId, accountName])
}

export async function updateGmailTokens(userId: string, accountName: string, tokensEncrypted: string) {
  const db = getDb()
  await db.query(
    'UPDATE gmail_accounts SET tokens_encrypted=$3, updated_at=NOW() WHERE user_id=$1 AND account_name=$2',
    [userId, accountName, tokensEncrypted]
  )
}

// ── OAuth state ops ───────────────────────────────────────────────────────────

export async function saveOAuthState(userId: string | null, accountName: string, flowType: 'identity' | 'account') {
  const db = getDb()
  const state = crypto.randomBytes(24).toString('hex')
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
  await db.query(
    'INSERT INTO oauth_states(state, user_id, account_name, flow_type, expires_at) VALUES($1,$2,$3,$4,$5)',
    [state, userId, accountName, flowType, expiresAt]
  )
  return state
}

export async function consumeOAuthState(state: string) {
  const db = getDb()
  const { rows } = await db.query(
    'DELETE FROM oauth_states WHERE state=$1 AND expires_at > NOW() RETURNING user_id, account_name, flow_type',
    [state]
  )
  return rows[0] as { user_id: string | null; account_name: string; flow_type: 'identity' | 'account' } | undefined
}
