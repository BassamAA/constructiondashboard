# Construction Dashboard Frontend

React + TypeScript + Vite single-page app that talks to the backend API.

## Local development

```bash
cd frontend
npm install
VITE_API_BASE=http://localhost:4000 npm run dev
```

`VITE_API_BASE` controls which backend host the UI calls. In development it should stay pointed at your local backend (`npm run dev` inside `backend/`).

## Building locally

```bash
VITE_API_BASE=https://alassaad.fly.dev npm run build
npm run preview   # optional sanity check of the compiled bundle
```

The build output lives in `dist/`.

## Playwright E2E tests

Playwright runs against a live frontend + backend. Provide a valid user so the global login setup can save a storage state.

```bash
cd frontend
E2E_EMAIL="you@example.com" \
E2E_PASSWORD="your-password" \
FRONTEND_URL="http://localhost:5173" \
npm run test:e2e
```

Notes:
- `FRONTEND_URL` defaults to `http://localhost:5173`.
- Make sure the backend is running and reachable by the frontend (`VITE_API_BASE`).

## Production deployment

In production the frontend is bundled during the backend Docker build and the compiled files are served directly from the Express app. To update production you only need to deploy the backend Fly app from the repository root:

```bash
fly auth login               # once
fly deploy                   # runs with fly.toml + backend/Dockerfile
```

The Fly build args (set in the root `fly.toml`) already wire `VITE_API_BASE` to the deployed backend URL, so there is no separate frontend app to pay for or maintain.
