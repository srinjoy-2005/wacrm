# WACRM → Self-Hosted Supabase Migration Guide

> **Audience**: Any developer, LLM, or AI agent working on this codebase  
> **Status**: REFERENCE DOCUMENT — Decision pending stakeholder review  
> **Last updated**: 2026-07-11  
> **Previous plan**: The earlier `supabase_to_postgres_migration.md` proposed replacing Supabase entirely with raw PostgreSQL + NextAuth + Socket.io. That plan is **on hold** — the Supabase dependency is too deep (30 migrations, ~45 files using Supabase clients, 4 subsystems: Auth, Realtime, Storage, PostgREST). The new approach: **keep Supabase, just self-host it**.

---

## 1. Why Self-Host Instead of Replace

| Factor | Replace Supabase (old plan) | Self-Host Supabase (new plan) |
|---|---|---|
| **Code changes needed** | ~139 files, 6+ weeks | **~3 lines** (env vars only) |
| **Schema changes** | Major rewrite (auth.users→users, drop RLS) | **Zero** — all 30 migrations run as-is |
| **Risk level** | Critical (data loss, auth invalidation, RLS removal) | **Low** (infrastructure change only) |
| **Auth system** | Replace GoTrue with NextAuth.js | **Keep GoTrue** (runs locally in Docker) |
| **Realtime** | Replace with Socket.io | **Keep Supabase Realtime** (runs locally in Docker) |
| **Storage** | Replace with local filesystem/GCS | **Keep Supabase Storage** (runs locally in Docker) |
| **Feature parity** | 13 features dropped (tags, deals, automations, etc.) | **100% feature parity** |
| **Timeline** | 6 weeks | **1-2 days** (local), **1 week** (GCP) |

---

## 2. Current Architecture Snapshot

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

## 3. Complete Schema Inventory (All 30 Migrations)

> [!NOTE]
> Every migration below runs **unmodified** on self-hosted Supabase. The `auth.users` table, `auth.uid()` function, RLS policies, `storage.buckets`, `storage.objects`, and `supabase_realtime` publication all exist in self-hosted Supabase's Docker PostgreSQL image.

### 3.1 Tables (Final Schema After All 30 Migrations)

| # | Table | Created In | Key Features |
|---|---|---|---|
| 1 | `profiles` | 001 | user_id FK→auth.users, full_name, email, avatar_url, role, account_id (017), account_role (017), beta_features (011) |
| 2 | `contacts` | 001 | user_id, account_id (017), phone, name, email, company, avatar_url, phone_normalized (022), segment (031), preferred_language (031) |
| 3 | `collections` | 001 | (Formerly `tags`, renamed in 031) user_id, account_id (017), name, color |
| 4 | `collection_members` | 001 | (Formerly `contact_tags`, renamed in 031) contact_id→contacts, collection_id→collections, UNIQUE pair |
| 5 | `custom_fields` | 001 | user_id, account_id (017), field_name, field_type, field_options JSONB |
| 6 | `contact_custom_values` | 001 | contact_id→contacts, custom_field_id→custom_fields, UNIQUE pair |
| 7 | `contact_notes` | 001 | contact_id→contacts, user_id, account_id (017), note_text |
| 8 | `conversations` | 001 | user_id, account_id (017), contact_id→contacts, status CHECK, assigned_agent_id, last_message_text, unread_count, ai_autoreply_disabled (029), ai_reply_count (029) |
| 9 | `messages` | 001 | conversation_id→conversations, sender_type CHECK, content_type CHECK (widened 010), content_text, media_url, transcript (031), template_name, message_id, status CHECK, reply_to_message_id (009), interactive_reply_id (010) |
| 10 | `delivery_logs` | 031 | message_id→messages, status, timestamp |
| 11 | `whatsapp_config` | 001 | user_id, account_id (017), phone_number_id UNIQUE (013), waba_id, access_token, verify_token, status CHECK, registered_at (015), subscribed_apps_at (015), last_registration_error (015) |
| 12 | `message_templates` | 001 | user_id, account_id (017), name, category, language, body_text, buttons JSONB, status CHECK (updated 014 to Meta enum), sample_values (014), meta_template_id (014), quality_score (014), header_handle (014), header_media_url (014), UNIQUE(user_id, name, language) (014) |
| 13 | `pipelines` | 001 | user_id, account_id (017), name |
| 14 | `pipeline_stages` | 001 | pipeline_id→pipelines, name, position, color |
| 15 | `deals` | 001 | user_id, account_id (017), pipeline_id, stage_id, contact_id (nullable 004), title, value, currency, assigned_to (002), status CHECK (002: open/won/lost) |
| 16 | `broadcasts` | 001 | user_id, account_id (017), name, template_name, audience_filter JSONB, status CHECK, sent/delivered/read/replied/failed counts |
| 17 | `broadcast_recipients` | 001 | broadcast_id→broadcasts, contact_id (nullable 004, ON DELETE SET NULL), status CHECK, whatsapp_message_id (003, UNIQUE partial) |
| 18 | `message_reactions` | 009 | message_id→messages, conversation_id→conversations, actor_type, actor_id, emoji, UNIQUE(message_id, actor_type, actor_id) |
| 19 | `automations` | 006 | user_id, account_id (017), name, trigger_type, trigger_config JSONB, is_active, execution_count, last_executed_at |
| 20 | `automation_steps` | 006 | automation_id→automations, parent_step_id (self-FK), branch, step_type, step_config JSONB, position |
| 21 | `automation_logs` | 006 | automation_id, user_id, account_id (017), contact_id (nullable), trigger_event, steps_executed JSONB, status CHECK |
| 22 | `automation_pending_executions` | 006 | automation_id, user_id, account_id (017), contact_id, log_id, next_step_position, context JSONB, status CHECK, run_at |
| 23 | `flows` | 010 | user_id, account_id (017), name, description, status CHECK, trigger_type CHECK, trigger_config JSONB, entry_node_id, fallback_policy JSONB, execution_count |
| 24 | `flow_nodes` | 010 | flow_id→flows, node_key, node_type CHECK (widened 016: +send_media), config JSONB, position_x/y, UNIQUE(flow_id, node_key) |
| 25 | `sessions` | 010 | (Formerly `flow_runs`, renamed in 031) flow_id, user_id, account_id (017), contact_id (nullable), conversation_id, status CHECK (6 states), current_node_key, vars JSONB, UNIQUE partial idx on (account_id, contact_id) WHERE active |
| 26 | `session_events` | 010 | (Formerly `flow_run_events`, renamed in 031) session_id→sessions, event_type CHECK, node_key, payload JSONB |
| 27 | `accounts` | 017 | owner_user_id→auth.users, name, default_currency (021, CHECK ^[A-Z]{3}$) |
| 28 | `account_invitations` | 017 | account_id→accounts, token_hash UNIQUE, role (enum), expires_at, accepted_at |
| 29 | `member_presence` | 024 | user_id PK→auth.users, account_id→accounts, status CHECK (online/away), last_seen_at |
| 30 | `api_keys` | 026 | account_id→accounts, created_by→auth.users, name, key_prefix, key_hash UNIQUE, scopes[], expires_at, revoked_at |
| 31 | `webhook_endpoints` | 028 | account_id→accounts, created_by→auth.users, url, secret (AES encrypted), events[], is_active, failure_count |
| 32 | `ai_configs` | 029 | account_id UNIQUE→accounts, provider CHECK, model, api_key (AES encrypted), system_prompt, auto_reply settings, embeddings_api_key (030) |
| 33 | `ai_knowledge_documents` | 030 | account_id→accounts, created_by→auth.users, title, content |
| 34 | `ai_knowledge_chunks` | 030 | document_id→ai_knowledge_documents, account_id, chunk_index, content, fts (tsvector generated), embedding (vector(1536)) |

### 3.2 Custom Types

| Type | Created In | Values |
|---|---|---|
| `account_role_enum` | 017 | `'owner'`, `'admin'`, `'agent'`, `'viewer'` |

### 3.3 Functions & RPCs

| Function | Migration | Purpose | Uses auth.uid()? |
|---|---|---|---|
| `update_updated_at_column()` | 001 | Generic updated_at trigger | No |
| `handle_new_user()` | 001 (rewritten 017) | Auto-create profile+account on signup | Yes (trigger on auth.users) |
| `recompute_broadcast_counts(bid)` | 003 (updated 005) | Rebuild broadcast aggregate counts | No |
| `broadcast_recipient_aggregate_trigger()` | 003 (updated 005) | Incremental count updates on recipient changes | No |
| `_bcast_bump(bid, col, delta)` | 005 | Atomic column increment helper | No |
| `_bcast_cols_for_status(s)` | 005 | Map status to count columns | No |
| `increment_automation_execution_count(p_id)` | 007 | Atomic counter | No |
| `merge_duplicate_contacts()` | 022 | Deduplicate contacts by normalized phone | No |
| `increment_flow_execution_count(p_id)` | 012 | Atomic counter | No |
| `is_account_member(account_id, min_role)` | 017 | RLS membership check | Yes |
| `set_member_role(p_user_id, p_new_role)` | 018 | Change teammate's role | Yes |
| `remove_account_member(p_user_id)` | 018 | Remove member, create personal account | Yes |
| `transfer_account_ownership(p_new_owner_id)` | 018 | Transfer ownership atomically | Yes |
| `peek_invitation(p_token_hash)` | 019 | Anonymous invite preview | No |
| `redeem_invitation(p_token_hash)` | 019 | Accept invite, move to new account | Yes |
| `touch_presence(p_status)` | 024 | Upsert presence heartbeat | Yes |
| `filter_contacts_by_tags(p_tag_ids[], ...)` | 025 | Server-side paginated tag filter | No (INVOKER) |
| `notify_conversation_assigned()` | 027 | Trigger: create notification on assignment | Yes |
| `record_webhook_failure(endpoint_id, max)` | 028 | Atomic failure counter + auto-disable | No |
| `update_ai_configs_updated_at()` | 029 | Trigger for ai_configs.updated_at | No |
| `claim_ai_reply_slot(conv_id, max)` | 029 | Atomic AI reply cap check | No |
| `update_ai_knowledge_documents_updated_at()` | 030 | Trigger for documents.updated_at | No |
| `match_ai_knowledge_fts(account_id, query, n)` | 030 | Full-text search retrieval | No |
| `match_ai_knowledge_semantic(account_id, emb, n)` | 030 | Vector similarity retrieval | No |

> [!IMPORTANT]
> **All `auth.uid()` calls work perfectly on self-hosted Supabase** — GoTrue runs locally and provides the same `auth.uid()` function. This is a non-issue for self-hosting.

### 3.4 Storage Buckets

| Bucket | Migration | Public? | Size Limit | Used For |
|---|---|---|---|---|
| `avatars` | 008 | Yes | 2 MB | Profile photos |
| `flow-media` | 016 | Yes | 16 MB | Flow builder media nodes |
| `chat-media` | 023 | Yes | 16 MB | Agent-sent media in inbox |

### 3.5 Realtime Publications

| Table | Migration | Used For |
|---|---|---|
| `messages` | 001 | Live message updates in inbox |
| `conversations` | 001 | Conversation status changes |
| `message_reactions` | 009 | Reaction updates |
| `flow_runs` | 010 | Flow state in inbox |
| `notifications` | 027 | New notification alerts |
| `member_presence` | 024 | Online/offline status |

### 3.6 Extensions

| Extension | Migration | Purpose |
|---|---|---|
| `uuid-ossp` | 001 | `uuid_generate_v4()` for PKs |
| `vector` (pgvector) | 030 | AI knowledge embeddings + HNSW index |

---

## 4. Schema Safety Analysis

### 4.1 Are the 30 migrations safe on self-hosted Supabase?

**YES — 100% safe.** Here's why:

| Concern | Assessment |
|---|---|
| `auth.users` table exists? | ✅ Yes — GoTrue creates it on first boot |
| `auth.uid()` function exists? | ✅ Yes — part of GoTrue's Postgres schema |
| `storage.buckets` / `storage.objects` exist? | ✅ Yes — Storage API creates these tables |
| `supabase_realtime` publication exists? | ✅ Yes — Realtime service creates it |
| Supabase roles (`anon`, `authenticated`, `service_role`)? | ✅ Yes — created by the Docker init scripts |
| `pgvector` extension available? | ✅ Yes — Supabase's Docker Postgres image includes it |
| Migration ordering dependencies? | ✅ Safe — they're numbered 001-030 and run in order |
| Idempotency? | ✅ Every migration uses `IF NOT EXISTS` / `DROP IF EXISTS` |

### 4.2 What about existing data?

This is a **fresh self-hosted deployment** — there's no existing data to migrate. The cloud Supabase instance (`lhfczkjqqoejmfkhdwau.supabase.co`) currently has test/dev data only. If you ever need to migrate production data from cloud to self-hosted, use:

```bash
# Export from cloud
supabase db dump --db-url "postgresql://postgres:[PASSWORD]@db.lhfczkjqqoejmfkhdwau.supabase.co:5432/postgres" -f roles.sql --role-only
supabase db dump --db-url "postgresql://..." -f schema.sql
supabase db dump --db-url "postgresql://..." -f data.sql --use-copy --data-only

# Import to self-hosted
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql \
  --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql \
  --dbname "postgresql://postgres:your-super-secret@localhost:5432/postgres"
```

### 4.3 Risk Matrix

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Docker resource usage (10+ containers, 8GB+ RAM recommended) | Medium | Medium | Use docker compose resource limits; WSL2 may need memory tuning |
| JWT secret mismatch (ANON_KEY/SERVICE_ROLE not signed with JWT_SECRET) | Low | Critical | Use Supabase's JWT generator tool to create keys from your secret |
| Storage bucket data not migrated | Certain (fresh deploy) | Low | Re-upload any test avatars/media; no prod data at risk |
| pgvector not loading | Low | Low | Supabase Docker image includes it; fallback: skip migration 030 |
| Port conflicts (8000 for Kong, 5432 for PG, etc.) | Medium | Low | Check ports; configure in .env |

---

## 5. Self-Hosting Setup (Step-by-Step)

### 5.1 Prerequisites

- Docker Engine + Docker Compose (v2)
- ~8 GB RAM available (WSL2: set in `.wslconfig`)
- Ports: 8000 (API Gateway), 3000 (Studio), 5432 (Postgres) free

### 5.2 Install

```bash
# Clone Supabase Docker setup
git clone --depth 1 https://github.com/supabase/supabase
cd supabase/docker

# Copy env template
cp .env.example .env
```

### 5.3 Configure `.env`

Key variables to set in `supabase/docker/.env`:

```env
# REQUIRED — generate these:
POSTGRES_PASSWORD=your-super-secret-postgres-password
JWT_SECRET=your-super-secret-jwt-token-at-least-32-characters
ANON_KEY=<generated JWT with role=anon, signed with JWT_SECRET>
SERVICE_ROLE_KEY=<generated JWT with role=service_role, signed with JWT_SECRET>

# IMPORTANT — dashboard access
DASHBOARD_USERNAME=supabase
DASHBOARD_PASSWORD=your-dashboard-password

# Site URL for auth redirects  
SITE_URL=http://localhost:3000
API_EXTERNAL_URL=http://localhost:8000
```

> [!TIP]
> Generate ANON_KEY and SERVICE_ROLE_KEY at: https://supabase.com/docs/guides/self-hosting#api-keys
> 
> Or manually with Node.js + jsonwebtoken:
> ```bash
> # ANON_KEY (role: anon)
> node -e "const jwt=require('jsonwebtoken');console.log(jwt.sign({role:'anon',iss:'supabase',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+315360000},'your-jwt-secret'))"
> 
> # SERVICE_ROLE_KEY (role: service_role)  
> node -e "const jwt=require('jsonwebtoken');console.log(jwt.sign({role:'service_role',iss:'supabase',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+315360000},'your-jwt-secret'))"
> ```

### 5.3.1 Minimal Setup for Cheap GCP Servers (Optional)

If you are running this on a constrained server (e.g., GCP e2-micro or e2-small), you should disable non-essential Supabase services to save memory. 

Edit the `supabase/docker/docker-compose.yml` file and **remove or comment out** the following services before starting the stack:
- `studio` (Dashboard is heavy; you can use DBeaver/DataGrip to connect to PG directly)
- `meta` (Only needed for Studio)
- `logflare` & `vector` (Log routing and vector/embeddings, unless you need AI knowledge features)
- `edge-runtime` (Supabase Edge Functions are not used in this app)
- `supavisor` (Connection pooler; direct PG connection is fine for small scale)

You **MUST** keep:
- `db` (Postgres)
- `kong` (API Gateway / CORS)
- `auth` (GoTrue)
- `rest` (PostgREST)
- `realtime` (WebSockets)
- `storage` (Avatars/Media)

### 5.4 Start the Stack

```bash
docker compose pull
docker compose up -d
```

Verify: `docker compose ps` should show ~10 healthy containers.

### 5.5 Run Migrations

Once the stack is up, run the 30 migrations against the self-hosted Postgres:

```bash
# Connect to self-hosted Supabase's Postgres and run all migrations in order
for f in /path/to/wacrm/supabase/migrations/*.sql; do
  echo "Running $f..."
  psql "postgresql://postgres:your-super-secret@localhost:5432/postgres" -f "$f"
done
```

Or via Supabase CLI (if linked):
```bash
supabase db push --db-url "postgresql://postgres:your-super-secret@localhost:5432/postgres"
```

### 5.6 Update WACRM `.env.local`

Change just 3 lines in `.env.local`:

```env
# Before (cloud):
NEXT_PUBLIC_SUPABASE_URL=https://lh...
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable__..
SUPABASE_SERVICE_ROLE_KEY=sb_secret_qEGV...

# After (self-hosted):
NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your generated ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<your generated SERVICE_ROLE_KEY>
```

### 5.7 Verify

```bash
# Start WACRM
cd /path/to/wacrm
npm run dev

# Test:
# 1. Open http://localhost:3000 — signup/login should work
# 2. Open Supabase Studio at http://localhost:8000 — check tables exist
# 3. Send a test message — realtime should update
```

---

## 6. GCP Deployment Path (Later)

When ready to move self-hosted Supabase to GCP:

| Option | Description | Best For |
|---|---|---|
| **A: Docker on GCE VM** | Run `docker compose up` on a GCE e2-standard-4 VM | Simplest, recommended for your scale |
| **B: Split into GCP services** | Cloud SQL (PG) + Cloud Run (Next.js) + individual Supabase services | Large scale, more complex |

Option A recommended. Cost: ~$100-150/month for an e2-standard-4 (4 vCPU, 16 GB RAM).

---

## 7. Decision Matrix for Stakeholders

| Approach | Effort | Risk | Feature Parity | Cost |
|---|---|---|---|---|
| **A: Keep Supabase Cloud** (status quo) | 0 | 0 | 100% | Monthly SaaS fee |
| **B: Self-Host Supabase locally → GCP** (recommended) | 1-2 days local, 1 week GCP | Low | **100%** | Infrastructure only |
| **C: Replace Supabase with raw PG** (old plan, on hold) | 6+ weeks | Critical | ~70% initially | Infrastructure only |

> [!CAUTION]
> **Option C (full replacement) risks**: Data loss during schema migration, authentication session invalidation, RLS removal creates security holes, 139+ file refactor introduces bugs, realtime feature regression. See the old `supabase_to_postgres_migration.md` Section 4 for detailed risk analysis. **Do not proceed with Option C without stakeholder sign-off on the 13 dropped features and 6+ week timeline.**

---

## 8. File Index (What Exists Where)

| File | Purpose |
|---|---|
| `supabase/migrations/001-030_*.sql` | All 30 Supabase migrations (source of truth for schema) |
| `migrations/001_new_schema.sql` | OLD 8-table scope-reduced schema — **DO NOT USE** (superseded by this doc) |
| `supabase_to_postgres_migration.md` | OLD full-replacement plan — **ON HOLD** (reference only) |
| `docs/self_hosted_supabase_migration.md` | **THIS FILE** — current migration guide |
| `.env.local` | Current cloud Supabase credentials (needs 3 lines changed for self-host) |
| `src/lib/supabase/server.ts` | Server-side Supabase client factory |
| `src/lib/supabase/client.ts` | Browser-side Supabase client singleton |
| `package.json` | Dependencies: `@supabase/ssr@^0.12.0`, `@supabase/supabase-js@^2.107.0` |
