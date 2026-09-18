# Implementation status

## F0 — foundation

[Handoff](handoffs/F0.md)

Implemented workspace shells, shared tooling, CI, the full database schema,
generated migrations, PGlite test support, and versioned AES-256-GCM encryption.

Local validation and self-review completed:

- Frozen install, lint, typecheck and build passed.
- 29 tests passed; 96% line coverage (crypto and schema: 100%).
- Production migrations applied to the supplied Neon development database twice.
- Reviewed generated SQL, constraints, encryption authentication and key handling,
  migration cleanup, secret exclusion, and test independence. Corrected bigint
  and JSON default generation issues before applying the initial migration.
- Committed and pushed as `e6a1c3d`; [CI passed](https://github.com/fransiscuss/chargemesh-io/actions/runs/35301531300)
  before F1 began.

Docker was unavailable during F0. F2 subsequently validated the Compose stack
using Docker Desktop's Linux engine through the Windows CLI.

Schema decisions:

- Malformed OCPP frames can store null parsed fields while retaining their raw text.
- Message connection IDs remain available after connection retention; no foreign
  key ties message lifetime to connection lifetime.
- Unknown-charger alerts allow a null charger ID.
- Bigint message IDs and sink cursors preserve values beyond JavaScript's safe
  integer range.
- Encrypted JSON configuration columns store a versioned ciphertext string.

## F1 — OCPP core library

[Handoff](handoffs/F1.md)

Implemented the codec with raw-frame preservation, version negotiation,
version-specific errors, pending-call correlation, transaction/status helpers,
the empty adapter registry, and Ajv validation using unchanged vendored schemas.

- 90 total tests pass; OCPP line coverage is 100%.
- All request/response schemas compile, and required fixtures validate for both versions.
- Self-review covers raw passthrough versus rewritten serialization, immutable
  transaction rewrites, expiry boundaries, schema packaging, and schema attribution.
- Vendored files match the lockfile-pinned source byte-for-byte. The URI resolver
  supports its legacy schema IDs without editing those files.
- Committed and pushed as `409ca4d`; [CI passed](https://github.com/fransiscuss/chargemesh-io/actions/runs/35302178269)
  before F2 began. Built ESM import and validation also passed.

## F2 — simulator and mock CSMS

[Handoff](handoffs/F2.md)

Implemented both protocol scenarios, the simulator and mock CLIs, configurable
responses and delays, authentication rejection, server-initiated calls, frame
capture, and deterministic clocks/IDs. The Compose mock placeholder is replaced.

- 110 tests pass; simulator line coverage is 93.73%.
- Both full-session scenarios validate against the OCA schemas.
- Review covers pending-call cleanup, rejected upgrades, handler failures,
  non-mutating fixtures, CLI cleanup, and use of returned transaction IDs.
- Both native CLI scenarios passed against the mock; the Docker-built mock
  additionally passed a full 2.0.1 CLI session.
- `scripts/steve-smoke.sh` passed against Compose SteVe 3.8.0: all eight 1.6
  calls completed and a new `transaction_stop` row was persisted.
- Lint, typecheck, build, Compose configuration validation and code review passed.
- Committed and pushed as `61a5113`; [CI passed](https://github.com/fransiscuss/chargemesh-io/actions/runs/35304340190)
  before F3 began.

## F3 — transparent primary proxy

[Handoff](handoffs/F3.md)

Implemented primary-only forwarding, both authentication modes, database-backed
configuration, version negotiation, heartbeat/correlation cleanup, the interceptor
pipeline, startup environment validation, health reporting, and graceful shutdown.

- 165 tests passed; session line coverage 98.32%, pipeline 100%, overall 96.35%.
- The simulator completed eight calls through the gateway into Compose SteVe;
  the smoke script verified a new completed transaction in SteVe's database.
- Lint, build and typecheck passed. Review covered raw frame preservation, authentication,
  early upstream traffic, upgrade cancellation, socket cleanup, and proxy trust.
- Committed and pushed as `7519c13`; [CI passed](https://github.com/fransiscuss/chargemesh-io/actions/runs/35305298759).
- Handoff is complete. Next: F4, implemented under primary-agent orchestration.

## F4 — traffic recorder

[Handoff](handoffs/F4.md)

Implemented the async validator/recorder/busPublisher interceptor chain, the
bounded batch writer with backoff retries, the in-process event bus, connection
open/close tracking with charger presence, and production wiring with
recorder-aware shutdown flush.

- 182 tests pass (165 pre-existing + 17 new); recorder line coverage 97.08%,
  session 98.32%, pipeline 100%.
- MockCsms full-session integration: 16 `ocpp_messages` rows for 16 frames with
  exact raws, all valid, every response carrying action and latency; bus
  published all 16 with DB ids; both connection legs closed; charger presence
  true → false.
- SteVe + Neon gate met via a removed one-off script: 16/16 valid rows, 8/8
  responses with action and latency, 2 closed connections; all QA rows cleaned
  up afterwards.
- Malformed frames settle the spec open question: nullable msgType/uniqueId/
  action with retained raw and `valid=false`. Bus publishes after the DB id is
  assigned (no provisional ulid).
- Lint, build and typecheck passed. Review covered correlation single-sourcing,
  interceptor ordering, overflow accounting, shutdown flush, best-effort
  tracking, and F3 preservation; fixed a duplicated test assertion and the
  upstream leg's `remote_ip`.
- Committed and pushed as `6e5d4ed`; [CI passed](https://github.com/fransiscuss/chargemesh-io/actions/runs/35307282237).
- Handoff is complete. Next: F5, implemented by sub-agent under primary-agent orchestration.
