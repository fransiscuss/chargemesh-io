# Implementation status

## F0 — foundation

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

Docker is unavailable in this WSL environment, so the SteVe Compose stack has
not been launched. Its full-session validation belongs to F2.

Schema decisions:

- Malformed OCPP frames can store null parsed fields while retaining their raw text.
- Message connection IDs remain available after connection retention; no foreign
  key ties message lifetime to connection lifetime.
- Unknown-charger alerts allow a null charger ID.
- Bigint message IDs and sink cursors preserve values beyond JavaScript's safe
  integer range.
- Encrypted JSON configuration columns store a versioned ciphertext string.

## F1 — OCPP core library

Implemented the codec with raw-frame preservation, version negotiation,
version-specific errors, pending-call correlation, transaction/status helpers,
the empty adapter registry, and Ajv validation using unchanged vendored schemas.

- 90 total tests pass; OCPP line coverage is 100%.
- All request/response schemas compile, and required fixtures validate for both versions.
- Self-review covers raw passthrough versus rewritten serialization, immutable
  transaction rewrites, expiry boundaries, schema packaging, and schema attribution.
- Vendored files match the lockfile-pinned source byte-for-byte. The URI resolver
  supports its legacy schema IDs without editing those files.
- Commit, push, and CI confirmation are pending. F2 has not started.
