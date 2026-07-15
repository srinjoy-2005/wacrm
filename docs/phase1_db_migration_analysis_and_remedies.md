# WACRM Database Migration Analysis & GCP Transition Remedies

This document outlines the analysis of the Supabase migrations, query inconsistency risks, and solutions for migrating the database to GCP Cloud SQL using Drizzle ORM.

---

## 1. Schema Inconsistencies & Query Risks

Below are the key architectural vulnerabilities in the current database design and how they impact query execution:

### A. RLS Policy Overhead (`is_account_member`)
*   **The Risk**: The current Supabase database enforces multi-tenancy RLS using a custom SQL function `is_account_member(account_id)`. Because this function is defined as `SECURITY DEFINER`, PostgreSQL **cannot inline** it during query planning. 
*   **Impact**: In complex joins (e.g. loading contacts, conversations, and messages together), the planner is forced to run the function as a subquery for every candidate row. This leads to sequential table scans, high CPU load, and query timeouts.
*   **Remedy**: 
    1.  **Application-Layer Tenancy (Recommended)**: Disable RLS and enforce tenant-scoping in the API routes using `eq(table.accountId, currentAccountId)` filters on all database queries.
    2.  **Session Variable RLS (Fallback)**: If DB-level RLS is required, set a session variable (`SET LOCAL app.current_account_id = '...'`) during each database transaction, and update the RLS policies to check the variable directly: `WHERE account_id = current_setting('app.current_account_id')::uuid`.

---

### B. Trigger-based Auth Provisioning Failures (`handle_new_user`)
*   **The Risk**: Supabase signups trigger a `handle_new_user()` function to bootstrap accounts and profiles. Any error during profile creation is caught and silenced to avoid failing the signup transaction:
    ```sql
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
      RETURN NEW;
    ```
*   **Impact**: Users can exist in `auth.users` without a workspace `account` or a `profile`. Subsequent API calls fail silently or return empty arrays because policies and queries fail to resolve the member’s workspace.
*   **Remedy**: Move account and profile bootstrapping into a Next.js Server Action or API handler inside a database transaction. If the database transaction fails, rollback the auth creation in GCP Identity Platform/Firebase Auth.

---

### C. Contact Merge & Orphaned Active Sessions
*   **The Risk**: The merge contact procedure (`merge_duplicate_contacts`) updates only inactive sessions for merged contacts to prevent violating `idx_one_active_session_per_contact` (`UNIQUE(account_id, contact_id) WHERE status = 'active'`). 
*   **Impact**: When the duplicate contact is deleted, the active session's foreign key sets the `contact_id` to `NULL` (due to `ON DELETE SET NULL`). This leaves orphaned active sessions running in the system without an associated contact.
*   **Remedy**: Update the merge routine to terminate/archive the loser's active session if the survivor already has one active. Otherwise, update the loser's active session to point to the survivor:
    ```sql
    -- Close duplicate active sessions for the loser contacts
    UPDATE sessions SET status = 'completed'
    WHERE contact_id = ANY(v_losers) AND status = 'active'
      AND EXISTS (SELECT 1 FROM sessions WHERE contact_id = v_survivor AND status = 'active');

    -- Safe to update remaining active sessions of the losers to the survivor
    UPDATE sessions SET contact_id = v_survivor
    WHERE contact_id = ANY(v_losers) AND status = 'active';
    ```

---

## 2. Drizzle Integration Architecture

In this architecture, database management is divided across the following files:

```
wacrm/
├── drizzle.config.ts          # Drizzle Kit CLI Configuration
├── drizzle/                   # Generated SQL Migrations Folder
│   ├── 0000_xxxxx.sql         # Migration steps
│   └── meta/                  # Migration history metadata
└── src/
    └── db/
        ├── index.ts           # Client initialization & connection pool
        └── schema.ts          # Core TypeScript schema definitions
```

### A. Drizzle Config (`drizzle.config.ts`)
Tells the Drizzle CLI where to find schemas, where to write migration files, and how to connect to the database:
```typescript
import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

### B. TypeScript Schema (`src/db/schema.ts`)
The source of truth for the PostgreSQL structure on the application layer. Declares tables, columns, references, and constraints in type-safe TypeScript:
```typescript
import { pgTable, uuid, text, timestamp, pgEnum } from 'drizzle-orm/pg-core';

export const messageStatusEnum = pgEnum('message_status', ['sending', 'sent', 'delivered', 'read', 'failed']);

export const accounts = pgTable('accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  ownerUserId: uuid('owner_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
```

### C. Database Client (`src/db/index.ts`)
Initializes the database connection pool. Disables SQL prefetching (`prepare: false`) to avoid connection exhaustion under transaction poolers (such as PgBouncer, Supavisor, or GCP Cloud SQL Auth Proxy):
```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

export const client = postgres(connectionString, { prepare: false });
export const db = drizzle(client, { schema });
```

---

## 3. Step-by-Step GCP Database Migration Workflow

When transitioning to GCP Cloud SQL:
1.  **Spin up Cloud SQL**: Provision a PostgreSQL instance in GCP. Set up a Private IP (VPC Peering) or use Cloud SQL Auth Proxy for secure connection without exposing public IPs.
2.  **Export/Import Data**: Use `pg_dump` on the temporary database to dump schemas and records, and `pg_restore` (or import via GCP console) to write them to Cloud SQL.
3.  **Deploy Schema Updates**: Run `npx drizzle-kit migrate` (or run a pipeline step in Google Cloud Build) to apply any schema updates to Cloud SQL.
4.  **Set App Environment**: Store the connection string in GCP Secret Manager and pass it to Cloud Run as `DATABASE_URL`.
