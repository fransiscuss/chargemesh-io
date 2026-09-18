# ChargeMesh gateway runbook (Fly.io)

## 1. Fly app setup

The gateway runs as the Fly app `chargemesh-gw` (see `fly.toml` at the repo
root). It has two processes from one image: `gateway`
(`node apps/gateway/dist/main.js`) and `worker`
(`node apps/gateway/dist/worker.js`). One machine, auto-stop off, at least
one machine running.

```bash
# One-time: create the app (required before the first push-deploy succeeds;
# without it the deploy job fails — see F5 handoff outstanding items).
fly apps create chargemesh-gw

# Allocate IPv4/IPv6 if missing.
fly ips allocate-v4 --app chargemesh-gw
fly ips allocate-v6 --app chargemesh-gw

# Deploy (normally done by GitHub Actions on push to main).
fly deploy --remote-only --config fly.toml --app chargemesh-gw
```

Migrations run only as the `[deploy] release_command`
(`node packages/db/dist/migrate.js`). The dashboard (Vercel) never runs
migrations. Schema changes must stay backward-compatible across one deploy.

## 2. TLS certificates

```bash
fly certs add ocpp.chargemesh.io --app chargemesh-gw
fly certs add api.chargemesh.io --app chargemesh-gw
fly certs show ocpp.chargemesh.io --app chargemesh-gw
```

## 3. DNS (Cloudflare)

Create **DNS-only (grey cloud, no proxy)** A/AAAA records pointing at the
Fly IPs — proxying must stay off for `ocpp.` and `api.` to avoid Cloudflare
WebSocket timeouts and to keep mTLS possible later:

- `ocpp.chargemesh.io` → Fly IPv4 + IPv6
- `api.chargemesh.io` → Fly IPv4 + IPv6

Verify with `fly certs show <hostname>` until issuance completes.

## 4. Secrets

Runtime secrets live in `fly secrets` (never in the repo or handoffs).
`FLY_API_TOKEN` (a deploy token from
`fly tokens create deploy -a chargemesh-gw`) lives in GitHub Actions secrets.

```bash
fly secrets set DATABASE_URL="..." \
  CREDENTIALS_ENC_KEY="..." \
  INTERNAL_API_SECRET="..." \
  STREAM_TOKEN_SECRET="..." \
  DASHBOARD_ORIGIN="https://app.chargemesh.io" \
  ALLOW_INSECURE_WS="false" \
  RETENTION_DAYS="30" \
  LOG_LEVEL="info" \
  --app chargemesh-gw
# Optional: RESEND_API_KEY="..." (email alerts, from F11)
fly secrets list --app chargemesh-gw
```

All gateway env vars are parsed with zod at startup (`apps/gateway/src/env.ts`);
the app fails fast on missing or malformed values.

## 5. Smoke test

After a deploy, point the simulator at production:

```bash
pnpm sim --url wss://ocpp.chargemesh.io/ocpp/SMOKE01 --id SMOKE01 --version 1.6 --scenario full-session
```

Expect the full session to complete. A redeploy briefly disconnects chargers;
they reconnect and replay their queues (spec §6).

## 6. Rollback

```bash
# List releases and find the previous good version.
fly releases --app chargemesh-gw

# Roll back to a previous release image.
fly deploy --image <previous-image> --config fly.toml --app chargemesh-gw
```

If the bad deploy included a migration, the schema must still be compatible
with the previous image (dashboard rule above applies to rollbacks too).
