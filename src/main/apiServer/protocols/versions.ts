/**
 * Pinned external protocol versions for Agent Cards, AG-UI custom meta events, and OpenAPI docs.
 * @see https://a2a-protocol.org/v0.3.0/specification/
 * @see https://docs.ag-ui.com/
 * @see https://a2ui.org/
 */
export const A2A_PROTOCOL_VERSION = '0.3.0' as const

/** Declarative UI spec carried in A2A DataParts (MIME application/json+a2ui). */
export const A2UI_SCHEMA_VERSION = '0.8' as const

/** AG-UI event protocol — align event `type` strings with docs.ag-ui.com when emitting. */
export const AG_UI_DOCS_REFERENCE = 'https://docs.ag-ui.com/concepts/events' as const

export const A2UI_MIME_TYPE = 'application/json+a2ui' as const

/** URI advertised in Agent Card extensions for A2UI capability (Google ADK pattern). */
export const A2UI_A2A_EXTENSION_URI = 'https://a2ui.org/a2a-extension/a2ui/v0.8' as const
