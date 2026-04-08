import {
  type ArtifactAccessPolicy,
  type ArtifactDirectiveOverrides,
  ARTIFACTS_CONFIG_KEY,
  type ArtifactSettings,
  ArtifactSettingsSchema,
  type ArtifactThemeId,
  type HtmlArtifactRuntimeProfileId
} from '@shared/artifacts'

const HTML_LIBRARY_URLS = {
  htmx: {
    primary: 'https://cdn.jsdelivr.net/npm/htmx.org@2.0.8/dist/htmx.min.js',
    fallback: 'https://unpkg.com/htmx.org@2.0.8/dist/htmx.min.js'
  },
  alpinejs: {
    primary: 'https://cdn.jsdelivr.net/npm/alpinejs@3.15.0/dist/cdn.min.js'
  }
} as const

const MANAGED_HTML_LIBRARIES = [
  {
    ids: ['htmx.org'],
    normalizedUrl: HTML_LIBRARY_URLS.htmx.primary
  },
  {
    ids: ['alpinejs'],
    normalizedUrl: HTML_LIBRARY_URLS.alpinejs.primary
  }
] as const

export const DEFAULT_ARTIFACT_BASE_CSS = `
:root {
  color-scheme: light;
  --artifact-background: #ffffff;
  --artifact-surface: #f8fafc;
  --artifact-surface-strong: #e2e8f0;
  --artifact-foreground: #0f172a;
  --artifact-muted: #475569;
  --artifact-border: rgba(15, 23, 42, 0.12);
  --artifact-primary: #2563eb;
  --artifact-primary-foreground: #eff6ff;
  --artifact-secondary: #e2e8f0;
  --artifact-secondary-foreground: #0f172a;
  --artifact-danger: #dc2626;
  --artifact-ring: rgba(37, 99, 235, 0.28);
  font-family:
    'Inter',
    'Segoe UI',
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    sans-serif;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
  background: var(--artifact-background);
  color: var(--artifact-foreground);
}

body {
  padding: 24px;
  font-family: inherit;
  line-height: 1.5;
}

a {
  color: var(--artifact-primary);
}

img,
svg,
video,
canvas {
  max-width: 100%;
}

button,
input,
textarea,
select {
  font: inherit;
}

code,
pre {
  font-family:
    'SFMono-Regular',
    'JetBrains Mono',
    ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
}

pre {
  white-space: pre-wrap;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid var(--artifact-border);
  background: var(--artifact-surface);
}

.artifact-shell {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.artifact-prose > * + * {
  margin-top: 1rem;
}

.flex { display: flex; }
.grid { display: grid; }
.block { display: block; }
.inline-flex { display: inline-flex; }
.items-center { align-items: center; }
.items-start { align-items: flex-start; }
.justify-between { justify-content: space-between; }
.justify-center { justify-content: center; }
.w-full { width: 100%; }
.max-w-xl { max-width: 36rem; }
.max-w-2xl { max-width: 42rem; }
.rounded-md { border-radius: 0.5rem; }
.rounded-lg { border-radius: 0.75rem; }
.rounded-xl { border-radius: 1rem; }
.border { border: 1px solid var(--artifact-border); }
.bg-card { background: var(--artifact-surface); }
.text-muted { color: var(--artifact-muted); }
.text-sm { font-size: 0.875rem; line-height: 1.25rem; }
.text-lg { font-size: 1.125rem; line-height: 1.75rem; }
.text-2xl { font-size: 1.5rem; line-height: 2rem; }
.font-medium { font-weight: 500; }
.font-semibold { font-weight: 600; }
.font-bold { font-weight: 700; }
.shadow-sm { box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08); }
.p-3 { padding: 0.75rem; }
.p-4 { padding: 1rem; }
.p-6 { padding: 1.5rem; }
.px-4 { padding-left: 1rem; padding-right: 1rem; }
.py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
.gap-2 { gap: 0.5rem; }
.gap-3 { gap: 0.75rem; }
.gap-4 { gap: 1rem; }
.space-y-4 > * + * { margin-top: 1rem; }

.artifact-ui-button {
  align-items: center;
  appearance: none;
  border: 1px solid transparent;
  border-radius: 0.75rem;
  cursor: pointer;
  display: inline-flex;
  font-size: 0.95rem;
  font-weight: 600;
  gap: 0.5rem;
  justify-content: center;
  min-height: 2.75rem;
  padding: 0.625rem 1rem;
  transition:
    transform 0.16s ease,
    background 0.16s ease,
    border-color 0.16s ease,
    box-shadow 0.16s ease;
}

.artifact-ui-button:focus-visible,
.artifact-ui-input:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px var(--artifact-ring);
}

.artifact-ui-button:hover {
  transform: translateY(-1px);
}

.artifact-ui-button--default {
  background: var(--artifact-primary);
  color: var(--artifact-primary-foreground);
}

.artifact-ui-button--secondary {
  background: var(--artifact-secondary);
  color: var(--artifact-secondary-foreground);
}

.artifact-ui-button--ghost {
  background: transparent;
  color: var(--artifact-foreground);
}

.artifact-ui-button--outline {
  background: transparent;
  border-color: var(--artifact-border);
  color: var(--artifact-foreground);
}

.artifact-ui-button--sm {
  min-height: 2.25rem;
  padding: 0.45rem 0.85rem;
}

.artifact-ui-button--lg {
  min-height: 3rem;
  padding: 0.75rem 1.25rem;
}

.artifact-ui-card {
  background: var(--artifact-surface);
  border: 1px solid var(--artifact-border);
  border-radius: 1rem;
  box-shadow: 0 12px 36px rgba(15, 23, 42, 0.08);
  overflow: hidden;
}

.artifact-ui-card__header,
.artifact-ui-card__content,
.artifact-ui-card__footer {
  padding: 1rem 1.25rem;
}

.artifact-ui-card__header {
  border-bottom: 1px solid var(--artifact-border);
}

.artifact-ui-card__footer {
  border-top: 1px solid var(--artifact-border);
}

.artifact-ui-card__title {
  font-size: 1.125rem;
  font-weight: 700;
  margin: 0;
}

.artifact-ui-card__description {
  color: var(--artifact-muted);
  margin: 0.5rem 0 0;
}

.artifact-ui-badge {
  align-items: center;
  border-radius: 999px;
  display: inline-flex;
  font-size: 0.75rem;
  font-weight: 700;
  gap: 0.25rem;
  padding: 0.2rem 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  background: rgba(37, 99, 235, 0.1);
  color: var(--artifact-primary);
}

.artifact-ui-badge--secondary {
  background: var(--artifact-secondary);
  color: var(--artifact-secondary-foreground);
}

.artifact-ui-badge--outline {
  background: transparent;
  border: 1px solid var(--artifact-border);
  color: var(--artifact-foreground);
}

.artifact-ui-input {
  background: var(--artifact-background);
  border: 1px solid var(--artifact-border);
  border-radius: 0.75rem;
  color: var(--artifact-foreground);
  min-height: 2.75rem;
  padding: 0.625rem 0.875rem;
  width: 100%;
}
`

const ARTIFACT_THEME_CSS: Record<ArtifactThemeId, string> = {
  'boss-light': `
    :root {
      color-scheme: light;
      --artifact-background: #ffffff;
      --artifact-surface: #f8fafc;
      --artifact-surface-strong: #e2e8f0;
      --artifact-foreground: #0f172a;
      --artifact-muted: #475569;
      --artifact-border: rgba(15, 23, 42, 0.12);
      --artifact-primary: #2563eb;
      --artifact-primary-foreground: #eff6ff;
      --artifact-secondary: #e2e8f0;
      --artifact-secondary-foreground: #0f172a;
      --artifact-danger: #dc2626;
      --artifact-ring: rgba(37, 99, 235, 0.24);
    }
  `,
  'boss-dark': `
    :root {
      color-scheme: dark;
      --artifact-background: #020617;
      --artifact-surface: #0f172a;
      --artifact-surface-strong: #1e293b;
      --artifact-foreground: #e2e8f0;
      --artifact-muted: #94a3b8;
      --artifact-border: rgba(148, 163, 184, 0.22);
      --artifact-primary: #60a5fa;
      --artifact-primary-foreground: #082f49;
      --artifact-secondary: #1e293b;
      --artifact-secondary-foreground: #e2e8f0;
      --artifact-danger: #f87171;
      --artifact-ring: rgba(96, 165, 250, 0.3);
    }
  `,
  ocean: `
    :root {
      color-scheme: light;
      --artifact-background: #f4fbff;
      --artifact-surface: #ffffff;
      --artifact-surface-strong: #d9f0ff;
      --artifact-foreground: #082f49;
      --artifact-muted: #155e75;
      --artifact-border: rgba(8, 47, 73, 0.12);
      --artifact-primary: #0f766e;
      --artifact-primary-foreground: #ecfeff;
      --artifact-secondary: #cffafe;
      --artifact-secondary-foreground: #134e4a;
      --artifact-danger: #b91c1c;
      --artifact-ring: rgba(15, 118, 110, 0.24);
    }
  `
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("'", '&#39;')
}

function getArtifactCsp(internetEnabled: boolean): string {
  return internetEnabled
    ? "default-src * data: blob: filesystem:; img-src * data: blob:; style-src * 'unsafe-inline'; script-src * 'unsafe-inline' 'unsafe-eval'; connect-src * data: blob:;"
    : "default-src 'self' data: blob: filesystem:; img-src https: http: data: blob:; style-src 'unsafe-inline'; script-src https://cdn.jsdelivr.net 'unsafe-inline' 'unsafe-eval'; connect-src 'none';"
}

function shouldForceArtifactInternetAccess(runtimeProfileId: HtmlArtifactRuntimeProfileId): boolean {
  return runtimeProfileId.includes('htmx')
}

function getResolvedArtifactSettings(value: unknown): ArtifactSettings {
  const parsed = ArtifactSettingsSchema.safeParse(value)
  if (parsed.success) {
    return parsed.data
  }

  return ArtifactSettingsSchema.parse({
    baseCss: DEFAULT_ARTIFACT_BASE_CSS
  })
}

export function getThemeCss(themeId: ArtifactThemeId): string {
  return ARTIFACT_THEME_CSS[themeId] ?? ARTIFACT_THEME_CSS['boss-light']
}

export async function loadArtifactSettings(): Promise<ArtifactSettings> {
  const value = await window.api.config.get(ARTIFACTS_CONFIG_KEY)
  const parsed = getResolvedArtifactSettings(value)

  if (!parsed.baseCss) {
    return {
      ...parsed,
      baseCss: DEFAULT_ARTIFACT_BASE_CSS
    }
  }

  return parsed
}

export async function saveArtifactSettings(settings: ArtifactSettings): Promise<void> {
  await window.api.config.set(ARTIFACTS_CONFIG_KEY, settings)
}

function parseHtmlOverride(source: string, name: string): string | undefined {
  const regex = new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["']([^"']+)["']\\s*\\/?>`, 'i')
  return regex.exec(source)?.[1]?.trim()
}

function parseReactOverride(source: string, directive: string): string | undefined {
  const regex = new RegExp(`^\\s*//\\s*${directive}:\\s*(.+)$`, 'im')
  return regex.exec(source)?.[1]?.trim()
}

export function parseArtifactDirectiveOverrides(kind: 'html' | 'react', source: string): ArtifactDirectiveOverrides {
  const themeRaw =
    kind === 'html' ? parseHtmlOverride(source, 'artifact-theme') : parseReactOverride(source, 'artifact-theme')
  const internetRaw =
    kind === 'html' ? parseHtmlOverride(source, 'artifact-network') : parseReactOverride(source, 'artifact-network')
  const servicesRaw =
    kind === 'html' ? parseHtmlOverride(source, 'artifact-services') : parseReactOverride(source, 'artifact-services')

  return {
    themeId: themeRaw as ArtifactThemeId | undefined,
    internetEnabled:
      internetRaw === undefined ? undefined : ['on', 'true', 'enabled'].includes(internetRaw.toLowerCase()),
    serviceIds: servicesRaw
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  }
}

export function resolveArtifactThemeId(
  settings: ArtifactSettings,
  overrides: ArtifactDirectiveOverrides
): ArtifactThemeId {
  return overrides.themeId ?? settings.defaultThemeId
}

export function resolveArtifactAccessPolicy(
  settings: ArtifactSettings,
  overrides: ArtifactDirectiveOverrides
): ArtifactAccessPolicy {
  return {
    internetEnabled: overrides.internetEnabled ?? settings.accessPolicy.internetEnabled,
    serviceIds: overrides.serviceIds ?? settings.accessPolicy.serviceIds
  }
}

function getArtifactServiceBridgeScript(settings: ArtifactSettings, overrides: ArtifactDirectiveOverrides): string {
  const allowedIds = resolveArtifactAccessPolicy(settings, overrides).serviceIds

  return `
    <script>
      ;(() => {
        const allowedIds = new Set(${JSON.stringify(allowedIds)})
        const pendingRequests = new Map()
        const subscriptions = new Map()

        const postRequest = (payload) => {
          window.parent.postMessage(
            {
              source: 'artifact-service-request',
              ...payload
            },
            '*'
          )
        }

        const createRequestId = (prefix) => prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2)

        const ensureAllowed = (serviceId) => {
          if (!allowedIds.has(serviceId)) {
            throw new Error('Artifact service is not allowed in this preview.')
          }
        }

        const createSubscriptionHandle = (subscriptionId) => {
          const state = {
            next: new Set(),
            error: new Set(),
            complete: new Set(),
            ack: new Set()
          }

          const handle = {
            id: subscriptionId,
            on(kind, listener) {
              if (!state[kind]) {
                throw new Error('Unsupported subscription event type: ' + kind)
              }

              state[kind].add(listener)
              return () => state[kind].delete(listener)
            },
            unsubscribe() {
              if (!subscriptions.has(subscriptionId)) {
                return
              }

              subscriptions.delete(subscriptionId)
              postRequest({
                kind: 'unsubscribe',
                subscriptionId
              })
            }
          }

          subscriptions.set(subscriptionId, {
            dispatch(event) {
              const listeners = state[event.kind]
              if (!listeners) {
                return
              }

              listeners.forEach((listener) => {
                try {
                  listener(event.payload)
                } catch (error) {
                  console.error('Artifact subscription listener failed', error)
                }
              })
            },
            handle
          })

          return handle
        }

        window.addEventListener('message', (event) => {
          const data = event.data
          if (!data || typeof data !== 'object') {
            return
          }

          if (data.source === 'artifact-service-response' && data.requestId && pendingRequests.has(data.requestId)) {
            const pending = pendingRequests.get(data.requestId)
            pendingRequests.delete(data.requestId)

            if (data.error) {
              pending.reject(new Error(data.error))
              return
            }

            pending.resolve(data.result)
            return
          }

          if (data.source === 'artifact-service-subscription-ack' && data.requestId && pendingRequests.has(data.requestId)) {
            const pending = pendingRequests.get(data.requestId)
            pendingRequests.delete(data.requestId)

            if (data.error) {
              pending.reject(new Error(data.error))
              return
            }

            pending.resolve(createSubscriptionHandle(data.subscriptionId))
            return
          }

          if (data.source === 'artifact-service-subscription-event' && data.event?.subscriptionId) {
            const entry = subscriptions.get(data.event.subscriptionId)
            if (!entry) {
              return
            }

            entry.dispatch(data.event)
            if (data.event.kind === 'complete') {
              subscriptions.delete(data.event.subscriptionId)
            }
          }
        })

        window.artifactServices = {
          serviceIds: Array.from(allowedIds),
          invokeOperation(serviceId, operationId, input = {}) {
            return new Promise((resolve, reject) => {
              try {
                ensureAllowed(serviceId)
                const requestId = createRequestId('artifact-op')
                pendingRequests.set(requestId, { resolve, reject })
                postRequest({
                  kind: 'invoke-operation',
                  requestId,
                  serviceId,
                  operationId,
                  input
                })
              } catch (error) {
                reject(error)
              }
            })
          },
          subscribe(serviceId, operationId, variables = {}) {
            return new Promise((resolve, reject) => {
              try {
                ensureAllowed(serviceId)
                const requestId = createRequestId('artifact-sub')
                pendingRequests.set(requestId, { resolve, reject })
                postRequest({
                  kind: 'subscribe',
                  requestId,
                  serviceId,
                  operationId,
                  variables
                })
              } catch (error) {
                reject(error)
              }
            })
          }
        }

        const unsupportedLlmMethod = (method) => () =>
          Promise.reject(
            new Error(
              'Artifact preview does not expose llm.' +
                method +
                '. Use artifactServices.invokeOperation(serviceId, operationId, input) instead.'
            )
          )

        const llmCompatibilityTarget = function (serviceId, operationId, input = {}) {
          if (typeof serviceId === 'string' && typeof operationId === 'string') {
            return window.artifactServices.invokeOperation(serviceId, operationId, input)
          }

          return unsupportedLlmMethod('call')()
        }

        llmCompatibilityTarget.serviceIds = Array.from(allowedIds)
        llmCompatibilityTarget.invokeOperation = (...args) => window.artifactServices.invokeOperation(...args)
        llmCompatibilityTarget.subscribe = (...args) => window.artifactServices.subscribe(...args)
        llmCompatibilityTarget.call = (...args) => llmCompatibilityTarget(...args)
        llmCompatibilityTarget.tool = (...args) => llmCompatibilityTarget(...args)
        llmCompatibilityTarget.complete = unsupportedLlmMethod('complete')
        llmCompatibilityTarget.generate = unsupportedLlmMethod('generate')
        llmCompatibilityTarget.chat = unsupportedLlmMethod('chat')

        window.llm = llmCompatibilityTarget
      })()
    </script>
  `
}

function getCombinedCss(settings: ArtifactSettings, themeId: ArtifactThemeId): string {
  return [settings.baseCss || DEFAULT_ARTIFACT_BASE_CSS, getThemeCss(themeId), settings.customCss].join('\n')
}

function normalizeExternalLibraryUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim()

  if (!trimmed || /^(?:data|blob|file|javascript|mailto|tel):/i.test(trimmed)) {
    return null
  }

  const withoutScheme = trimmed.replace(/^https?:\/\//i, '').replace(/^\/\//, '')

  for (const library of MANAGED_HTML_LIBRARIES) {
    if (library.ids.some((id) => withoutScheme.startsWith(`cdn.jsdelivr.net/npm/${id}`))) {
      return library.normalizedUrl
    }

    if (library.ids.some((id) => withoutScheme.startsWith(`unpkg.com/${id}`))) {
      return library.normalizedUrl
    }
  }

  if (withoutScheme.startsWith('cdn.jsdelivr.net/')) {
    return `https://${withoutScheme}`
  }

  if (withoutScheme.startsWith('unpkg.com/')) {
    return `https://${withoutScheme}`
  }

  return null
}

function normalizeExternalLibraryReferences(source: string): string {
  return source.replace(/\b(src|href)\s*=\s*(["'])([^"']+)\2/gi, (match, attribute, quote, rawUrl) => {
    const normalizedUrl = normalizeExternalLibraryUrl(rawUrl)

    if (!normalizedUrl) {
      return match
    }

    return `${attribute}=${quote}${normalizedUrl}${quote}`
  })
}

function stripManagedLibraryScripts(source: string, normalizedUrls: string[]): string {
  if (normalizedUrls.length === 0) {
    return source
  }

  const escapedUrls = normalizedUrls.map((url) => url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const scriptRegex = new RegExp(`<script\\b[^>]*\\bsrc\\s*=\\s*(["'])(?:${escapedUrls})\\1[^>]*>\\s*</script>`, 'gi')

  return source.replace(scriptRegex, '')
}

function buildManagedLibraryScripts(runtimeProfileId: HtmlArtifactRuntimeProfileId): string[] {
  const scripts: string[] = []

  if (runtimeProfileId.includes('htmx')) {
    scripts.push(`<script>
      ;(() => {
        if (window.htmx) {
          return
        }

        const urls = ${JSON.stringify([HTML_LIBRARY_URLS.htmx.primary, HTML_LIBRARY_URLS.htmx.fallback])}
        const load = (index) => {
          if (index >= urls.length) {
            console.error('[ArtifactPreview] Failed to load managed HTMX runtime.', urls)
            return
          }

          const script = document.createElement('script')
          script.src = urls[index]
          script.defer = true
          script.onload = () => {
            if (!window.htmx) {
              load(index + 1)
            }
          }
          script.onerror = () => load(index + 1)
          document.head.appendChild(script)
        }

        load(0)
      })()
    </script>`)
  }

  if (runtimeProfileId.includes('alpine')) {
    scripts.push(`<script defer src="${HTML_LIBRARY_URLS.alpinejs.primary}"></script>`)
  }

  return scripts
}

function getManagedLibraryUrlsToStrip(runtimeProfileId: HtmlArtifactRuntimeProfileId): string[] {
  const urls: string[] = []

  if (runtimeProfileId.includes('htmx')) {
    urls.push(HTML_LIBRARY_URLS.htmx.primary, HTML_LIBRARY_URLS.htmx.fallback)
  }

  if (runtimeProfileId.includes('alpine')) {
    urls.push(HTML_LIBRARY_URLS.alpinejs.primary)
  }

  return urls
}

function normalizeHtmlDocument(source: string, head: string, title: string): string {
  const trimmed = source.trim()
  const titleTag = `<title>${escapeHtml(title)}</title>`
  const normalizedHead = `${titleTag}${head}`

  if (/<html[\s>]/i.test(trimmed)) {
    if (/<head[\s>]/i.test(trimmed)) {
      return trimmed.replace(/<head([^>]*)>/i, `<head$1>${normalizedHead}`)
    }

    return trimmed.replace(/<html([^>]*)>/i, `<html$1><head>${normalizedHead}</head>`)
  }

  return `<!doctype html><html><head>${normalizedHead}</head><body>${trimmed}</body></html>`
}

export function buildHtmlArtifactPreviewDocument({
  source,
  title,
  runtimeProfileId,
  settings,
  overrides
}: {
  source: string
  title: string
  runtimeProfileId: HtmlArtifactRuntimeProfileId
  settings: ArtifactSettings
  overrides: ArtifactDirectiveOverrides
}): string {
  const internetEnabled =
    shouldForceArtifactInternetAccess(runtimeProfileId) ||
    overrides.internetEnabled ||
    settings.accessPolicy.internetEnabled
  const themeId = resolveArtifactThemeId(settings, overrides)
  const css = getCombinedCss(settings, themeId)
  const normalizedSource = normalizeExternalLibraryReferences(source)
  const strippedSource = stripManagedLibraryScripts(normalizedSource, getManagedLibraryUrlsToStrip(runtimeProfileId))
  const libraries = buildManagedLibraryScripts(runtimeProfileId)

  const head = [
    `<meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(getArtifactCsp(internetEnabled))}" />`,
    `<style>${css}</style>`,
    ...libraries,
    getArtifactServiceBridgeScript(settings, overrides)
  ].join('')

  return normalizeHtmlDocument(strippedSource, head, title)
}

export function buildReactArtifactPreviewDocument({
  title,
  script,
  settings,
  overrides
}: {
  title: string
  script: string
  settings: ArtifactSettings
  overrides: ArtifactDirectiveOverrides
}): string {
  const internetEnabled = overrides.internetEnabled ?? settings.accessPolicy.internetEnabled

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta http-equiv="Content-Security-Policy" content="${escapeAttribute(getArtifactCsp(internetEnabled))}" />
      <title>${escapeHtml(title)}</title>
    </head>
    <body>
      <div id="__artifact-host" class="artifact-shell"></div>
      ${getArtifactServiceBridgeScript(settings, overrides)}
      <script>${script}</script>
    </body>
  </html>`
}
