# Construction Dashboard Monorepo

This repository hosts the backend API (`backend/`) and the React SPA (`frontend/`). During development you usually run both projects separately, while production deployments serve the compiled frontend straight from the backend app (single Fly.io service).

## Local development

1. Start Postgres + run Prisma migrations (`cd backend && npx prisma migrate dev`).
2. Launch the API: `cd backend && npm install && npm run dev`.
3. In another terminal run the UI: `cd frontend && npm install && VITE_API_BASE=http://localhost:4000 npm run dev`.

## Environment variables

Templates are provided so secrets do not get committed:

- `backend/.env.example`
- `frontend/.env.example`

Copy them to `.env` locally and fill in real values. Do not commit `.env` files.

## Production deployment (single Fly app)

The root `fly.toml` describes the `alassaad` Fly app and references `backend/Dockerfile`. The Docker build multi-stage compiles the frontend bundle and copies it into the backend image so Express can serve it.

```bash
fly auth login                   # once
fly apps list                    # optional sanity check
fly deploy                       # from repository root
```

Useful environment variables/secrets:

- `DATABASE_URL` – Fly Postgres connection string (already set via `fly pg attach`).
- `ADMIN_API_TOKEN`, `WORKER_API_TOKEN`, etc. – bootstrap tokens for your auth flows.
- `CORS_ORIGIN` – include the production domain(s), e.g. `https://alassaad.fly.dev`.

After confirming the backend serves the SPA (https://alassaad.fly.dev), destroy the legacy `alassaad-frontend` Fly app to avoid double billing: `fly apps destroy alassaad-frontend`.
# constructiondashboard
# constructiondashboard
