import './style.css'

import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

type Session = {
  subject: string
  roles: string[]
  scope?: string
  email?: string
}

type ConfigResponse = {
  revision: number
  config: Record<string, unknown>
}

function App() {
  const [token, setToken] = useState('')
  const [session, setSession] = useState<Session | null>(null)
  const [config, setConfig] = useState<ConfigResponse | null>(null)
  const [identities, setIdentities] = useState<unknown[]>([])
  const [message, setMessage] = useState('')
  const [defaultChatModel, setDefaultChatModel] = useState('')

  async function api(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    const response = await fetch(path, { ...init, headers, credentials: 'include' })
    if (!response.ok) throw new Error(await response.text())
    if (response.status === 204) return null
    return response.json()
  }

  async function load() {
    const [sessionResult, configResult, identitiesResult] = await Promise.all([
      api('/auth/session').catch(() => null),
      api('/admin/config'),
      api('/admin/identities').catch(() => [])
    ])
    setSession(sessionResult)
    setConfig(configResult)
    setIdentities(Array.isArray(identitiesResult) ? identitiesResult : [])
    setDefaultChatModel(String(configResult?.config?.default_chat_model ?? ''))
  }

  async function saveConfig() {
    if (!config) return
    const next = await api('/admin/config', {
      method: 'PATCH',
      body: JSON.stringify({
        revision: config.revision,
        config: { default_chat_model: defaultChatModel }
      })
    })
    setConfig(next)
    setMessage('Configuration saved')
  }

  useEffect(() => {
    load().catch((error) => setMessage(error.message))
  }, [])

  return (
    <main className="shell">
      <section className="header">
        <div>
          <p className="eyebrow">The Boss Control Plane</p>
          <h1>Admin</h1>
        </div>
        <button type="button" onClick={() => load().catch((error) => setMessage(error.message))}>
          Refresh
        </button>
      </section>

      <section className="panel">
        <h2>Session</h2>
        <input
          aria-label="Bearer token"
          placeholder="Bearer token or bootstrap token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
        <pre>{JSON.stringify(session ?? { state: 'not loaded' }, null, 2)}</pre>
      </section>

      <section className="panel">
        <h2>Configuration</h2>
        <label>
          Default chat model
          <input value={defaultChatModel} onChange={(event) => setDefaultChatModel(event.target.value)} />
        </label>
        <button type="button" onClick={() => saveConfig().catch((error) => setMessage(error.message))}>
          Save
        </button>
        <pre>{JSON.stringify(config, null, 2)}</pre>
      </section>

      <section className="panel">
        <h2>Identities</h2>
        <pre>{JSON.stringify(identities, null, 2)}</pre>
      </section>

      {message ? <p className="message">{message}</p> : null}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
