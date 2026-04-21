# The Boss Control Plane

First-party service boundary for The Boss desktop clients.

## Owned Domains

- Public site and downloads: `https://the-boss.know-me.tools`
- API and OpenAI-compatible gateway: `https://api.know-me.tools`
- Ory/Kratos browser auth entrypoint: `https://auth.know-me.tools`
- Cloudflare R2/CDN artifact delivery: `https://cdn.know-me.tools`

## Route Groups

- `/v1/*` OpenAI-compatible model APIs.
- `/catalog/*` provider, model, default, and capability metadata.
- `/account/*` authenticated account, usage, balance, and token management.
- `/updates/*` Electron update feeds and app update policy.
- `/runtimes/*` managed runtime binary manifests for UAR, Codex, and OpenCode.
- `/artifacts/*` Cloudflare CDN artifact URL resolution.
- `/analytics/*` first-party telemetry ingestion.
- `/admin/*` release, runtime, config, and identity administration.
- `/admin/ui/*` embedded React admin UI served by Axum.
- `/auth/*` Kratos session exchange and internal control-plane JWT endpoints.
- `/.well-known/jwks.json` public keys for internal JWT verification.

## Configuration

On first boot the service merges configuration in this order:
`CLI > environment > YAML > defaults`. When `DATABASE_URL` is configured, the
merged managed configuration is persisted to Postgres. Later boots load the
database row first, so database-managed settings win even if YAML or environment
values change.

Bootstrap-only inputs are `DATABASE_URL`, `THE_BOSS_CONFIG_FILE`,
`THE_BOSS_BIND_ADDR`, and `THE_BOSS_ADMIN_BOOTSTRAP_TOKEN`. The admin bootstrap
token is a break-glass path for initial setup only and is redacted from config
responses.

Database-managed settings include public/API/auth/CDN service URLs, JWT
audience and issuer, Kratos URLs and admin bearer token, inference backend,
model aliases, the upstream LLM base URL, and the LLM API key. `GET
/admin/config` returns redacted secrets with a `revision`. `PATCH
/admin/config` requires `admin:config:write` plus the current revision and
writes an audit row.

## Ory Kratos and Control-Plane JWTs

The Rust server talks to Kratos directly with `reqwest` and the Kratos REST API.
No generated Ory/Kratos SDK is used.

- `THE_BOSS_KRATOS_PUBLIC_URL` is used for `GET /sessions/whoami`.
- `THE_BOSS_KRATOS_ADMIN_URL` is used for identity and session administration.
- `THE_BOSS_KRATOS_ADMIN_BEARER_TOKEN` is forwarded only to admin REST calls.

Browser clients can present the Kratos session cookie. Native clients can
present `Authorization: Bearer <ory-session-token>`. The control plane validates
either form with Kratos `/sessions/whoami`, derives app claims from the returned
identity and session, and mints a short-lived internal JWT. Kratos identity
metadata controls `roles` and `scope`; absent metadata grants no admin access.

Internal JWTs are checked before falling back to Kratos session validation.
Configure `THE_BOSS_JWT_SIGNING_KEY_PEM` and `THE_BOSS_JWT_PUBLIC_KEY_PEM` to
enable RS256 signing. Without those keys, local development uses an HS256
fallback and `/.well-known/jwks.json` reports no public keys.

## OpenAI-Compatible Inference Backend

The control plane defaults to an offline stub backend for local development and
contract tests. Production deployments can route `/v1/chat/completions`,
`/v1/responses`, and `/v1/embeddings` through the Rust `liter-llm` client.

- `THE_BOSS_INFERENCE_BACKEND=stub|liter` selects the backend. Default: `stub`.
- `THE_BOSS_LLM_API_KEY` is required when `THE_BOSS_INFERENCE_BACKEND=liter`.
- `THE_BOSS_DEFAULT_CHAT_MODEL` maps the public `theboss-default` alias to an
  upstream `liter-llm` model ID. Default: `openai/gpt-4o-mini`.
- `THE_BOSS_DEFAULT_EMBEDDING_MODEL` maps the public `theboss-embedding` alias
  to an upstream `liter-llm` model ID. Default:
  `openai/text-embedding-3-small`.
- `THE_BOSS_LLM_BASE_URL` optionally overrides the upstream OpenAI-compatible
  base URL, primarily for integration tests or a private gateway.

Production deployment must still connect Ory JWT validation, persistence,
signing, and release artifact metadata before public use.
