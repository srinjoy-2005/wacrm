
* The ER diagram from design docs has been reflected into current schema and is running locally.
* The wacrm additional features have not been scrapped for now, just the required changes have been incorporated

## 1. Executive Summary

WACRM currently relies on **Supabase** as a Backend-as-a-Service (BaaS), using four of its subsystems:

| Supabase Feature | Usage in WACRM | Replacement |
|---|---|---|
| **PostgreSQL Database** | 30 migration files, all CRUD across ~25 tables | Local PostgreSQL via **Prisma ORM** or raw `pg` driver |
| **Auth (GoTrue)** | Sign-up, sign-in, password reset, JWT session cookies, `auth.uid()` in RLS | **NextAuth.js v5** (Credentials + JWT strategy) |
| **Realtime (WebSockets)** | 6 subscription channels: inbox messages, reactions, notifications, unread counts, presence | **Socket.io** server (Next.js custom server) or **Server-Sent Events** |
| **Storage (S3-compatible)** | Profile avatars, flow media, chat media uploads | **Google Cloud Storage** (prod) / local `public/uploads/` (dev) |

The refactor also requires a **database schema redesign** based on the new ER diagram provided below, which simplifies the current 25+ table schema into 8 core tables.

---

### 2.1 Supabase Services WACRM Uses

| Service | Usage in WACRM | Docker Container |
|---|---|---|
| **PostgreSQL** | 30 migration files, ~35 tables, all CRUD | `supabase-db` |
| **GoTrue (Auth)** | Sign-up, sign-in, password reset, JWT sessions, `auth.uid()` in RLS, 48 call sites | `supabase-auth` |
| **PostgREST** | Auto-generated REST API from schema, `.from().select().eq()` chains | `supabase-rest` |
| **Realtime** | 6 WebSocket channels (messages, reactions, notifications, unread, presence) | `supabase-realtime` |
| **Storage** | 3 buckets: `avatars`, `flow-media`, `chat-media` | `supabase-storage` |
| **Kong (API Gateway)** | Routes all requests, handles CORS/rate-limiting | `supabase-kong` |
| **Studio** | Dashboard for database management | `supabase-studio` |
| **postgres-meta** | Schema introspection for Studio | `supabase-meta` |

### 2.2 Supabase Client Libraries

```
@supabase/ssr@^0.12.0      — server-side client (Next.js SSR/RSC)
@supabase/supabase-js@^2.107.0  — core client (browser + server)
```

### 2.3 Environment Variables (Current → Self-Hosted)

| Variable | Current Value | Self-Hosted Value |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://lhfczkjqqoejmfkhdwau.supabase.co` | `http://localhost:8000` (local) or `https://supabase.yourdomain.com` (GCP) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable__vZYK81F...` | New JWT signed with your `JWT_SECRET` |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_qEGVY1fvp...` | New JWT signed with your `JWT_SECRET` |

> [!IMPORTANT]
> **These 3 env vars are the ONLY code-level changes needed.** The Supabase client libraries (`@supabase/ssr`, `@supabase/supabase-js`) connect to whatever URL you give them. Self-hosted Supabase exposes the exact same API surface as cloud Supabase.

### 2.4 Files That Import Supabase

**Client code** (`src/lib/supabase/`):
- `server.ts` — creates server-side Supabase client using `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `client.ts` — creates browser-side singleton Supabase client, same env vars

**~45 files** across `src/` import from these two modules. None of them hardcode URLs or tokens — they all go through the env vars above.

---

### 4.3 Risk Matrix

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Docker resource usage (10+ containers, 8GB+ RAM recommended) | Medium | Medium | Use docker compose resource limits; WSL2 may need memory tuning |
| JWT secret mismatch (ANON_KEY/SERVICE_ROLE not signed with JWT_SECRET) | Low | Critical | Use Supabase's JWT generator tool to create keys from your secret |
| Storage bucket data not migrated | Certain (fresh deploy) | Low | Re-upload any test avatars/media; no prod data at risk |
| pgvector not loading | Low | Low | Supabase Docker image includes it; fallback: skip migration 030 |
| Port conflicts (8000 for Kong, 5432 for PG, etc.) | Medium | Low | Check ports; configure in .env |

---

# tried setting up locally, docker ffailed to run the containers due to memory issues in wsl



# trying to replace supa with psql

### 2. NextAuth v5 vs. Supabase GoTrue Auth Invalidation (Phase 2)
*   **What was attempted:** I installed NextAuth v5 and tried to swap out the login flow in `src/lib/auth`. I exported a subset of users from `auth.users` into the local `users` table.
*   **Where it broke:** WACRM uses Supabase's JWT structure deeply embedded in middleware for route protection. NextAuth's session token structure format completely broke our `middleware.ts`.
*   **The Debugging Wall:**
    *   Over 48 explicit `supabase.auth.getSession()` and `supabase.auth.getUser()` call sites across the application immediately broke.
    *   Attempting to patch them with NextAuth's `auth()` helper led to a circular dependency loop in Next.js edge runtime because our API routes expect a specific Supabase header layout. I spent 4 hours trying to map GoTrue metadata to NextAuth sessions, resulting in persistent `500 Internal Server Error` loops on local login attempts.

### 3. Socket.io / Postgres LISTEN-NOTIFY Local Deadlocks (Phase 3)
*   **What was attempted:** To replace Supabase Realtime (which powers our 6 critical chat channels), I set up a local Socket.io server instance alongside Next.js and added PG `LISTEN/NOTIFY` triggers to the local database.
*   **Where it broke:** Supabase Realtime handles row-level changes automatically. Replicating this via raw PG triggers required writing verbose PL/pgSQL functions for the new 8-table schema.
*   **The Debugging Wall:** Under a mock load test of just 5 concurrent connections broadcasting local messages, the local Node.js event loop clamped up. The Socket.io server kept dropping WebSocket frames, throwing `ERR_CONNECTION_REFUSED`. The abstraction layer (`useSocket` hook) failed to maintain state on page navigation, causing endless socket reconnect loops that crashed the local browser tab.

### 4. The Teacher Simulator Component Cascade (Risk R10)
*   **What happened:** The standalone Vite-based `teacher-simulator` instantly broke upon boot. It relies completely on the `@supabase/supabase-js` client to spoof student/teacher interactions. Because I altered the database layer, the simulator could no longer authenticate or pull active sessions, completely blinding our ability to test features end-to-end.


# trying out CICD pipeline with github actoins -> GCP

Deployed to gcp directly via github actions pipeline, auto deploy request on push 

### 1. Dockerfile Optimization for Next.js
*   **What was done:** Updated the `Dockerfile` to properly accept frontend environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) using `ARG` and `ENV`. This ensures that Next.js bakes these public keys into the client-side JavaScript bundle during the `docker build` phase.

### 2. Artifact Registry Permission Fix
*   **What was attempted:** Initially, the GitHub Action tried to automatically create the Google Artifact Registry repository (`cloud-run-source-deploy`).
*   **Where it broke:** The pipeline service account lacked `artifactregistry.repositories.create` permissions, causing the build to fail right before the `docker push` step.
*   **The Fix:** I manually created the `cloud-run-source-deploy` repository inside the GCP Cloud Shell in the `asia-south1` region, allowing the pipeline to successfully push the built container.

### 3. Secure Secrets Injection (GitHub Actions -> Cloud Run)
*   **What was done:** To prevent committing `.env` files to the repository, we configured the `.github/workflows/deploy-gcp.yml` pipeline to securely inject credentials using GitHub Secrets.
*   **How it works:** 
    *   **Build Time:** Public keys (`NEXT_PUBLIC_*`) are passed to the `docker build` command as `--build-arg`.
    *   **Run Time:** True backend secrets (`ENCRYPTION_KEY`, `META_APP_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`) and toggles (`MOCK_WHATSAPP=true`) are injected directly into the Cloud Run service via the `env_vars` parameter in the deployment step. This ensures real secrets are never exposed in the Docker image history.

### 4. CI/CD Learning Documentation
*   **What was done:** Created `docs/learning_gcp_cicd.md` to document the entire pipeline architecture, explaining Workload Identity Federation (WIF), Docker containerization, Google Cloud Run serverless features, and the distinction between public frontend variables and private backend secrets.

### 5. Next Step: Deploying Teacher Simulator
*   **Status:** Pending Execution.
*   **The Plan:** Instead of deploying the Vite-based `teacher-simulator` as a separate service on Vercel (which would cause CORS issues with the webhook), we drafted a plan to build the simulator during the WACRM Docker build and copy its output to Next.js's `public/simulator` directory. This will allow Cloud Run to serve both applications under the same domain.
