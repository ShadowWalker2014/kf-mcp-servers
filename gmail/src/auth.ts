import { Request, Response, NextFunction } from 'express'
import { getUserByApiKey } from './db.js'

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const key = (req.headers['x-api-key'] as string | undefined)
    ?? (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined)

  if (!key) {
    res.status(401).json({ error: 'Missing API key. Use X-API-Key header or Authorization: Bearer <key>' })
    return
  }

  const userId = await getUserByApiKey(key)
  if (!userId) {
    res.status(401).json({ error: 'Invalid API key' })
    return
  }

  req.userId = userId
  next()
}
