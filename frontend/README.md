# Skool Automation frontend

Standalone React/Vite application. Deploy this folder to Netlify or Vercel; it has its own package.json and lockfile. It requires no backend source files and contains no database, encryption or OpenRouter credentials.

```sh
npm ci
npm run dev
npm run build
```

Development proxies `/api/*` to `http://127.0.0.1:3002`. To change that target, copy `.env.example` to `.env` and edit `DEV_API_TARGET`. Run the backend separately or use the parent project's `npm run dev` after `npm run setup`.

For Vercel, select this folder as **Root Directory**, use build command `npm run build`, and output directory `dist`. Replace `https://api.example.com` in `vercel.json` with your VPS API's HTTPS origin before deploying. API rewrites must stay before the SPA fallback. Browser requests remain on `/api` at the frontend origin, so host-only HttpOnly session cookies work without cross-site-cookie settings. API responses must not be cached.

Configure the backend's `FRONTEND_ORIGINS` with the exact HTTPS origin of this frontend. No `VITE_` secrets or direct browser-to-VPS API URL are required. Full deployment instructions are in the parent `DEPLOYMENT.md`.

For Netlify, replace `api.example.com` in `public/_redirects` with the VPS backend's HTTPS domain, run `npm run build`, and upload the contents of `dist` as a manual deployment. The packaged `artifacts/frontend-netlify.zip` in the parent project contains this prebuilt site with `index.html` at its root. For a Git-based Netlify deployment, set the base directory to `frontend`; `netlify.toml` selects `npm run build` and `dist`. Preserve the API rule before the SPA fallback. Add the exact resulting `https://YOUR_SITE.netlify.app` origin to the backend's `FRONTEND_ORIGINS` and restart the backend after editing that environment setting.
