import { loggerService } from '@main/services/LoggerService'
import { openAIOAuthService } from '@main/services/OpenAIOAuthService'
import type { NextFunction, Request, Response } from 'express'

const logger = loggerService.withContext('OpenAIOAuthInternalAuth')

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) {
    return false
  }

  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

export function openAIOAuthInternalAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const remoteAddress = req.socket.remoteAddress
  if (!isLoopbackAddress(remoteAddress)) {
    logger.warn('Rejected non-loopback OpenAI OAuth internal request', {
      remoteAddress,
      path: req.originalUrl
    })
    return res.status(403).json({ error: 'Forbidden' })
  }

  const secret = req.header(openAIOAuthService.getInternalHeaderName()) || ''
  if (!secret.trim()) {
    return res.status(401).json({ error: 'Unauthorized: missing internal credentials' })
  }

  if (!openAIOAuthService.matchesInternalSecret(secret)) {
    logger.warn('Rejected OpenAI OAuth internal request with invalid secret', {
      remoteAddress,
      path: req.originalUrl
    })
    return res.status(403).json({ error: 'Forbidden' })
  }

  return next()
}
