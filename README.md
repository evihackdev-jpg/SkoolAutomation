# Skool Automation

A community workspace with Accounts, Settings, Discover, Communities I Joined, Auto Mode, and Published Posts. Auto Mode supports exact-text or AI-refined posting, a target of 1–20 confirmed posts, or continuous timed posting until stopped. Publication receipts prevent duplicate sends; private workspaces isolate each registered user's accounts and runs.

## Project layout

- `frontend/`: standalone React/Vite application for Vercel, with its own package.json, lockfile and SPA/API rewrite configuration.
- `backend/`: standalone Node.js API and MongoDB workers for a VPS, with its own package.json, lockfile, secret environment file and service/proxy examples.
- `DEPLOYMENT.md`: complete VPS + Vercel setup, domain settings, authentication and existing-data considerations.

No backend code or secrets are needed to build the frontend. The backend has no runtime imports from the frontend. The browser uses `/api` on the frontend origin; Vercel forwards those requests to the HTTPS VPS API.

## Local development

Use Node.js 22.12+:

```sh
npm run setup
npm run build
npm run dev
```

The existing local credentials are preserved in `backend/.env`. Frontend: http://127.0.0.1:5173. Backend: http://127.0.0.1:3002. Root npm commands delegate to the independent packages. `npm install` at the root alone does not install child-package dependencies; use `npm run setup`.

For a fresh local backend, copy `backend/.env.example` to `backend/.env`, provide the MongoDB URI, persistent cookie encryption key and OpenRouter key, use `NODE_ENV=development`, clear the production origins, set `TRUST_PROXY=false`, and opt in to `LOCAL_OWNER_ENABLED=true` only on loopback if you want the local-owner workspace. Leave `LAN_HOST` empty unless deliberately configuring optional LAN hosting.

## Deploy separately

Run `npm run build` at the root to generate `frontend/dist/` and `backend/dist/`. Use `npm run build:frontend` or `npm run build:backend` to build only one package. Running `npm run build` inside `backend/` also builds the backend independently. Backend builds check runtime JavaScript syntax and produce a deployment folder without credentials, tests or node_modules.

Deploy `frontend/` to Vercel and the contents of `backend/dist/` to the VPS backend directory. Preserve the VPS `.env`, install production dependencies with `npm ci --omit=dev`, then restart the backend service. The built package runs with `npm start`. To run the build from a source checkout, use `npm run start:prod` inside `backend/`. The Vercel API rewrite points to `https://45.61.162.179`; configure exact HTTPS frontend/API origins and server credentials in `backend/.env`. VPS production requires login and forbids the local-owner shortcut. Follow [DEPLOYMENT.md](DEPLOYMENT.md) before starting the VPS service.

Keep one backend process per database. Stop the local backend before starting the VPS: durable jobs resume automatically, and workers currently have no distributed-instance lock. Never put MongoDB, cookie-encryption or OpenRouter credentials in the frontend. Preserve the cookie encryption key when moving existing saved accounts. Existing local-owner data remains private and is not assigned to a public registrant.

## Checks

```sh
npm test
npm run build
npm run db:check
```

Tests use in-memory data and temporary loopback HTTP servers. The read-only database diagnostic checks DNS, TCP, verified TLS, login and collection access without printing credentials. Tests do not join communities or publish posts.

Successful Auto Mode posts appear in Published Posts (`/published-posts`) with Cards/List views. The page reads confirmed publication receipts across all owned accounts, supports older pages, and retains entries after recent run history is cleared. Skool may later edit, moderate or remove a post.

Skool sessions are imported from the user's own cookies, encrypted in MongoDB, and never returned by the account API. Only auth_token and client_id are sent to fixed Skool hosts. Membership facts stay on the backend; only drafting context and question classification may go to OpenRouter. Pending approvals and actual platform permissions remain controlled by Skool.
