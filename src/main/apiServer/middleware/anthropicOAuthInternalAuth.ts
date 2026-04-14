import { loggerService } from '@main/services/LoggerService'
import * as crypto from 'crypto'
import type { NextFunction, Request, Response } from 'express'

const logger = loggerService.withContext('AnthropicOAuthInternalAuth')

export const ANTHROPIC_INTERNAL_SECRET_HEADER = 'x-cherry-anthropic-oauth-secret'
const INTERNAL_SECRET_HEADER = ANTHROPIC_INTERNAL_SECRET_HEADER

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) {
    return false
  }

  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

// Generate or retrieve internal secret (simple approach for now)
const internalSecret = crypto.randomUUID()

export function getAnthropicInternalSecret(): string {
  return internalSecret
}

export function getAnthropicInternalHeaders(): Record<string, string> {
  return { [ANTHROPIC_INTERNAL_SECRET_HEADER]: internalSecret }
}

export function anthropicOAuthInternalAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const remoteAddress = req.socket.remoteAddress
  if (!isLoopbackAddress(remoteAddress)) {
    logger.warn('Rejected non-loopback Anthropic OAuth internal request', {
      remoteAddress,
      path: req.originalUrl
    })
    return res.status(403).json({ error: 'Forbidden' })
  }

  const secret = req.header(INTERNAL_SECRET_HEADER) || ''
  if (!secret.trim()) {
    return res.status(401).json({ error: 'Unauthorized: missing internal credentials' })
  }

  // Use timing-safe comparison for the secret
  if (secret.length !== internalSecret.length) {
    logger.warn('Rejected Anthropic OAuth internal request with invalid secret', {
      remoteAddress,
      path: req.originalUrl
    })
    return res.status(403).json({ error: 'Forbidden' })
  }

  try {
    const secretMatch = crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(internalSecret))
    if (!secretMatch) {
      logger.warn('Rejected Anthropic OAuth internal request with invalid secret', {
        remoteAddress,
        path: req.originalUrl
      })
      return res.status(403).json({ error: 'Forbidden' })
    }
  } catch {
    return res.status(403).json({ error: 'Forbidden' })
  }

  return next()
}
