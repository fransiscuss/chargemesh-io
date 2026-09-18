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
- CI confirmation is pending the F0 push. No later feature has been started.

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
