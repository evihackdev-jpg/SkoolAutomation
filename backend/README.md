# Skool Automation backend

Standalone Node.js/MongoDB API and durable automation workers. Upload this folder to the VPS; it has its own package.json and lockfile and does not import frontend files.

```sh
npm ci --omit=dev
cp .env.example .env
# Edit .env with your VPS domains and server credentials.
npm run db:check
npm start
```

Use Node.js 22.12+ and an HTTPS reverse proxy to `127.0.0.1:3001`. Production requires `NODE_ENV=production`, `API_PUBLIC_ORIGIN`, and exact `FRONTEND_ORIGINS`; local-owner access and LAN hosting must be disabled. `.env.example` is a production template. Preserve the original cookie encryption key if connecting to an existing database.

`deploy/Caddyfile` and `deploy/skool-backend.service` provide an HTTPS reverse proxy and a persistent Linux systemd service. The worker stays on the VPS, so Auto Mode continues when a frontend visitor closes their browser. Use one backend process per database: the current worker scheduler has no distributed-process lease.

`GET /api/health` checks that the HTTP process is alive without querying MongoDB. `npm run db:check` checks verified TLS, authentication and collection read access without printing credentials or modifying records. All account/settings/automation/publication endpoints require a private workspace session in production.

For local-only development, use `NODE_ENV=development`, clear `API_PUBLIC_ORIGIN` and `FRONTEND_ORIGINS`, set `TRUST_PROXY=false`, and optionally opt in to `LOCAL_OWNER_ENABLED=true` while binding to `127.0.0.1`. Keep `LAN_HOST` blank unless deliberately configuring local network hosting. Optional LAN hosting reads `LAN_STATIC_DIR` (default `public`); the parent local project uses `../frontend/dist`.

Never upload `.env`, `.local`, node_modules or saved cookies to the frontend host or source control. Full deployment instructions are in the parent `DEPLOYMENT.md`.
