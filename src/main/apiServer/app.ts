import { loggerService } from '@main/services/LoggerService'
import cors from 'cors'
import express from 'express'
import { v4 as uuidv4 } from 'uuid'

import { LONG_POLL_TIMEOUT_MS } from './config/timeouts'
import { authMiddleware } from './middleware/auth'
import { errorHandler } from './middleware/error'
import { setupOpenAPIDocumentation } from './middleware/openapi'
import { buildTheBossAgentCard, getRequestBaseUrl } from './routes/a2a/agentCard'
import { handleA2AJsonRpc } from './routes/a2a/jsonRpc'
import { agentsRoutes } from './routes/agents'
import { channelsRouter } from './routes/channels'
import { chatRoutes } from './routes/chat'
import { clawMcpRoutes } from './routes/claw-mcp'
import { knowledgeRoutes } from './routes/knowledge'
import { mcpRoutes } from './routes/mcp'
import { messagesProviderRoutes, messagesRoutes } from './routes/messages'
import { modelsRoutes } from './routes/models'
import { tasksRouter } from './routes/tasks'

const logger = loggerService.withContext('ApiServer')

const extendMessagesTimeout: express.RequestHandler = (req, res, next) => {
  req.setTimeout(LONG_POLL_TIMEOUT_MS)
  res.setTimeout(LONG_POLL_TIMEOUT_MS)
  next()
}

const app = express()
app.use(
  express.json({
    limit: '50mb'
  })
)

// Global middleware
app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    const duration = Date.now() - start
    logger.info('API request completed', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: duration
    })
  })
  next()
})

app.use((_req, res, next) => {
  res.setHeader('X-Request-ID', uuidv4())
  next()
})

app.use(
  cors({
    origin: '*',
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  })
)

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Check server status (no authentication required)
 *     tags: [Health]
 *     security: []
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 version:
 *                   type: string
 *                   example: 1.0.0
 */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  })
})

/**
 * @swagger
 * /.well-known/agent.json:
 *   get:
 *     summary: A2A Agent Card (discovery)
 *     description: >
 *       JSON metadata for Agent2Agent protocol v0.3.0. Uses `protocolVersion` and `url` pointing to POST /v1/a2a.
 *       No authentication on this path; Bearer token still required for /v1/* execution.
 *     tags: [A2A]
 *     security: []
 *     responses:
 *       200:
 *         description: Agent Card
 */
app.get('/.well-known/agent.json', (req, res) => {
  res.json(buildTheBossAgentCard(getRequestBaseUrl(req)))
})

/**
 * @swagger
 * /:
 *   get:
 *     summary: API information
 *     description: Get basic API information and available endpoints
 *     tags: [General]
 *     security: []
 *     responses:
 *       200:
 *         description: API information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 name:
 *                   type: string
 *                   example: The Boss API
 *                 version:
 *                   type: string
 *                   example: 1.0.0
 *                 endpoints:
 *                   type: object
 */
app.get('/', (_req, res) => {
  res.json({
    name: 'The Boss API',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      docs: 'GET /api-docs',
      docs_json: 'GET /api-docs.json',
      chat_completions: 'POST /v1/chat/completions',
      models: 'GET /v1/models',
      messages: 'POST /v1/messages',
      messages_provider: 'POST /:provider/v1/messages',
      mcps: 'GET /v1/mcps',
      mcp_server: 'GET /v1/mcps/:server_id',
      mcp_proxy: 'ALL /v1/mcps/:server_id/mcp',
      agents: 'GET /v1/agents',
      channels: 'GET /v1/channels',
      agent_sessions: 'GET /v1/agents/:agentId/sessions',
      session_messages: 'GET /v1/agents/:agentId/sessions/:sessionId/messages',
      session_messages_ag_ui: 'POST /v1/agents/:agentId/sessions/:sessionId/messages/ag-ui',
      session_messages_buffer: 'POST /v1/agents/:agentId/sessions/:sessionId/messages/buffer',
      a2a_jsonrpc: 'POST /v1/a2a',
      a2a_agent_card: 'GET /.well-known/agent.json',
      knowledge_bases: 'GET /v1/knowledge-bases',
      knowledge_search: 'POST /v1/knowledge-bases/search'
    }
  })
})

// Setup OpenAPI documentation before protected routes so docs remain public
setupOpenAPIDocumentation(app)

// Provider-specific messages route requires authentication
app.use('/:provider/v1/messages', authMiddleware, extendMessagesTimeout, messagesProviderRoutes)

// API v1 routes with auth
const apiRouter = express.Router()
apiRouter.use(authMiddleware)
// Mount routes
apiRouter.use('/chat', chatRoutes)
apiRouter.use('/mcps', mcpRoutes)
apiRouter.use('/messages', extendMessagesTimeout, messagesRoutes)
apiRouter.use('/models', modelsRoutes)
apiRouter.use('/agents', agentsRoutes)
apiRouter.use('/channels', channelsRouter)
apiRouter.use('/tasks', tasksRouter)
apiRouter.use('/claw', clawMcpRoutes)
apiRouter.use('/knowledge-bases', knowledgeRoutes)

/**
 * @swagger
 * /v1/a2a:
 *   post:
 *     summary: A2A JSON-RPC (message/send, message/stream)
 *     description: >
 *       Agent2Agent v0.3.0 JSON-RPC 2.0. Body includes `method`, `params.message`, and
 *       `params.metadata.theBoss` with `{ agentId, sessionId }` to route to a local agent session.
 *     tags: [A2A]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               jsonrpc:
 *                 type: string
 *                 example: "2.0"
 *               method:
 *                 type: string
 *                 enum: [message/send, message/stream]
 *               id:
 *                 oneOf:
 *                   - type: string
 *                   - type: integer
 *               params:
 *                 type: object
 *     responses:
 *       200:
 *         description: JSON-RPC result or SSE stream (message/stream)
 */
apiRouter.post('/a2a', handleA2AJsonRpc)
app.use('/v1', apiRouter)

// Error handling (must be last)
app.use(errorHandler)

export { app }
