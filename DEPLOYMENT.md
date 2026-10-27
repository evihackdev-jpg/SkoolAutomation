# Vercel frontend + VPS backend

## Netlify frontend alternative

Netlify can host the same frontend instead of Vercel; the backend stays on the VPS. Edit `frontend/public/_redirects` to point `/api/*` to your real HTTPS VPS API, retaining `/api/:splat` in the destination and keeping that rule before `/* /index.html 200`.

For manual deployment, build with `npm run build` and upload the contents of `frontend/dist`, or extract `artifacts/frontend-netlify.zip` and upload that folder. The ZIP contains the compiled site rather than Node source or dependencies. Replace the example domain in its root `_redirects` before uploading. Source-controlled Netlify deployments use base directory `frontend`, build command `npm run build`, and publish directory `dist`; `frontend/netlify.toml` supplies the build settings.

After Netlify assigns the frontend URL, set the backend's `FRONTEND_ORIGINS` to the exact `https://YOUR_SITE.netlify.app` origin (and any deliberately configured custom frontend domain), then restart the backend. All VPS, MongoDB, Secure cookie and single-backend-instance instructions below still apply. Netlify uses `_redirects`; Vercel uses `vercel.json`. Do not put backend secrets in either frontend host. Official routing documentation: https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/.

The two directories are standalone deployments with separate dependencies and lockfiles:

```text
frontend/     React/Vite UI, Vercel configuration, public assets
backend/      Node API, MongoDB services, durable workers, VPS configuration
```

The request path is `browser → Vercel /api/* rewrite → HTTPS VPS API → MongoDB/Skool/OpenRouter`. Vercel hosts only static UI files and proxies API requests. The VPS runs all automation workers and keeps all secrets. External rewrites are documented at https://vercel.com/docs/routing/rewrites.

## 1. Prepare the VPS

These instructions use Linux with systemd and Caddy. Install Node.js 22.12+ and a current Caddy release with public IP ACME certificate support (the VPS uses Caddy 2.11.7). The backend is served at `https://45.61.162.179`, using a Let's Encrypt IP certificate with the `shortlived` ACME profile. Caddy renews this certificate automatically. Permit inbound TCP 80/443 for Caddy; the Node API binds only to loopback on port 3002. Allow the VPS's outbound public IP in the Atlas project containing your cluster. IP certificate requirements are documented at https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability and Caddy's issuer configuration at https://caddyserver.com/docs/caddyfile/directives/tls.

Upload `backend/` to `/opt/skool-automation/backend`, including its lockfile. Do not upload the frontend or local node_modules. Install the backend's dependencies:

```sh
cd /opt/skool-automation/backend
npm ci --omit=dev
cp .env.example .env
```

Edit the new `.env` locally on the VPS:

```dotenv
NODE_ENV=production
API_HOST=127.0.0.1
API_PORT=3002
API_PUBLIC_ORIGIN=https://45.61.162.179
FRONTEND_ORIGINS=https://skoolautomation.vercel.app
TRUST_PROXY=true
LOCAL_OWNER_ENABLED=false
REGISTRATION_CODE=YOUR_SHARED_REGISTRATION_CODE
LAN_HOST=
MONGODB_URI=YOUR_DATABASE_CONNECTION_STRING
MONGODB_DB=skool_automation
COOKIE_ENCRYPTION_KEY=YOUR_EXISTING_64_HEX_CHARACTER_KEY
OPENROUTER_API_KEY=YOUR_SERVER_SIDE_KEY
OPENROUTER_MODEL=openrouter/free
```

Replace the example database URI and keys. `FRONTEND_ORIGINS` can contain a comma-separated list of exact HTTPS origins, including your custom frontend domain; wildcard origins are rejected. Keep preview deployments excluded unless deliberately adding their exact origin. Set a database user with read/write and index permissions for this database. URL-encode special characters in URI credentials.

Set `REGISTRATION_CODE` to the private shared code required for new accounts. The sign-up form sends the entered value to the backend, which checks it before creating any user or session. The match is exact and case-sensitive. An empty setting disables new registrations; existing users can still sign in. Configure the value only in the VPS `.env`, and restart the service after editing it.

If reusing the current MongoDB database, securely transfer the existing `COOKIE_ENCRYPTION_KEY`: changing it makes saved cookies unreadable. An empty/new database needs a newly generated key:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Check connectivity before starting the service:

```sh
npm run db:check
```

Existing registered users retain their private workspace when the database and encryption key are preserved. The development-only `local-owner` workspace is not automatically assigned to a public registrant. Create/sign into your production user and import your Skool accounts there, or arrange an explicit ownership migration before retiring the local workspace. No account records are deleted by this split.

## 2. Run the backend persistently

Create a dedicated service user, give it ownership of the uploaded backend, and restrict the environment file:

```sh
sudo useradd --system --home /opt/skool-automation --shell /usr/sbin/nologin skool
sudo chown -R skool:skool /opt/skool-automation/backend
sudo chmod 600 /opt/skool-automation/backend/.env
sudo cp deploy/skool-backend.service /etc/systemd/system/skool-backend.service
sudo systemctl daemon-reload
sudo systemctl enable --now skool-backend
sudo systemctl status skool-backend
```

Run `command -v node` first and adjust the unit's `/usr/bin/node` if your installation uses a different absolute path. Run only one backend instance against this database, including local copies: each instance resumes durable active runs and bulk jobs. Stop the local project before starting the VPS instance. Do not use PM2 cluster mode, multiple replicas, or a second service process with the same database.

Back up `/etc/caddy/Caddyfile`, then merge the IP site block from `deploy/Caddyfile` into it, preserving existing sites such as `freedomsword.org`. If a site block for this IP already exists, update it instead of adding a duplicate. The block explicitly selects Let's Encrypt with the required `shortlived` profile; an internally issued certificate will not be trusted by Vercel. Then validate and, only if validation succeeds, reload:

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl https://45.61.162.179/api/health
```

Expected response: `{"status":"ok"}`. Certificate issuance happens in the background after reload; if TLS still fails, inspect `sudo journalctl -u caddy -n 60 --no-pager` for issuance or renewal errors. First confirm `curl http://127.0.0.1:3002/api/health` succeeds to distinguish backend failures from proxy/TLS failures. This is a liveness check; MongoDB readiness is tested separately by `npm run db:check`. Backend logs are available with `sudo journalctl -u skool-backend -f`.

Production always sets Secure HttpOnly host-only cookies. The API trusts client-address information only from the configured loopback proxy, which overwrites `X-Real-IP`. Never turn on anonymous local-owner access behind a reverse proxy. JSON writes require an approved Origin. CORS and third-party cookies are not needed because Vercel proxies `/api` on the frontend's own origin.

## 3. Deploy the frontend on Vercel

1. Import the repository and set **Root Directory** to `frontend`. If uploading only that folder as a separate repository, leave Root Directory at its default.
2. Use framework **Vite**, install command `npm ci`, build command `npm run build`, and output directory `dist`.
3. Verify `frontend/vercel.json` forwards `/api/:path*` to `https://45.61.162.179/api/:path*`. Keep this rule before the SPA fallback. The VPS proxy forwards these requests internally to port 3002.
4. Deploy. Put the resulting exact frontend origin in the backend's `FRONTEND_ORIGINS`, then restart `skool-backend` if you changed its environment.
5. Check `https://YOUR_FRONTEND/api/health`, then create/sign into a private service account. Add Skool cookies in Accounts and shared membership information in Settings.

No MongoDB URI, encryption key, OpenRouter key, or backend `.env` belongs in Vercel. There are no required frontend production environment variables. The committed rewrite uses the VPS IP and requires trusted HTTPS on that IP. Keep the API proxy path on `/api` so authenticated browser requests use the frontend origin.

SPA rewrites allow direct links such as `/auto-mode` and `/published-posts`. API responses carry `Cache-Control: no-store`; do not add CDN caching for authenticated endpoints. Secure host-only session cookies are set through the proxy at the frontend origin.

## Local development after the split

The existing secret `.env` was moved to `backend/.env` and its local-owner and LAN settings were preserved. Do not copy that development file unchanged onto the public VPS.

```sh
# From the repository root:
npm run setup
npm run build
npm run dev
```

The frontend is `http://127.0.0.1:5173`; backend is `http://127.0.0.1:3002`. Root commands remain conveniences; each directory can also run independently with `npm ci` and its own npm scripts. Use `frontend/.env` with `DEV_API_TARGET` if you change the local API port. The application has been left stopped after validation.
