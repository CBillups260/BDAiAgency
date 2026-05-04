# BDAi Agency

A unified Vite/React frontend + Firebase Cloud Functions backend for an AI-powered marketing agency control plane.

## Architecture

```
┌─────────────────────────────┐
│  React (Vite) — src/        │  ──► Firebase Hosting
│  Firebase Auth · Firestore  │
│  Firebase Storage           │
└──────────────┬──────────────┘
               │  /api/**
               ▼
┌─────────────────────────────┐
│  Express (functions/src/)   │  ──► Cloud Functions Gen 2 (`api`)
│  Firebase Admin SDK         │
│  Gemini · Google Places ·   │
│  HighLevel · Gmail · Canva  │
└─────────────────────────────┘
```

All `/api/*` calls require a Firebase ID token (`Authorization: Bearer <token>`)
except for the OAuth callback endpoints and the image proxy (which is hit by
browser `<img>` tags).

## Local development

### Prerequisites
- Node.js 20
- A Firebase project (set as `default` in `.firebaserc`)
- `.env` files (see `.env.example`)

### One-time setup

```bash
npm install
npm install --prefix functions
```

Copy `.env.example` to `.env` (frontend) and `functions/.env` (backend) and
fill in the real values.

### Running the app

```bash
# Terminal 1 — Vite dev server (frontend)
npm run dev

# Terminal 2 — Express dev server (backend, port 3001, auth bypassed)
npm run dev:server
```

Or run both in parallel:

```bash
npm run dev:all
```

The Vite proxy in `vite.config.ts` forwards `/api/*` to `localhost:3001`. The
dev server sets `ALLOW_UNAUTHENTICATED=true`, so requests skip Firebase ID
token verification locally.

### Useful scripts

| Script                        | What it does                                   |
| ----------------------------- | ---------------------------------------------- |
| `npm run lint`                | `tsc --noEmit` for both frontend and functions |
| `npm run build`               | Build frontend → `dist/`                       |
| `npm run build:functions`     | Build functions → `functions/lib/`             |
| `npm run firestore:seed`      | Seed Firestore with example data               |
| `npm run team:add -- <args>`  | Add or update a team member doc                |

## Deployment

```bash
# Build everything and deploy hosting + functions in one shot
npm run deploy

# Or piecemeal
npm run deploy:hosting
npm run deploy:functions
```

The first deploy of the `api` function requires that the project is on the
**Blaze** plan (Cloud Functions Gen 2 needs it). Set required environment
variables in `functions/.env.<projectId>` before deploying.

## Adding new API routes

1. Add a route file under `functions/src/routes/`.
2. Mount it in `functions/src/app.ts`:
   ```ts
   app.use("/api/yourthing", yourRoutes);
   ```
3. The auth middleware protects every `/api/*` path by default. To open a
   route (e.g. an OAuth callback), add a regex to `OPEN_PATHS` in `app.ts`.
4. From the frontend, always call the API via `authedFetch` from `src/lib/api.ts`
   so a fresh Firebase ID token is attached automatically.

## OAuth tokens

Gmail and Canva OAuth tokens live in Firestore under
`integration_tokens/{provider}/keys/default` so they survive Cloud Functions
cold starts. The PKCE state for the Canva flow lives in
`oauth_pending_state/{state}` and is consumed on callback. Add a Firestore TTL
policy on `oauth_pending_state.expiresAt` to auto-clean abandoned flows.

## Known mock / WIP areas

- Dashboard metric cards, Agency Health Score, Reports tab — all mock.
- AI Account Agent chat input is rendered but not wired to a backend.
- AI Video editor was removed pending a rewrite (Sora replacement).
- The agent toggle dropdown is local-state only.
