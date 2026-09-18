# ChargeMesh

OCPP proxy MVP, implemented sequentially from [the specification](docs/spec.md).

## Development

Requires Node.js 24 and pnpm 10.14.0 (`corepack enable`).

```sh
pnpm install
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

Tests use Vitest with enforced coverage. Database tests apply the committed SQL
migrations to isolated in-memory PGlite databases; they need no external services.
CI additionally applies the compiled migration runner twice to Postgres 16.

The gateway, web, OCPP, proto and simulator workspaces are initially empty shells.
Runtime environment parsing is added with each app's implementation.

## Database

Create a local `.env` from `.env.example` and set `DATABASE_URL` to your Neon
development branch, or start local Postgres with `docker compose up -d postgres`.
Keep Neon's SSL parameters in the URL. `.env` is ignored by Git.

```sh
pnpm db:generate  # after editing packages/db/src/schema.ts; review the generated SQL
pnpm db:migrate   # builds and executes packages/db/dist/migrate.js
```

The runner loads the root `.env`, applies committed migrations, and closes its
pool. It can be rerun safely. Migrations are resolved relative to the runner;
ship `packages/db/migrations` alongside `packages/db/dist` when deploying.

Credential encryption accepts a 32-byte Buffer or a canonical base64 encoded
32-byte key. Encrypted configuration JSON columns hold an encrypted string,
never the plaintext object. Retain the encryption key when deploying new versions.

## Local OCPP QA

`docker compose --profile qa up -d steve` builds the pinned official SteVe 3.8.0
release and starts its MariaDB dependency. Its UI is at
`http://localhost:8180/steve` and OCPP 1.6 endpoint at
`ws://localhost:8180/steve/websocket/CentralSystemService/{identity}`.
SteVe requires MariaDB; ChargeMesh uses Postgres independently. Local services
bind only to loopback. The mock CSMS Compose entry is a placeholder until F2.

## Feature gate

Complete, test, review, commit and push each feature before starting the next.
Record validation and any outstanding external checks in
[implementation status](docs/implementation-status.md).
