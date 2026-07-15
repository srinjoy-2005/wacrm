# Phase 1 Migration Log (July 15)

## 1. Database Schema Status

You asked to check the current database schema defined in your external Neon database and how it differs from the WACRM default.

**Finding:**
I introspected your Neon database (`DATABASE_URL` in `.env.local`), and it is **completely empty** (0 tables fetched). 

**What about `migrations/001_new_schema.sql`?**
This file (the 8-table reduced schema) was an older local attempt that you marked as OBSOLETE in your `TODO.md`. Since it is obsolete and the Neon DB is empty, we will indeed use the **31 Supabase migrations** (`supabase/migrations/`) as the true source of truth.

**The catch with the 31 Supabase migrations:**
We cannot run those raw SQL files directly on Neon because they contain foreign key constraints pointing to `auth.users` and `storage.objects`. Neon doesn't have Supabase's internal `auth` schema.

**The Solution:**
Instead of running SQL, I will manually build the Drizzle schema (`src/db/schema.ts`) using the TypeScript types from `src/types/index.ts`. This gives us the exact "wacrm default" schema, but without the strict cross-schema foreign key constraints that would break on a standard Postgres database.

## 2. Progress Tracker

### Setup
- [x] Install Drizzle ORM and Postgres driver
- [x] Configure `drizzle.config.ts`
- [x] Create `src/db/index.ts` (Database client initialization)
- [x] Create `src/db/schema.ts` (Initial core tables: accounts, profiles, contacts, collections, collection_members)

### Iterative Rewrite Phases (Pending)
We will rewrite the app incrementally. After I finish a section, I will pause so you can manually test it before moving on.

1. [ ] **Contacts & Profiles**
   - API: `/api/v1/contacts`
   - API: `/api/account`
2. [ ] **Conversations & Messages**
3. [ ] **Flows & Automations**
4. [ ] **Broadcasts & Templates**
5. [ ] **Other Metadata**
