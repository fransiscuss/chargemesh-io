# Plan: write `docs/SPEC.md`, the ChargeMesh OCPP Proxy MVP technical spec

## Context
`chargemesh-io` is an empty greenfield repo. The user wants **one technical-spec file** that a build agent can use to build an OCPP proxy MVP **one feature at a time**. Every feature section has to stand alone: scope, dependencies, files, behaviour, **unit tests**, and a definition of done.

Decisions already made with the user:
- **Primary + mirrors** multi-CSMS model.
- **TypeScript/Node everywhere.**
- **Neon Postgres.**
- **<100 chargers**, so a single fly.io machine.
- **One hardcoded admin user** for the dashboard.
- **GitHub Actions push deploys to fly.io.**

**Action on approval:** write the content below (everything under "SPEC CONTENT") to `docs/SPEC.md`, verbatim. That is the only file created. Don't commit unless asked.

---
# SPEC CONTENT (→ `docs/SPEC.md`)

# ChargeMesh: OCPP Proxy MVP Technical Spec

## How to use this document (for the build agent)
- Build **one feature (F-number) at a time**, in the order in §4, unless told otherwise. Each feature lists what it depends on. Don't start a feature until its dependencies are done.
- Read §1–§3 (shared context) before any feature. Then read only the feature you're assigned.
- A feature is **done** when all of these hold:
  - Every item under its *Unit tests* list exists and passes.
  - Its *Done when* criteria are met.
  - `pnpm lint && pnpm typecheck && pnpm test` passes.
- Don't build anything listed in §5 (Non-goals). When the spec is ambiguous, choose the option that keeps the proxy transparent to the charger, and add the question to "Open questions" at the bottom of this file.

## 1. Product summary
ChargeMesh is an OCPP-J WebSocket proxy between EV chargers and OCPP servers (CSMS):
- **Primary + mirrors.** Each charger has exactly one **primary** CSMS. The primary's responses reach the charger, and it can send commands. A charger can also have N **mirror** CSMSs: they receive copies of the charger's traffic, but their responses are dropped and their commands are refused.
- **Record, inspect, alert.** Every frame is recorded, can be inspected, and triggers built-in alerts.
- **Consume.** Traffic can be read through REST, SSE and gRPC, and exported to Snowflake or a webhook.
- **Dashboard.** Chargers, CSMS endpoints, alerts, sinks and API keys are configured in a dashboard with a single admin login.
- **Extensibility seam.** An interceptor pipeline and an `Adapter` interface leave room for OCPP 1.6 ↔ 2.0.1 translation later (not built in the MVP).

Supported: OCPP **1.6J** and **2.0.1**, Security Profiles 1–2 (Basic auth, TLS at the edge). Scale: **<100 chargers**, one gateway machine.

## 2. Architecture

```
 Chargers ──wss://ocpp.chargemesh.io/ocpp/{id}──┐
                                                ▼
 ┌──────────────── fly.io app "chargemesh-gw" (1 machine, auto_stop OFF) ───────────────┐
 │ process "gateway"                                                                     │
 │  OCPP WS server :8080 /ocpp/*  → ChargerSession ─┬─ UpstreamLink(primary) → CSMS A    │
 │                                                  └─ UpstreamLink(mirror)  → CSMS B..N │
 │  Interceptor pipeline (txIdMapper, mirrorCallGuard | recorder, validator, alerts, bus)│
 │  In-proc EventBus → SSE/WS (:8080 /v1/stream) and gRPC (:50051 h2)                    │
 │  REST API (Fastify :8080 /v1/*), /internal/config/changed, /healthz                   │
 │ process "worker" (same image): Snowflake + webhook sinks, retention                   │
 └───────────────────────────────┬───────────────────────────────────────────────────────┘
                                 │ pg (pooled)
                           ┌─────▼─────┐   Drizzle   ┌───────────────────────────┐
                           │   Neon    │◄────────────│ Next.js dashboard, Vercel │ app.chargemesh.io
                           └───────────┘             └───────────────────────────┘
```

| Concern | Platform |
|---|---|
| Gateway + worker | fly.io, 1× shared-cpu-1x 512MB, `auto_stop_machines="off"`, `min_machines_running=1` |
| Dashboard | Vercel (Next.js App Router), Vercel Git integration |
| Database | Neon Postgres |
| DNS | Cloudflare, **DNS-only (grey cloud)** for `ocpp.` and `api.` (avoids CF WebSocket timeouts and keeps mTLS possible later) |
| CI/CD | GitHub Actions: CI on every push; **push deploy to Fly via flyctl** |

## 3. Shared foundations

### 3.1 Repo layout & stack
pnpm workspaces + Turborepo, TypeScript strict, ESM, Node 24 LTS.
```
apps/gateway     ws, fastify(+@fastify/swagger), @grpc/grpc-js, pino, drizzle(pg), ulid
apps/web         Next.js App Router, Tailwind, shadcn/ui, jose, drizzle(@neondatabase/serverless)
packages/ocpp    frame codec, types, ajv validation, correlation, Adapter interface, vendored OCA schemas
packages/db      drizzle schema + migrations + migrate script, crypto (AES-256-GCM), test DB helper
packages/proto   chargemesh/v1/traffic.proto + generated TS (buf + ts-proto)
packages/sim     charger simulator CLI + mock CSMS (test tooling)
packages/config  shared tsconfig/eslint/prettier
Dockerfile, fly.toml, docker-compose.yml (Postgres, SteVe 1.6 CSMS, mock-csms)
.github/workflows/ci.yml, .github/workflows/deploy-gateway.yml
```

### 3.2 Testing conventions (apply to every feature)
- **vitest**. Unit tests are co-located as `*.test.ts` next to the code. Integration tests live in `apps/gateway/test/integration/*.int.test.ts`.
- Unit tests must not touch the network or real DB. Use `vi.useFakeTimers()` for timeouts, backoff and cooldowns. Inject clocks and ID generators (`now()`, `ulid()`) through constructors.
- DB-backed tests use **PGlite** (`@electric-sql/pglite` + the drizzle pglite driver) with real migrations applied. The helper is `packages/db/test/createTestDb.ts`.
- Integration tests bind WebSocket servers to port 0 and use the `packages/sim` charger and mock CSMS in-process.
- Coverage thresholds (vitest v8): **≥85%** lines for `packages/ocpp` and `apps/gateway/src/{session,pipeline,alerts}`, and ≥70% elsewhere. CI enforces them.
- Fixtures: `packages/ocpp/test/fixtures/{1.6,2.0.1}/*.json` hold real-looking frames for each action used in tests.

### 3.3 Canonical event envelope (used by recorder, bus, REST, SSE, gRPC, sinks)
```ts
type OcppEvent = {
  id: string;             // ocpp_messages.id as string
  chargerIdentity: string;
  connectionId: string;   // ulid of the charger connection
  ts: string;             // ISO, gateway receive time
  source: 'charger' | 'upstream';
  upstreamId: string | null; upstreamRole: 'primary' | 'mirror' | null;
  msgType: 2 | 3 | 4; uniqueId: string; action: string | null;   // action resolved for 3/4
  payload: unknown; valid: boolean; errors: unknown[] | null;
  delivery: { forwardedTo: string[]; dropped?: string; rejected?: string; rewritten?: boolean; unmappedTx?: boolean };
  latencyMs: number | null;
};
```

### 3.4 Data model (`packages/db`, Drizzle). Single-tenant, no user tables.
- `upstreams`: id uuid, name, url (ws base), ocpp_version, auth_type `none|basic`, enc_secret, enabled, created_at
- `chargers`: id uuid, identity (unique), ocpp_version, auth_mode `passthrough|gateway`, password_hash, enabled, notes, connected bool, last_seen_at, created_at
- `charger_upstreams`: charger_id, upstream_id, role `primary|mirror`, identity_override, enc_password, enabled. **Partial unique index `(charger_id) WHERE role='primary'`.**
- `connections`: id ulid, charger_id, kind `charger|upstream`, upstream_id, opened_at, closed_at, close_code, close_reason, remote_ip, subprotocol
- `ocpp_messages`: id bigserial, charger_id, connection_id, ts, source, upstream_id, upstream_role, msg_type, unique_id, action, payload jsonb, raw text, delivery jsonb, valid, errors jsonb, latency_ms. Indexes: (charger_id, ts desc), (ts desc), (action, ts desc)
- `tx_id_map`: charger_id, upstream_id, primary_tx_id, mirror_tx_id, created_at. PK (charger_id, upstream_id, primary_tx_id)
- `alert_rules`, `alert_channels`, `alert_events`: see F11
- `sinks`: id, type `snowflake|webhook`, enc_config jsonb, enabled. `sink_cursors`: sink_id, last_message_id, last_run_at, last_rows, last_error
- `api_keys`: id, name, prefix, sha256_hash, last_used_at, revoked_at

### 3.5 Environment variables
- **Gateway/worker (`fly secrets`):** `DATABASE_URL`, `CREDENTIALS_ENC_KEY`, `INTERNAL_API_SECRET`, `STREAM_TOKEN_SECRET`, `DASHBOARD_ORIGIN`, `ALLOW_INSECURE_WS`, `RETENTION_DAYS`(30), `RESEND_API_KEY?`, `LOG_LEVEL`
- **Web (Vercel):** `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `CREDENTIALS_ENC_KEY`, `INTERNAL_API_SECRET`, `STREAM_TOKEN_SECRET`, `GATEWAY_URL`
- **GitHub Actions:** `FLY_API_TOKEN`
- All env is parsed with zod at startup (`src/env.ts` in each app). Startup fails fast if anything is missing.

## 4. Features (build order)

| # | Feature | Depends on |
|---|---|---|
| F0 | Foundation: monorepo, CI, DB schema, crypto | — |
| F1 | OCPP core library | F0 |
| F2 | Simulator & mock CSMS | F1 |
| F3 | Transparent proxy (primary only) | F1, F2 |
| F4 | Traffic recorder | F3 |
| F5 | Deploy & CI/CD (push to Fly) | F3 |
| F6 | Multi-CSMS mirrors | F4 |
| F7 | Config store & hot reload | F3 |
| F8 | Dashboard auth (single admin) | F0 |
| F9 | Dashboard config UI | F7, F8 |
| F10 | Traffic API: REST + SSE + API keys | F4 |
| F11 | Alerting | F4 |
| F12 | Traffic viewer UI | F9, F10 |
| F13 | gRPC streaming | F10 |
| F14 | Data sinks + retention (worker) | F4 |

---

### F0: Foundation
**Goal:** a scaffolded monorepo with a green CI and a migratable schema.
**Deliverables:**
- Workspace config, `packages/config`, and all §3.1 packages as empty shells.
- `ci.yml`: on PR and push, plus `workflow_call` so the deploy workflow can reuse it. Steps: pnpm install (cached) → lint → typecheck → test with coverage.
- `packages/db`: the full §3.4 schema, `drizzle-kit` migrations, `src/migrate.ts` (built to `dist/migrate.js`), `createTestDb()` (PGlite).
- `packages/db/src/crypto.ts`: `encrypt(plain, key) → "v1:<iv>:<tag>:<ct>"` (base64) and `decrypt`.
- `docker-compose.yml`: postgres:16, SteVe, and mock-csms (placeholder until F2).

**Unit tests:**
- `crypto.test.ts`:
  - round-trip encrypt/decrypt.
  - two encryptions of the same plaintext differ (random IV).
  - a tampered ciphertext or tag throws.
  - the wrong key throws.
  - a malformed or unknown version prefix throws.
- `schema.test.ts` (PGlite): migrations apply cleanly, and a second primary for the same charger violates the partial unique index. Two mirrors are allowed.
- `env.test.ts` (per app, when added): missing required vars throw a readable error.

**Done when:** `pnpm i && pnpm build && pnpm test` passes locally and in CI, and `pnpm db:migrate` works against a Neon dev branch.

---

### F1: OCPP core library (`packages/ocpp`)
**Goal:** pure, dependency-light OCPP-J primitives shared by the gateway, sim and web.

**Deliverables:**
- `frame.ts`: `parseFrame(raw: string): ParseResult` returns `{ok:true, frame}` or `{ok:false, error}`. Frames:
  - `Call{t:2,id,action,payload}`
  - `CallResult{t:3,id,payload}`
  - `CallError{t:4,id,code,description,details}`
  - `serializeFrame(frame)`
  - **Keep `raw` alongside the parsed form.** Passthrough forwarding sends the original string, byte-for-byte.
- `versions.ts`:
  - `OcppVersion = '1.6'|'2.0.1'`
  - subprotocol mapping (`ocpp1.6`, `ocpp2.0.1`)
  - `negotiateSubprotocol(offered: string[], configured: OcppVersion): string | null`
- `validate.ts`: `createValidator(version)` gives `validate(action, kind:'req'|'conf', payload) → {valid, errors}`, using ajv over vendored OCA JSON schemas in `schemas/1.6` and `schemas/2.0.1`. Reuse the MIT-licensed schema set from the `ocpp-rpc` package. Don't hand-write schemas.
- `correlation.ts`: `PendingCalls` class. Methods: `add(id, action, ts)`, `resolve(id) → {action, ts} | undefined`, `sweep(now, maxAgeMs)`. The clock is injected.
- `errors.ts`: `callError(id, code, description)` helper. Uses the code sets valid for each version (`NotSupported`, `InternalError`, `ProtocolError`, …).
- `adapter.ts`: `interface Adapter { from; to; translate(frame, ctx): OcppFrame | null }` plus an empty registry `getAdapter(from,to)`.
- `fields.ts`: helpers used later:
  - `getTransactionId(action, payload)`
  - `setTransactionId(action, payload, id)` (1.6: StopTransaction, MeterValues)
  - `isFaultStatus(version, action, payload)`

**Unit tests:**
- `frame.test.ts`:
  - parses valid 2/3/4 frames.
  - rejects non-JSON, non-array, unknown type id, wrong arity, non-string id, non-object payload.
  - `serializeFrame(parseFrame(x))` is semantically equal to x.
  - the raw string is preserved.
- `versions.test.ts`:
  - negotiation picks the configured version when offered.
  - returns null when it isn't offered.
  - falls back to the configured version when the offered list is empty.
- `validate.test.ts`:
  - the fixtures for BootNotification, Heartbeat, StatusNotification, StartTransaction, StopTransaction, MeterValues (1.6) and BootNotification, TransactionEvent (2.0.1) validate.
  - missing required fields and wrong enums fail with errors listed.
  - an unknown action returns `valid:false` with an `unknown_action` error, and doesn't throw.
- `correlation.test.ts`:
  - add/resolve round-trip.
  - an entry resolves only once.
  - `sweep` removes entries older than maxAge (fake clock).
- `fields.test.ts`:
  - get/set transactionId on StopTransaction and MeterValues.
  - no-op on actions without one.
  - `isFaultStatus` is true for 1.6 `status=Faulted` and for `errorCode≠NoError`, and false for `Available`/`NoError`.
  - 2.0.1 `connectorStatus=Faulted` → true.

**Done when:** everything is exported from `packages/ocpp/src/index.ts` and coverage is ≥85%.

---

### F2: Charger simulator & mock CSMS (`packages/sim`)
**Goal:** deterministic test doubles and a manual QA CLI.

**Deliverables:**
- `SimCharger` class: connects with the chosen subprotocol and Basic auth. It exposes `call(action, payload) → Promise<CallResult|CallError>`, `onCall(action, handler)`, and `close()`. It auto-answers CSMS calls using configured handlers, with defaults of Accepted.
- Scenarios:
  - `boot`
  - `full-session`. 1.6: Boot → Status → Authorize → StartTransaction → MeterValues×3 → StopTransaction. 2.0.1: Boot → StatusNotification → TransactionEvent Started/Updated/Ended.
- `MockCsms` class: a WebSocket server. It captures all frames, has configurable responses per action (including a custom `transactionId` for StartTransaction), and can `sendCall(identity, action, payload)`, `rejectAuth(identity)`, `dropConnection(identity)` and `setDelay(action, ms)`.
- CLI: `pnpm sim --url ws://… --id SIM001 --version 1.6 --password x --scenario full-session`.

**Unit tests:**
- `mockCsms.test.ts`:
  - accepts a connection and records frames.
  - returns the configured response.
  - `rejectAuth` returns 401 on upgrade.
- `simCharger.test.ts` (against MockCsms):
  - `full-session` completes for 1.6 and 2.0.1.
  - the charger answers a CSMS-initiated `RemoteStartTransaction` with Accepted.
  - `call()` rejects on timeout (fake timers).

**Done when:** the CLI runs a full session against SteVe from docker-compose.

---

### F3: Transparent proxy, primary only (`apps/gateway/src/session`)
**Goal:** a charger connected through the gateway behaves exactly as if it were connected directly to its primary CSMS.

**Behaviour:**
- **Route.** `GET /ocpp/:identity` upgrade. Identity is URL-decoded, trailing slash stripped, and matched case-sensitively.
  - Look up the charger through a `ConfigStore` interface. In F3 this is backed by the DB, with an in-memory implementation for tests; F7 upgrades it.
  - Unknown charger → 404. Disabled charger → 403.
- **Subprotocol** is chosen with `negotiateSubprotocol`. If there's no match → 400.
- **Auth modes:**
  - `passthrough` (default): before completing the charger upgrade, open the primary link at `{upstream.url}/{identity_override ?? identity}`. Use the same subprotocol and forward the charger's `Authorization` header. If the upstream returns 401 → reply 401. If it's unreachable or takes more than 10s → 502.
  - `gateway`: verify the Basic-auth password against the scrypt `password_hash`. Then connect upstream with the `enc_password`, or the upstream's `enc_secret`.
- **Lifecycle:** primary closes → close the charger with 1011. Charger closes → close upstream links with 1000. Ping every 30s on both legs. Terminate a leg after 2 missed pongs.
- **Routing:**
  - Charger CALL → primary, forwarded as the **raw string**.
  - Primary CALLRESULT/ERROR → charger.
  - Primary CALL → charger.
  - Charger CALLRESULT/ERROR → primary.
  - Track `PendingCalls` per direction and sweep every 60s (maxAge 120s).
  - Unparseable frames from the charger or primary are still forwarded and are flagged for the pipeline.
- **Pipeline** (`src/pipeline`): `Pipeline.run(ctx, frame)` runs the **sync** interceptors, which return `pass|rewrite|drop`. Then it forwards. Then it dispatches the **async** interceptors through `queueMicrotask`/setImmediate, so they never block forwarding. Async interceptor errors are caught and logged.
- `ALLOW_INSECURE_WS` controls whether plain `ws://` is accepted (the Fly `http` handler on :80).
- **Graceful shutdown (SIGTERM):**
  1. stop accepting
  2. close chargers with 1001
  3. await `pipeline.flush()`
  4. exit
- `GET /healthz` returns `{ok, chargersConnected}`.

**Unit tests:**
- `identity.test.ts`: URL-decoding, trailing-slash stripping, rejection of empty values or values containing `/`.
- `router.test.ts` (pure routing logic with fake legs):
  - each row of the routing table routes to the right leg.
  - the raw string is forwarded unchanged.
  - pending calls are tracked and resolved.
- `pipeline.test.ts`:
  - sync `drop` prevents forwarding.
  - `rewrite` forwards the rewritten serialization.
  - async interceptors run after forwarding (assert call order).
  - a throwing async interceptor doesn't affect forwarding.
  - `flush()` awaits pending async work.
- `auth.test.ts`:
  - `gateway` mode accepts the correct password and rejects wrong or missing ones.
  - Basic header parsing handles colons in passwords.

**Integration tests** (`proxy.int.test.ts`, SimCharger + MockCsms):
- 1.6 and 2.0.1 `full-session` pass through with identical payloads.
- A CSMS `RemoteStartTransaction` reaches the charger, and the response returns to the CSMS.
- Primary 401 → charger upgrade fails with 401.
- Primary unreachable → 502.
- Primary drop → charger socket closed with 1011.
- Unknown identity → 404.

**Done when:** the sim runs through the gateway to SteVe, and SteVe shows the transaction.

---

### F4: Traffic recorder
**Goal:** every frame the gateway receives is persisted exactly once and published as an `OcppEvent`.

**Behaviour:**
- **`recorder` async interceptor.** Builds an `OcppEvent`:
  - `action` for 3/4 comes from `PendingCalls`.
  - `latencyMs` = response ts − call ts.
  - `delivery` is filled from the routing outcome.
- **`validator` async interceptor.** Sets `valid` and `errors` before the record is written.
- **`BatchWriter`.** Buffers events and flushes every 1s or 200 rows with a multi-row insert.
  - The queue is bounded at 10k. On overflow, drop the oldest, increment the `recorder_dropped_total` counter, and log a warning.
  - Retries with backoff on DB errors.
- **`connections` rows** are written on open and close, for both charger and upstream legs. `chargers.connected` and `last_seen_at` are updated.
- **`EventBus` interface** (`publish`, `subscribe(filter, handler) → unsubscribe`) with an in-process implementation. The `busPublisher` interceptor publishes after the DB id is assigned. If that proves awkward, publish with a provisional ulid id and document the choice.

**Unit tests:**
- `eventBuilder.test.ts`:
  - CALL maps to the right action.
  - CALLRESULT gets its action and latency from pending.
  - an unmatched CALLRESULT gets `action=null`.
  - invalid frames get `valid=false` with errors.
- `batchWriter.test.ts` (fake timers, fake sink):
  - flushes at 200 rows.
  - flushes after 1s.
  - overflow drops the oldest and increments the counter.
  - retries after a failure.
  - `flush()` drains everything.
- `eventBus.test.ts`:
  - filters by charger and action.
  - unsubscribe stops delivery.
  - a slow or throwing subscriber doesn't block the others.
- `recorder.db.test.ts` (PGlite): the written rows round-trip into the `OcppEvent` shape.

**Integration:** after a `full-session`, the number of `ocpp_messages` rows equals the number of frames sent plus the number received, and each response row has an action and latency.

**Done when:** the recorded history of a SteVe session in Neon is complete and correct.

---

### F5: Deploy & CI/CD (push to Fly)
**Goal:** a merge to `main` deploys the gateway from GitHub Actions. No manual steps, and no Fly pull integration.

**Deliverables:**
- `Dockerfile`: multi-stage. `turbo prune gateway --docker` → pnpm install → build → a `node:24-slim` runtime running as a non-root user. One image serves both processes.
- `fly.toml`:
  - `[processes] gateway="node apps/gateway/dist/main.js"`, `worker="node apps/gateway/dist/worker.js"`
  - `[http_service]` on internal_port 8080 for the gateway, with `auto_stop_machines="off"`, `min_machines_running=1`, and an `/healthz` check
  - a `[[services]]` block on 50051 with `handlers=["tls"]` and `tls_options.alpn=["h2"]` (gRPC, used from F13)
  - `[deploy] release_command="node packages/db/dist/migrate.js"`. **Migrations run only here.**
- `.github/workflows/deploy-gateway.yml`:
  ```yaml
  name: deploy-gateway
  on:
    push: { branches: [main], paths: ['apps/gateway/**','packages/**','Dockerfile','fly.toml','pnpm-lock.yaml'] }
    workflow_dispatch: {}
  concurrency: { group: deploy-gateway, cancel-in-progress: false }
  jobs:
    test: { uses: ./.github/workflows/ci.yml }
    deploy:
      needs: test
      runs-on: ubuntu-latest
      environment: production
      steps:
        - uses: actions/checkout@v4
        - uses: superfly/flyctl-actions/setup-flyctl@<pinned-sha>
        - run: flyctl deploy --remote-only --config fly.toml --app chargemesh-gw
          env: { FLY_API_TOKEN: '${{ secrets.FLY_API_TOKEN }}' }
  ```
  `FLY_API_TOKEN` comes from `fly tokens create deploy -a chargemesh-gw`. Runtime secrets live in `fly secrets`.
- Dashboard: Vercel Git integration, with root `apps/web`. It never runs migrations. Schema changes must stay backward-compatible across one deploy.
- `docs/RUNBOOK.md`:
  - Fly app setup
  - `fly certs add ocpp.chargemesh.io` / `api.chargemesh.io`
  - Cloudflare DNS-only records
  - secrets
  - rollback (`fly releases`, `fly deploy --image <previous>`)

**Unit tests:** `apps/gateway/src/shutdown.test.ts`. On SIGTERM the handler stops accepting, closes sessions with 1001, awaits flush, then exits. The order is asserted with fakes.
**Checks:** CI runs `hadolint` on the Dockerfile and `actionlint` on the workflows.

**Done when:**
- A push to `main` deploys to Fly.
- The sim connects to `wss://ocpp.chargemesh.io/ocpp/SMOKE01`.
- A redeploy causes only a reconnect.

---

### F6: Multi-CSMS mirrors
**Goal:** the charger's traffic fans out to mirrors without the charger ever noticing the mirrors.

**Behaviour:**
- **Opening links.** After the charger is accepted, open every enabled mirror link in parallel. Credentials: `identity_override ?? identity`, then `enc_password`, then the upstream's `enc_secret`.
- **`MirrorQueue`.** Buffers up to 100 frames or 30s while the link is connecting. On overflow or expiry, drop the frames, count them, and set `delivery.dropped='mirror_unavailable'`.
- **Reconnect** uses exponential backoff with jitter (1s → 60s cap) while the charger is connected. A mirror failure never closes the charger.
- **Routing additions:**
  - Charger CALL → primary + all mirrors.
  - Mirror CALLRESULT/ERROR → record, feed `txIdMapper`, **drop** (`delivery.dropped='mirror_response'`).
  - Mirror CALL → **not forwarded**. Reply `[4,id,"NotSupported","chargemesh: mirror connection is read-only",{}]` and record `delivery.rejected='mirror_call'`.
- **`txIdMapper` (OCPP 1.6 only)**, a sync interceptor on the mirror outbound leg:
  - Correlate the `StartTransaction` uniqueId across the primary and mirror responses. Once both are known, upsert `tx_id_map`.
  - Rewrite `transactionId` in StopTransaction and MeterValues for each mirror. If there's no mapping, forward unchanged and set `unmappedTx=true`.
  - Keep an in-memory LRU cache backed by the DB.
- A mirror `BootNotification` answered with Pending or Rejected → the link state shows `boot_rejected` (for alerts). Keep forwarding anyway.

**Unit tests:**
- `mirrorQueue.test.ts`:
  - buffers while connecting and drains in order on open.
  - drops beyond 100 frames or after 30s (fake timers), with a count.
- `backoff.test.ts`: the delay sequence respects the 60s cap. Jitter stays within bounds (seeded RNG).
- `txIdMapper.test.ts`:
  - the primary response arriving first and the mirror first both produce the mapping.
  - StopTransaction and MeterValues get rewritten per mirror.
  - two mirrors get different ids.
  - no mapping → unchanged, flagged.
  - 2.0.1 frames pass untouched.
- `txIdMapper.db.test.ts` (PGlite): the mapping survives a mapper restart (cache cleared).
- `mirrorRouting.test.ts`:
  - mirror responses never reach the charger.
  - a mirror CALL gets `NotSupported` and the charger receives nothing.

**Integration** (`mirrors.int.test.ts`, 1 primary + 2 MockCsms mirrors, where the mirrors assign transactionIds 9001 and 7001 and the primary assigns 42):
- The charger only sees primary responses.
- Mirror A's StopTransaction carries 9001, and mirror B's carries 7001.
- Killing mirror A mid-session → the charger is unaffected, and A reconnects and resumes.
- Killing the primary → the charger is closed with 1011.

**Done when:** all of the above pass, and a manual run against SteVe (primary) + mock-csms (mirror) behaves the same way.

---

### F7: Config store & hot reload
**Goal:** configuration changes made in the dashboard take effect on live sessions.

**Behaviour:**
- `DbConfigStore` loads chargers, charger_upstreams and upstreams into memory at boot, decrypting secrets as needed. Lookups are sync from the cache.
- `POST /internal/config/changed {entity:'charger'|'upstream', id}`, protected by the `INTERNAL_API_SECRET` bearer token. It reloads that entity and **reconciles** the live sessions:
  - mirror added → open it
  - mirror removed or disabled → close it
  - primary changed, charger disabled, or charger's auth mode changed → close the charger with 1012
  - upstream URL or credentials changed → reconnect the affected links. For a primary, that means closing the charger with 1012.
- Safety net: a full reload every 60s, followed by reconciliation.

**Unit tests:**
- `reconcile.test.ts` (pure `diff(oldCfg,newCfg) → actions[]`): one case for each bullet above, plus "no change → no actions".
- `configStore.db.test.ts` (PGlite): loads and decrypts. Disabled links are excluded.
- `internalRoute.test.ts` (fastify inject): 401 without the secret. 200 triggers a reload of the right entity.

**Done when:** adding a mirror in the DB and calling the endpoint makes the mirror start receiving frames without the charger reconnecting.

---

### F8: Dashboard auth (single hardcoded admin)
**Goal:** a minimal, replaceable login for one admin.

**Behaviour:**
- Env: `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH` (scrypt `scrypt$N$r$p$salt$hash`). The script `pnpm --filter web hash-password` generates the hash.
- `/login` Server Action: constant-time compare → set cookie `cm_session` (HS256 JWT signed with `SESSION_SECRET`, 7-day expiry; HttpOnly, Secure, SameSite=Lax).
- `middleware.ts`: every route except `/login`, `/_next/*` and static assets requires a valid session. Otherwise redirect to `/login?next=…`.
- Logout clears the cookie.
- Basic login rate limit: 10 attempts per IP per 15 min, in memory (acceptable for the MVP).
- Everything lives in `apps/web/lib/auth.ts` (`verifyCredentials`, `createSession`, `readSession`), so a real provider can replace it later.

**Unit tests** (`auth.test.ts`):
- The correct username and password verify. A wrong password, a wrong username, or an empty value fail.
- A malformed hash string fails and doesn't throw.
- `createSession` → `readSession` round-trips. Expired or tampered tokens → null.
- `hashPassword` → `verifyCredentials` round-trips.
- Rate limiter: blocks the 11th attempt and resets after the window (fake timers).
- `middleware.test.ts`: redirects without a cookie, passes with a valid one, and allows `/login`.

**Done when:** the dashboard on Vercel is reachable only after logging in.

---

### F9: Dashboard config UI
**Goal:** manage CSMS endpoints and chargers.

**Behaviour:**
- **CSMS Endpoints:** list, create, edit and disable.
  - Fields: name, URL, version, auth type, default secret (encrypted on save, never displayed again).
  - **"Test connection"** calls the gateway's `POST /internal/upstreams/test`. The gateway opens a WS to `url/{testIdentity}` and reports the handshake result: status, subprotocol, error.
- **Chargers:** list with connection status, plus create/edit.
  - Fields: identity, version, auth mode, gateway password (if gateway mode), primary (required), mirrors (multi, each with an identity override and password).
  - The page shows the connection URL to configure on the charger: `wss://ocpp.chargemesh.io/ocpp/{identity}`.
- **Validation (zod, shared with the server):**
  - identity must match `^[A-Za-z0-9._:-]{1,48}$`
  - exactly one primary
  - no upstream used twice
  - an upstream version different from the charger version is refused ("protocol translation not available", since `getAdapter` returns null)
- Every mutation → DB write → `POST /internal/config/changed`. If that call fails, show a non-blocking warning ("applies within 60s").

**Unit tests:**
- `schemas.test.ts`:
  - identity regex.
  - one primary exactly.
  - duplicate upstreams rejected.
  - a version mismatch is rejected.
  - secrets are optional on edit (keep the existing value).
- `actions.test.ts` (PGlite + mocked fetch):
  - create/update writes the rows and encrypts secrets.
  - the notify endpoint is called with the right entity and id.
  - a notify failure still persists and returns the warning.
- `upstreamTest.test.ts` (gateway, MockCsms): the handshake result is reported for success, a 401, and an unreachable host.

**Done when:** an admin can configure a charger with a primary and a mirror, and the sim connects using the displayed URL.

---

### F10: Traffic API (REST + SSE + API keys)
**Goal:** programmatic access to traffic history and a live stream.

**Behaviour** (gateway, `api.chargemesh.io`):
- **API keys.** Created and revoked in the dashboard (Settings → API keys). The full key `cm_live_<32 random>` is shown once, and only its SHA-256 hash is stored. The Fastify auth hook accepts:
  - `Authorization: Bearer cm_live_…`, or
  - a dashboard stream JWT (HS256, `STREAM_TOKEN_SECRET`, 5-min expiry, minted by `apps/web/app/api/stream-token`), passed as `?token=` for SSE.
- **Endpoints** (OpenAPI served at `/v1/openapi.json`):
  - `GET /v1/chargers`, `GET /v1/chargers/:identity`: config plus live status and link states.
  - `GET /v1/messages?charger&action&source&msgType&from&to&cursor&limit(≤500)`: keyset pagination on `id desc`, returning `{items: OcppEvent[], nextCursor}`.
  - `GET /v1/alerts?status`: added once F11 lands.
  - `GET /v1/stream?charger&action`: **SSE** with `event: ocpp` and a `data: OcppEvent` payload, plus a 15s heartbeat comment. Subscribes to the EventBus and unsubscribes on disconnect.
- CORS allows only `DASHBOARD_ORIGIN`.

**Unit tests:**
- `apiKey.test.ts`: the generate → hash → verify flow works. A revoked key → 401. A wrong prefix → 401. `last_used_at` gets updated.
- `streamToken.test.ts`: valid → ok. Expired or wrong secret → 401.
- `messagesRoute.test.ts` (fastify inject + PGlite seeded with 1,200 rows):
  - the filters work.
  - pagination is stable, with no duplicates or gaps across pages.
  - `limit` is capped.
  - the output matches the `OcppEvent` shape.
- `sse.test.ts` (inject + fake bus):
  - receives the filtered events.
  - sends the heartbeat (fake timers).
  - unsubscribes on client close (no leaked subscribers).

**Done when:** `curl -N -H "Authorization: Bearer …" https://api.chargemesh.io/v1/stream` shows live frames while the sim runs.

---

### F11: Alerting
**Goal:** built-in rules that notify Slack, a webhook or email, with open/resolve state.

**Data:**
- `alert_rules`: id, name, type, params jsonb, scope (`all` or charger_ids[]), channel_ids[], cooldown_s, enabled
- `alert_channels`: id, type `slack|webhook|email`, enc_config
- `alert_events`: id, rule_id, charger_id, upstream_id, status `open|resolved`, opened_at, resolved_at, last_notified_at, summary, context jsonb

**Rule types** (each is a pure evaluator: `(state, event|tick) → Open|Resolve|None`):
| type | params | fires when | auto-resolve |
|---|---|---|---|
| `charger_offline` | minutes | disconnected for more than N min | on reconnect |
| `upstream_down` | minutes, role? | link down for more than N min | on link up |
| `connector_faulted` | — | `isFaultStatus` | on a later non-fault status for the same connector |
| `boot_rejected` | — | a Boot conf with Rejected/Pending (any link) | on Accepted |
| `call_error` | codes? | any CALLERROR, optionally filtered by code | no (one-shot) |
| `response_timeout` | seconds | a CALL unanswered for more than N s | no |
| `schema_invalid` | — | `valid=false` | no |
| `unknown_charger` | — | upgrade rejected with 404 | no |
| `auth_rotation_seen` | — | ChangeConfiguration `AuthorizationKey` / SetVariables `BasicAuthPassword` | no |
| `custom_match` | action, path, op (`eq|neq|contains|gt|lt`), value | the payload matches (dot-path) | no |

**Engine:**
- Async interceptor plus a 15s tick for time-based rules.
- Dedup key: (rule, charger, upstream).
- The cooldown suppresses re-notification while an event is open.
- Timers are rebuilt from `connections`/`chargers` state on boot.

**Notifiers:**
- Slack: incoming webhook, block text.
- Webhook: JSON with `X-ChargeMesh-Signature: sha256=<hmac>`, 3 retries with backoff.
- Email: via Resend, only when `RESEND_API_KEY` is set.

**UI:** rules CRUD, channels CRUD with "send test", and an events list with a manual resolve.

**Unit tests:**
- `rules/*.test.ts`: one file per rule type. Each covers fire, no-fire, and auto-resolve where applicable (fake timers for the time-based ones). `custom_match` covers every op and missing paths.
- `engine.test.ts`:
  - dedup (a second fire while open → no new event).
  - cooldown suppresses notifications and allows them after the window.
  - scope filtering.
  - timers are restored from state on boot.
- `notifiers.test.ts` (mocked fetch):
  - the Slack payload shape.
  - the webhook HMAC is correct and verifiable.
  - retries on 5xx, and no retry on 4xx.
  - email is skipped without an API key.
- `alerts.db.test.ts` (PGlite): the event open → resolve lifecycle persists.

**Done when:** killing the sim fires `charger_offline` (N=1) to a Slack test channel, and reconnecting resolves it.

---

### F12: Traffic viewer UI
**Goal:** inspect traffic in the dashboard.

**Behaviour:**
- **Overview page:** connected chargers, upstream link health, open alerts, messages per minute (last hour).
- **Charger detail:**
  - live tail over SSE (pause/resume, filter by action/source, capped at 500 rows in memory)
  - a history table backed by `/v1/messages` with infinite scroll
  - a frame drawer: JSON viewer, the paired CALL↔RESULT with latency, delivery badges (forwarded / dropped / rejected / rewritten)
  - connection history
  - a tx-id map table

**Unit tests:**
- `pairFrames.test.ts`: pairs by uniqueId and link. Unpaired frames are shown as pending. Latency is computed.
- `liveBuffer.test.ts`: the cap of 500 evicts the oldest. Pause buffers and resume flushes. Filters apply.
- `deliveryBadge.test.tsx` (Testing Library): each delivery variant renders the right label.
- `useEventStream.test.ts`: reconnects after an error with backoff and refreshes an expired token.

**Done when:** you can watch a live sim session and find a past StopTransaction with its response.

---

### F13: gRPC streaming
**Goal:** a gRPC live stream and history for backend consumers.

**Proto** (`packages/proto/chargemesh/v1/traffic.proto`):
```proto
service TrafficService {
  rpc Subscribe(SubscribeRequest) returns (stream OcppEvent);
  rpc ListMessages(ListMessagesRequest) returns (ListMessagesResponse);
}
message SubscribeRequest { repeated string charger_identities = 1; repeated string actions = 2; }
message OcppEvent { string id=1; string charger_identity=2; google.protobuf.Timestamp ts=3; string source=4;
  string upstream_id=5; string upstream_role=6; int32 msg_type=7; string unique_id=8; string action=9;
  string payload_json=10; bool valid=11; string delivery_json=12; string connection_id=13; int32 latency_ms=14; }
message ListMessagesRequest { string charger_identity=1; string action=2; string cursor=3; int32 limit=4; }
message ListMessagesResponse { repeated OcppEvent items=1; string next_cursor=2; }
```

**Behaviour:**
- The server runs on :50051 (h2c behind Fly TLS).
- Auth: an API key in the `authorization` metadata. Invalid → `UNAUTHENTICATED`.
- `Subscribe` uses the EventBus. Cancel or client disconnect → unsubscribe.
- `ListMessages` reuses the F10 query service. **Don't duplicate the SQL.**

**Unit tests:**
- `mapper.test.ts`: `OcppEvent` ↔ proto round-trips, including nulls, JSON payloads and timestamps.
- `grpcServer.test.ts` (in-process server + client on an ephemeral port):
  - an invalid key → UNAUTHENTICATED.
  - Subscribe receives the filtered events published on a fake bus.
  - client cancel → the subscriber is removed.
  - ListMessages paginates through PGlite.

**Done when:** `grpcurl -H 'authorization: Bearer …' api.chargemesh.io:50051 chargemesh.v1.TrafficService/Subscribe` streams live events.

---

### F14: Data sinks + retention (worker process)
**Goal:** export traffic to Snowflake or a webhook, and keep Neon small.

**Behaviour** (`apps/gateway/src/worker.ts`, fly process `worker`):
- **Scheduler:** each enabled sink runs every 5 min, with no overlap per sink (in-process lock plus the DB `sink_cursors` row).
- **Batching:** read `ocpp_messages WHERE id > cursor ORDER BY id LIMIT 50000` → map to `OcppEvent` NDJSON.
- **Snowflake sink** (`snowflake-sdk`, key-pair auth, config: account, user, private key, role, warehouse, database, schema, table):
  1. write gzip to a temp file named `ocpp_{sinkId}_{fromId}_{toId}.ndjson.gz`
  2. `PUT file://… @CHARGEMESH_STAGE AUTO_COMPRESS=FALSE`
  3. `COPY INTO <table> FROM @CHARGEMESH_STAGE FILES=('…') FILE_FORMAT=(TYPE=JSON) MATCH_BY_COLUMN_NAME=CASE_INSENSITIVE`
  4. advance the cursor **only after the COPY succeeds**

  The deterministic file names plus Snowflake's load metadata make retries idempotent. `docs/snowflake-setup.sql` ships the role, warehouse, stage and table DDL.
- **Webhook sink:** POST the JSON array in chunks of 1,000, HMAC-signed, 3 retries. The cursor advances per successful chunk.
- Sink status (last run, rows, error) is written to `sink_cursors` and shown in the dashboard's Sinks page. The page has create/edit forms with encrypted config and a "Run now" button that calls `POST /internal/sinks/:id/run`.
- **Retention:** nightly, delete `ocpp_messages` and `connections` older than `RETENTION_DAYS`, in batches of 10k. The 1.6 mapping table must survive the message retention window, so delete `tx_id_map` rows only when they're older than 90 days.

**Unit tests:**
- `batchReader.test.ts` (PGlite): respects the cursor and limit, and returns an empty batch when there's nothing new.
- `snowflakeSink.test.ts` (mock the snowflake-sdk connection):
  - issues PUT then COPY with the deterministic file name.
  - a COPY failure → the cursor doesn't move.
  - a retry reuses the same file name.
  - the temp file is cleaned up.
- `webhookSink.test.ts` (mocked fetch):
  - chunking.
  - the signature.
  - a partial failure advances the cursor only through the last successful chunk.
- `scheduler.test.ts` (fake timers): no overlapping runs per sink, and a disabled sink is skipped.
- `retention.test.ts` (PGlite): deletes only old rows, in batches. `tx_id_map` follows its own 90-day rule.

**Done when:**
- Rows land in a Snowflake trial table.
- A forced COPY retry creates no duplicates.
- The webhook sink delivers signed batches to a request bin.

---

## 5. Non-goals (MVP)
- Multiple users, roles or multi-tenancy (single hardcoded admin).
- OCPP 1.6↔2.0.1 translation (only the `Adapter` hook exists).
- Security Profile 3 (mTLS).
- Injecting commands from the dashboard or API.
- Multi-machine, multi-region or HA. The EventBus and ConfigStore are interfaces so they can be swapped later.
- OCPP 2.1 and 1.5 SOAP.
- Billing.
- A cold archive on R2.

## 6. Known risks & gotchas
- Fly `auto_stop_machines` must be **off**, or idle sockets get killed.
- Cloudflare must be DNS-only for `ocpp.` and `api.`.
- Some older chargers don't trust the Let's Encrypt ISRG root or lack SNI. `ALLOW_INSECURE_WS` exists for lab use only.
- Some 1.6 chargers omit `Sec-WebSocket-Protocol`. Fall back to the configured version.
- Neon compute stays awake because the gateway writes continuously. Budget for a paid plan.
- A single machine means deploys briefly disconnect chargers. That's acceptable; they reconnect and replay their queues.
- Firmware and diagnostics URLs point at CSMS servers directly and aren't proxied.
- Mirrors may reject Boot or Authorize. That's informational only and never affects the charger.

## 7. Open questions
_(The agent appends questions here instead of guessing.)_

- F0: The recorder must retain malformed frames, but the canonical event envelope
  requires `msgType` and `uniqueId`. The schema allows these parsed fields to be
  null while retaining `raw`; the external representation needs resolving in F4.
- F0: Connection retention must not delete messages still inside their retention
  window. `ocpp_messages.connection_id` retains the ULID without a foreign key,
  allowing independent batched retention of connections and messages.
- F0: `unknown_charger` alerts cannot reference a registered charger row.
  `alert_events.charger_id` is nullable; the unknown identity can live in context.

---
# END SPEC CONTENT

## Verification of this plan's output
- `docs/SPEC.md` exists and is the only new file.
- Every feature F0–F14 has these sections: Goal, Depends on (via the table), Behaviour/Deliverables, Unit tests, Done when.
