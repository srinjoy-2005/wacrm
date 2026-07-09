# WACRM → Local PostgreSQL + GCP Migration Plan

> **Audience**: Tech Lead, Engineering Team  
> **Status**: DRAFT — Pending Approval  
> **Scope**: Complete removal of Supabase dependency; replacement with local PostgreSQL (dev) and Google Cloud (prod)

---

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

## 2. New Database Schema (ER Diagram)

```mermaid
erDiagram
    Contacts {
        uuid id PK
        string phone UK
        string name
        string segment
        string preferred_language
    }

    Conversations {
        uuid id PK
        uuid contact_id FK
        string status
        timestamp last_message_at
    }

    Messages {
        uuid id PK
        uuid conversation_id FK
        string direction
        text body
        string transcript
        string delivery_status
    }

    Delivery_Log {
        uuid id PK
        uuid message_id FK
        string status
        timestamp timestamp
    }

    Flows {
        uuid id PK
        string name
        jsonb definition
        jsonb translations
        string version_status
        string trigger_type
        string target_url
        string mode
        string status
    }

    Sessions {
        uuid id PK
        uuid contact_id FK
        uuid flow_id FK
        string state
        string status
    }

    Collections {
        uuid id PK
        string name
    }

    Collection_Members {
        uuid id PK
        uuid collection_id FK
        uuid contact_id FK
    }

    Contacts ||--o{ Conversations : "has many"
    Conversations ||--o{ Messages : "has many"
    Messages ||--o{ Delivery_Log : "has many"
    Contacts ||--o{ Sessions : "has many"
    Flows ||--o{ Sessions : "has many"
    Collections ||--o{ Collection_Members : "has many"
    Contacts ||--o{ Collection_Members : "belongs to many"
```

### 2.1 Schema SQL (Initial Migration)

```sql
-- 001_new_schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CONTACTS
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone TEXT NOT NULL UNIQUE,
  name TEXT,
  segment TEXT,
  preferred_language TEXT DEFAULT 'en',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CONVERSATIONS
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open',
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_conversations_contact ON conversations(contact_id);

-- MESSAGES
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body TEXT,
  transcript TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'sent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);

-- DELIVERY_LOG
CREATE TABLE delivery_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_delivery_log_message ON delivery_log(message_id);

-- FLOWS
CREATE TABLE flows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  definition JSONB,
  translations JSONB,
  version_status TEXT DEFAULT 'draft',
  trigger_type TEXT,
  target_url TEXT,
  mode TEXT DEFAULT 'normal',
  status TEXT DEFAULT 'inactive',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SESSIONS
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  state TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sessions_contact ON sessions(contact_id);
CREATE INDEX idx_sessions_flow ON sessions(flow_id);

-- COLLECTIONS
CREATE TABLE collections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- COLLECTION_MEMBERS (Many-to-Many: Contacts <-> Collections)
CREATE TABLE collection_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(collection_id, contact_id)
);
CREATE INDEX idx_collection_members_collection ON collection_members(collection_id);
CREATE INDEX idx_collection_members_contact ON collection_members(contact_id);
```

### 2.2 Key Schema Differences from Current WACRM

| Current (Supabase) | New (Local PG) | Notes |
|---|---|---|
| `sender_type` ('customer'/'agent'/'bot') | `direction` ('inbound'/'outbound') | Simplified message direction model |
| `content_type`, `content_text`, `media_url` | `body`, `transcript` | Consolidated content fields |
| `status` on messages | `delivery_status` + separate `delivery_log` table | Audit trail for delivery transitions |
| `user_id`, `account_id` on every table | Removed | No multi-tenant RLS; single-instance deployment |
| 25+ tables (tags, custom_fields, pipelines, deals, broadcasts, etc.) | 8 core tables | Feature scope reduced to messaging core |
| `whatsapp_config` table | Removed (moved to env vars or a single config row) | Simplified credential storage |

---

## 3. Migration Plan — Phased Approach

### Phase 0: Immediate Schema Change — Local PostgreSQL (NOW)

> [!CAUTION]
> This phase must be executed **immediately** before any code refactoring begins. It establishes the new database schema on local PostgreSQL as the single source of truth.

**Prerequisites confirmed**:
- ✅ PostgreSQL 14 is installed and running (`localhost:5432` — accepting connections)
- ✅ `psql` CLI available at `/usr/bin/psql`

#### Step 1: Create the `wacrm_dev` database

```bash
# Create a dedicated database (run as the postgres superuser)
sudo -u postgres createdb wacrm_dev

# Verify it exists
psql -h localhost -U postgres -l | grep wacrm_dev
```

> [!TIP]
> If `peer` authentication blocks you, edit `/etc/postgresql/14/main/pg_hba.conf` and change the local method to `md5` or `trust` for development.

#### Step 2: Run the new schema migration

Create the file `migrations/001_new_schema.sql` in the project root (replacing the old `supabase/migrations/` directory) and execute it:

```bash
psql -h localhost -U postgres -d wacrm_dev -f migrations/001_new_schema.sql
```

The SQL content is defined in [Section 2.1](#21-schema-sql-initial-migration) above.

#### Step 3: Verify all 8 tables exist

```bash
psql -h localhost -U postgres -d wacrm_dev -c "\dt"
```

Expected output:
```
             List of relations
 Schema |       Name         | Type  |  Owner
--------+--------------------+-------+----------
 public | collection_members | table | postgres
 public | collections        | table | postgres
 public | contacts           | table | postgres
 public | conversations      | table | postgres
 public | delivery_log       | table | postgres
 public | flows              | table | postgres
 public | messages           | table | postgres
 public | sessions           | table | postgres
```

#### Step 4: Set the connection string

Add to `.env.local`:
```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/wacrm_dev
```

#### Step 5: Seed test data (optional)

```sql
-- Insert a test contact
INSERT INTO contacts (phone, name, segment, preferred_language)
VALUES ('+919999999999', 'Test Teacher', 'staff', 'en');

-- Insert a test conversation
INSERT INTO conversations (contact_id, status)
VALUES (
  (SELECT id FROM contacts WHERE phone = '+919999999999'),
  'open'
);
```

#### What this phase does NOT do:
- ❌ Does not touch the existing Supabase-connected codebase
- ❌ Does not modify any `src/` files
- ❌ Does not remove the `supabase/migrations/` directory yet

The new schema lives side-by-side with the old Supabase migrations until code refactoring (Phases 1–5) catches up.

---

### Phase 1: Database Layer Replacement (Week 1–2)

> [!IMPORTANT]
> This is the most critical and riskiest phase. All other phases depend on it.

#### 3.1.1 Connect Application Code to Local PostgreSQL

#### 3.1.2 Choose a Database Access Pattern

| Option | Pros | Cons |
|---|---|---|
| **Prisma ORM** (Recommended) | Type-safe queries, auto-generated migrations, schema introspection | Learning curve, N+1 risks |
| **Drizzle ORM** | Lightweight, SQL-like syntax, fast | Smaller ecosystem |
| **Raw `pg` driver** | Full SQL control, minimal abstraction | No type safety, manual migrations |

**Recommendation**: Use **Prisma** for the ORM layer. It provides:
- `prisma migrate` for schema versioning (replaces 30 Supabase migration files)
- Auto-generated TypeScript types (replaces manual `interface` definitions)
- Connection pooling via Prisma Accelerate (useful for GCP prod)

#### 3.1.3 Create a Database Abstraction Layer (`src/lib/db/`)

```
src/lib/db/
├── prisma.ts          # Prisma client singleton
├── queries/
│   ├── contacts.ts    # findContact, createContact, etc.
│   ├── conversations.ts
│   ├── messages.ts
│   ├── flows.ts
│   └── ...
└── index.ts           # Re-exports
```

This abstraction layer ensures that all Supabase `.from('table').select()` calls are replaced with typed query functions. The 139+ files that currently import Supabase will be refactored to use this layer.

#### 3.1.4 Files Requiring Database Refactoring

| Category | File Count | Complexity |
|---|---|---|
| API Routes (`src/app/api/`) | ~30 files | High — contain `.from().select().eq()` chains |
| Dashboard Pages (`src/app/(dashboard)/`) | ~10 files | Medium — server-side data fetching |
| Components (`src/components/`) | ~20 files | Medium — client-side Supabase queries |
| Hooks (`src/hooks/`) | ~6 files | High — realtime subscriptions |
| Lib utilities (`src/lib/`) | ~15 files | High — admin clients, auth, storage |

---

### Phase 2: Authentication Replacement (Week 2–3)

#### Current Supabase Auth Usage (48 call sites)
- `supabase.auth.signUp()` — signup page
- `supabase.auth.signInWithPassword()` — login page
- `supabase.auth.signOut()` — logout
- `supabase.auth.getUser()` — 30+ API routes for authorization
- `supabase.auth.getSession()` — 10+ components for client-side auth
- `supabase.auth.updateUser()` — profile/password updates
- `supabase.auth.resetPasswordForEmail()` — forgot password
- `supabase.auth.onAuthStateChange()` — real-time auth listener
- `auth.uid()` in RLS policies — row-level security

#### Replacement: NextAuth.js v5

```
src/lib/auth/
├── auth.config.ts     # NextAuth configuration
├── providers.ts       # Credentials provider (email + bcrypt)
├── session.ts         # getServerSession() helper
└── middleware.ts       # Route protection
```

**Key changes:**
- Replace `supabase.auth.getUser()` with `getServerSession()` in API routes
- Replace `supabase.auth.getSession()` with `useSession()` hook in components
- Replace `auth.uid()` RLS policies with application-level authorization checks
- Store password hashes in a new `users` table using `bcrypt`
- JWT tokens managed by NextAuth instead of Supabase GoTrue

#### New `users` Table
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

### Phase 3: Realtime Replacement (Week 3–4)

#### Current Supabase Realtime Channels (6 subscriptions)

| Channel | File | Purpose |
|---|---|---|
| `messages:conversation_id` | `use-realtime.ts` | Live message updates in inbox |
| `reactions:conversation_id` | `message-thread.tsx` | Reaction updates |
| `notifications-page` | `notifications/page.tsx` | New notification alerts |
| `total-unread-realtime` | `use-total-unread.ts` | Unread badge counter |
| `notifications-unread-count` | `use-unread-notifications.ts` | Notification badge |
| `presence:accountId` | `use-presence.ts` | Online/offline status |

#### Replacement Options

| Option | Pros | Cons |
|---|---|---|
| **Socket.io** (Recommended) | Battle-tested, room-based, auto-reconnect | Requires custom server |
| **Server-Sent Events (SSE)** | Native browser support, simple | Unidirectional only |
| **Pusher/Ably** | Managed service | Vendor lock-in (defeats purpose) |

**Recommendation**: Use **Socket.io** with a lightweight Express/Node.js sidecar that listens to PostgreSQL `NOTIFY` events and broadcasts them to connected clients.

```
src/lib/realtime/
├── socket-server.ts   # Socket.io server setup
├── pg-listener.ts     # PostgreSQL LISTEN/NOTIFY bridge
├── use-socket.ts      # React hook for client-side subscriptions
└── events.ts          # Event type definitions
```

---

### Phase 4: Storage Replacement (Week 4)

#### Current Supabase Storage Usage (4 call sites)
- Profile avatar uploads (`profile-form.tsx`)
- Flow media uploads/deletes (`upload-media.ts`)
- Public URL generation

#### Replacement
- **Development**: Local filesystem (`public/uploads/`) with Express static serving
- **Production**: **Google Cloud Storage** bucket with signed URLs

```
src/lib/storage/
├── local-storage.ts   # Dev: save to public/uploads/
├── gcs-storage.ts     # Prod: Google Cloud Storage SDK
├── index.ts           # Environment-aware factory
```

---

### Phase 5: GCP Production Architecture (Week 5–6)

```
┌──────────────────────────────────────────────────┐
│                  Google Cloud                      │
│                                                    │
│  ┌──────────────┐    ┌──────────────────────┐     │
│  │  Cloud Run    │───▶│  Cloud SQL            │    │
│  │  (Next.js)    │    │  (PostgreSQL 15)      │    │
│  └──────┬───────┘    └──────────────────────┘     │
│         │                                          │
│  ┌──────▼───────┐    ┌──────────────────────┐     │
│  │  Cloud Run    │    │  Cloud Storage        │    │
│  │  (Socket.io)  │    │  (Media/Avatars)      │    │
│  └──────────────┘    └──────────────────────┘     │
│                                                    │
│  ┌──────────────┐    ┌──────────────────────┐     │
│  │  Cloud        │    │  Secret Manager       │    │
│  │  Scheduler    │    │  (API Keys/Tokens)    │    │
│  └──────────────┘    └──────────────────────┘     │
└──────────────────────────────────────────────────┘
```

| GCP Service | Replaces | Purpose |
|---|---|---|
| **Cloud SQL** | Supabase PostgreSQL | Managed PostgreSQL with auto-backups |
| **Cloud Run** | Vercel/localhost | Containerized Next.js deployment |
| **Cloud Storage** | Supabase Storage | Media file hosting |
| **Cloud Scheduler** | Supabase cron | Automation/flow cron jobs |
| **Secret Manager** | `.env` files | Secure credential storage |
| **Cloud IAM** | Supabase RLS | Access control |

---

## 4. Risk Analysis

### 4.1 Critical Risks

> [!CAUTION]
> These risks can cause data loss or extended downtime if not mitigated.

| # | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **Data loss during schema migration** — Current 25-table schema maps to 8 tables. Column renaming/dropping could lose historical data. | High | Critical | Write reversible migration scripts. Dump full Supabase DB backup before starting. Run migration on a staging copy first. |
| R2 | **Authentication session invalidation** — Switching from Supabase GoTrue to NextAuth invalidates all existing user sessions simultaneously. | Certain | High | Coordinate a planned maintenance window. Notify all users. Pre-create NextAuth user records from Supabase `auth.users` export. |
| R3 | **RLS removal creates security holes** — Supabase RLS policies enforce row-level isolation. Removing them without application-level checks exposes all data to any authenticated user. | High | Critical | Audit every query. Add `WHERE user_id = ?` or middleware authorization checks before removing any RLS policy. Write integration tests for each endpoint. |

### 4.2 High Risks

> [!WARNING]
> These risks cause significant feature regression or development delays.

| # | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| R4 | **Realtime feature regression** — Supabase Realtime is deeply integrated (6 channels, ~15 subscription sites). Socket.io replacement may have latency/reliability differences. | High | High | Build Socket.io prototype early. Test under load. Keep Supabase Realtime as fallback during transition. |
| R5 | **139+ file refactor introduces bugs** — Touching every file in the codebase increases regression risk exponentially. | High | High | Refactor in vertical slices (one feature at a time). Maintain comprehensive test coverage. Use TypeScript strict mode to catch type mismatches. |
| R6 | **Scope underestimation** — Estimated 5–6 weeks may be optimistic for a solo developer or small team. Hidden complexity in webhook processing, broadcast engine, and automation engine. | Medium | High | Track velocity weekly. Cut scope to core messaging if behind schedule. Defer pipelines/deals/broadcasts to a later phase. |
| R7 | **Feature parity loss** — New 8-table schema drops: tags, custom_fields, pipelines, deals, broadcasts, automations, API keys, notifications, AI reply, knowledge base. | Certain | Medium | Document all dropped features. Confirm with stakeholders which are required for MVP. Plan re-implementation roadmap. |

### 4.3 Medium Risks

| # | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| R8 | **Local PostgreSQL environment inconsistency** — Developers may have different PG versions, extensions, or configurations. | Medium | Medium | Use Docker Compose for local dev (`docker-compose.yml` with PG 15 image). Pin exact version. |
| R9 | **GCP cost overruns** — Cloud SQL and Cloud Run costs are usage-based and can spike unexpectedly. | Low | Medium | Set billing alerts. Use Cloud SQL `db-f1-micro` for dev. Auto-scale Cloud Run with min instances = 0. |
| R10 | **Teacher Simulator breakage** — The standalone Vite simulator also uses Supabase client directly for auth and realtime. | Certain | Low | Refactor `teacher-simulator/src/lib/supabase.ts` to use the new auth and DB layer. |

---

## 5. Execution Checklist

- [ ] **Phase 0: Immediate Schema Setup (Day 1)**
  - [ ] Create `wacrm_dev` database on local PostgreSQL
  - [ ] Run `migrations/001_new_schema.sql` to create 8 tables
  - [ ] Verify all tables with `\dt`
  - [ ] Add `DATABASE_URL` to `.env.local`
  - [ ] Seed test data for smoke testing

- [ ] **Pre-flight (before Phase 1)**
  - [ ] Full Supabase database dump (`pg_dump`)
  - [ ] Export `auth.users` table to CSV
  - [ ] Document all active Supabase features in use

- [ ] **Phase 1: Database Code Refactor**
  - [ ] Initialize Prisma with `DATABASE_URL` pointing to local PG
  - [ ] Generate Prisma schema from existing tables (`prisma db pull`)
  - [ ] Build `src/lib/db/queries/` abstraction layer
  - [ ] Refactor all API routes (30 files)
  - [ ] Refactor all dashboard pages (10 files)
  - [ ] Refactor all components with direct DB access (20 files)

- [ ] **Phase 2: Authentication**
  - [ ] Install and configure NextAuth.js v5
  - [ ] Create `users` table and seed from Supabase export
  - [ ] Replace all `supabase.auth.*` calls (48 call sites)
  - [ ] Update middleware for route protection
  - [ ] Test login/signup/logout/password-reset flows

- [ ] **Phase 3: Realtime**
  - [ ] Set up Socket.io server
  - [ ] Implement PostgreSQL LISTEN/NOTIFY triggers
  - [ ] Create `useSocket` React hook
  - [ ] Replace all 6 Supabase Realtime channels
  - [ ] Load test WebSocket connections

- [ ] **Phase 4: Storage**
  - [ ] Implement local filesystem storage adapter
  - [ ] Implement Google Cloud Storage adapter
  - [ ] Refactor avatar and media upload components

- [ ] **Phase 5: GCP Deployment**
  - [ ] Containerize Next.js app (Dockerfile)
  - [ ] Provision Cloud SQL instance
  - [ ] Provision Cloud Storage bucket
  - [ ] Deploy to Cloud Run
  - [ ] Configure Cloud Scheduler for cron jobs
  - [ ] Move secrets to Secret Manager

- [ ] **Cleanup**
  - [ ] Remove `@supabase/ssr` and `@supabase/supabase-js` from `package.json`
  - [ ] Delete `src/lib/supabase/` directory
  - [ ] Delete `supabase/migrations/` directory
  - [ ] Update all documentation and README

---

## 6. Dropped Features (Requires Stakeholder Sign-off)

The new 8-table schema intentionally drops the following WACRM features. These must be explicitly approved for removal or scheduled for re-implementation:

| Feature | Current Tables | Status |
|---|---|---|
| Tags & Contact Tags | `tags`, `contact_tags` | ❌ Dropped |
| Custom Fields | `custom_fields`, `contact_custom_values` | ❌ Dropped |
| Pipelines & Deals | `pipelines`, `pipeline_stages`, `deals` | ❌ Dropped |
| Broadcasts | `broadcasts`, `broadcast_recipients` | ❌ Dropped |
| Automations | `automations`, `automation_logs` | ❌ Dropped |
| Message Templates | `message_templates` | ❌ Dropped |
| Notifications | `notifications` | ❌ Dropped |
| API Keys | `api_keys` | ❌ Dropped |
| AI Reply & Knowledge | `ai_configs`, `ai_knowledge` | ❌ Dropped |
| Webhook Endpoints | `webhook_endpoints` | ❌ Dropped |
| Multi-tenant Accounts | `accounts`, `account_invitations`, `profiles` | ❌ Dropped |
| Message Reactions | `message_reactions` | ❌ Dropped |
| WhatsApp Config | `whatsapp_config` | ⚠️ Moved to env vars |

---

## 7. Estimated Timeline

| Phase | Duration | Dependencies |
|---|---|---|
| **Phase 0: Schema Setup** | **1 day (immediate)** | **None** |
| Phase 1: Database Layer | 2 weeks | Phase 0 |
| Phase 2: Authentication | 1 week | Phase 1 |
| Phase 3: Realtime | 1 week | Phase 1 |
| Phase 4: Storage | 3 days | Phase 1 |
| Phase 5: GCP Deployment | 1 week | Phases 1–4 |
| Buffer & Testing | 1 week | All |
| **Total** | **~6 weeks** | |

> [!NOTE]
> Timeline assumes 1–2 developers working full-time. Phase 0 is designed to be executed immediately by the tech lead. A larger team can parallelize Phases 2, 3, and 4 after Phase 1 is stable.

