# Skool Automation backend

Standalone Node.js/MongoDB API and durable automation workers. Upload this folder to the VPS; it has its own package.json and lockfile and does not import frontend files.

```sh
npm ci --omit=dev
cp .env.example .env
# Edit .env with your VPS domains and server credentials.
npm run db:check
npm start
```

Use Node.js 22.12+ and an HTTPS reverse proxy to `127.0.0.1:3002`. Production requires `NODE_ENV=production`, `API_PUBLIC_ORIGIN`, and exact `FRONTEND_ORIGINS`; local-owner access and LAN hosting must be disabled. `.env.example` is a production template. Preserve the original cookie encryption key if connecting to an existing database.

Set `REGISTRATION_CODE` in the backend `.env` to the shared code required by the Create Account form. Registration checks the exact, case-sensitive value on the server before saving a user or session. Missing or incorrect codes are rejected; leaving the environment setting empty disables new registrations. Existing users can still sign in without a registration code. Keep the configured value out of frontend environment variables and public build files, and restart the service after changing it.

`deploy/Caddyfile` and `deploy/skool-backend.service` provide an HTTPS reverse proxy and a persistent Linux systemd service. The worker stays on the VPS, so Auto Mode continues when a frontend visitor closes their browser. Use one backend process per database: the current worker scheduler has no distributed-process lease.

To create a production deployment folder, run `npm run build` in this directory. The build checks runtime JavaScript syntax and writes `dist/` with the server modules, package manifests, database diagnostic, environment template and deployment configuration. It excludes tests, dependencies, secrets and local certificates. Upload the contents of `dist/` into the VPS backend directory, preserve its existing `.env`, run `npm ci --omit=dev`, then restart `skool-backend`. On first deployment, create `.env` from `.env.example` and configure it before starting.

To run the built code from the source checkout, use `npm run start:prod`; this reads `.env` from the backend directory. When deploying only the contents of `dist/`, use `npm start`. The generated package has the same `server/index.mjs` entry point as the source deployment, so the systemd service path stays valid. From the repository root, `npm run build` builds both packages; `npm run build:backend` builds only this backend and `npm run build:frontend` builds only the UI.

`GET /api/health` checks that the HTTP process is alive without querying MongoDB. `npm run db:check` checks verified TLS, authentication and collection read access without printing credentials or modifying records. All account/settings/automation/publication endpoints require a private workspace session in production.

For local-only development, use `NODE_ENV=development`, clear `API_PUBLIC_ORIGIN` and `FRONTEND_ORIGINS`, set `TRUST_PROXY=false`, and optionally opt in to `LOCAL_OWNER_ENABLED=true` while binding to `127.0.0.1`. Keep `LAN_HOST` blank unless deliberately configuring local network hosting. Optional LAN hosting reads `LAN_STATIC_DIR` (default `public`); the parent local project uses `../frontend/dist`.

Never upload `.env`, `.local`, node_modules or saved cookies to the frontend host or source control. Full deployment instructions are in the parent `DEPLOYMENT.md`.
