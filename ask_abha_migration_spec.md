# Technical Migration Specification: WACRM to AskAbha v2

This document details the features to be implemented and changed in the **wacrm** codebase to support the migration of the **AskAbha v2** teacher-support platform from Glific.

---

## 1. Architectural Strategy: AS-IS (WACRM) vs. TO-BE (AskAbha v2)

The AskAbha v2 design mandates migrating from a SaaS/Supabase stack to a self-hosted GCP-native stack, using wacrm as a stripped-down codebase baseline.

| Architectural Layer | WACRM (AS-IS) | AskAbha v2 (TO-BE) | Impact / Action Required |
| :--- | :--- | :--- | :--- |
| **Cloud Provider** | Independent / Vercel | **Google Cloud Platform (GCP)** | Deploy Next.js on Cloud Run, static assets on Firebase Hosting. |
| **Database** | Supabase (Postgres + RLS) | **Cloud SQL (Postgres)** | Remove Supabase Client SDK; replace with direct Drizzle ORM connecting to Cloud SQL via Private IP. |
| **Authentication** | Supabase Auth (OTP/Email) | **GCP Identity Platform** | Remove Supabase Auth; implement Microsoft Entra ID (M365 SSO) + Email/Password fallback. |
| **File Storage** | Supabase Storage | **Google Cloud Storage (GCS)** | Replace bucket operations with `@google-cloud/storage` SDK using short-TTL signed URLs. |
| **Realtime Sync** | Supabase Realtime Channels | **Firestore** (V1.5) / **5s Polling** (V1) | Strip Supabase realtime listeners; fallback to HTTP short polling for v1 Inbox. |
| **Tenancy** | Multi-Tenant (Workspaces) | **Single-Tenant (AskAbha Org)** | Collapse database schema and UI by removing account sharing, workspace dropdowns, and RLS rules. |

---

## 2. New Features to be Implemented

The following components do not exist in WACRM and must be built from scratch.

### 2.1 Flow Engine (Python / FastAPI Service)
*   **Purpose**: A separate FastAPI service (`/apps/flow-engine`) running Python 3.12 to orchestrate chatbot conversation flows and session states.
*   **Key Requirements**:
    *   **Linear Step-Runner**: Reads session state $\rightarrow$ executes active node $\rightarrow$ saves position $\rightarrow$ pauses or advances.
    *   **Session Management**: Cloud SQL `sessions` table (containing `contact_id`, `flow_id`, `current_node_id`, and `state` JSONB).
    *   **Translation Handling**: Language selection via interactive buttons on first contact. Flow text stored as a language map (e.g. `{bn: "...", en: "..."}`) and selected at runtime using the contact's `preferred_language`.
    *   **API Interface**: Endpoints `/v1/process`, `/v1/narrow/step`, and `/resume/{request_id}` for communication with the Next.js messaging service.

### 2.2 Connector Registry & Webhook Nodes
*   **Purpose**: A plug-and-play integration framework for Google Cloud Functions (CF1: Media fetch, CF2: Bhashini ASR, CF3: Resolver, Gemma VM).
*   **Key Requirements**:
    *   `connectors` Database Table: Defines external integrations.
    *   **Sync Mode**: Direct HTTP POST and wait (<5s timeout).
    *   **Async Mode**: Fire HTTP POST $\rightarrow$ CF returns immediate ACK $\rightarrow$ background processing runs $\rightarrow$ CF calls `/resume/{request_id}` callback to resume flow.
    *   **Variable Referencing**: Store webhook response payloads as `@results.<node_name>.<key>` for downstream node evaluation.
    *   **Node Test Panel**: "Test this CF" button inside the Flow Builder configuration panel.

### 2.3 End-to-End `request_id` Tracing & Analytics
*   **Purpose**: End-to-end request tracing and structured analytical export.
*   **Key Requirements**:
    *   Mint a unique `request_id` at the inbound Meta webhook handler.
    *   Thread the `request_id` through internal HTTP calls, Pub/Sub events, and Cloud Functions.
    *   Emit structured JSON logs containing: `request_id`, `contact_id`, `segment`, `language`, `stage`, `path` (skip or Gemma), `prefilter_gap`, `activity_id`, `latency_ms`, and `error`.
    *   Export data: Continuous Cloud Logging $\rightarrow$ BigQuery sink, and nightly scheduled incremental exports of Postgres tables to BigQuery.

---

## 3. Features to be Changed / Modified

Existing WACRM features must be altered to support the AskAbha v2 specifications.

### 3.1 Inbox & Dashboard UI Changes
*   **Authentication & Login**:
    *   Replace Supabase login components with Firebase Auth/GCP Identity Platform widgets.
    *   Configure Microsoft 365 SSO callback handler.
    *   Implement app-layer check to restrict access to logged-in staff only (collapsing DB-level RLS).
*   **Inbox Interface (v1 vs v1.5)**:
    *   **v1 (Monitor-only)**: Render conversations list and transcripts. Strip the composer panel (view only). Set messages list to HTTP poll every ~5 seconds.
    *   **v1.5 (Reply)**: Integrate composer panel back using Firestore for realtime synchronization.
*   **Teachers (Contacts) Database**:
    *   Add segment-based search and filtering.
    *   Implement **CSV Import/Export** for batch contact creation.
    *   **DPDP Compliance Tools**:
        *   Implement **Right to Erasure** button: Purges a teacher's PII + conversation history (allowing only anonymous aggregates to survive).
        *   Enforce voice recording privacy: Transcribe audio to text via CF2, store the transcript in the message body, and delete raw audio media objects.

### 3.2 Meta Cloud API & Compliance Layer
*   **Direct Meta Integration**: Bypass any third-party BSP wrappers in the codebase; route directly to the standard Meta Graph API endpoints.
*   **Compliance Middleware**:
    *   **Opt-in/Opt-out Tracker**: Prevent sending messages if the contact field is opted-out. Auto-opt-out contacts when they message the keyword `STOP`.
    *   **24-Hour Rule**: Check the timestamp of the last customer-initiated inbound message. Block outgoing free-form texts if outside the window, requiring a Meta-approved Template.
    *   **Quality-Tier Monitor**: Build alerting hooks to notify administrators if the phone number quality rating drops.

### 3.3 Flow Builder Canvas (v1.5)
*   **State Migration**:
    *   Migrate WACRM's flow editor backend from Supabase to write JSON schemas into Cloud SQL.
    *   Configure Node Palette in Flow Canvas to support the custom AskAbha nodes:
        *   *Trigger* (first-contact, keyword, event)
        *   *Send Message* (multilingual render)
        *   *Interactive* (menus/lists)
        *   *Send Media* (GCS signed URL handler)
        *   *Wait for Reply* (branch logic)
        *   *Condition* (if/else)
        *   *Set Variable*
        *   *Call Webhook* (connector triggers)
        *   *Loop / Retry*
        *   *Jump / Goto*

---

## 4. Key Engineering Risks & Mitigations

### 4.1 Underestimating the Data-Layer Rebuild (Medium Likelihood, High Impact)
*   **Risk**: WACRM is built around Supabase's client-side SDK and Row-Level Security (RLS) policies. Replacing it with Drizzle ORM and direct Cloud SQL Postgres connections means the entire authentication, session validation, and database querying layers must be rewritten.
*   **Mitigation**: Front-load this during Phase 1. Isolate the data layer behind a repository pattern so that changes to SQL schemas do not leak into the UI components.

### 4.2 Security Vulnerabilities via RLS Deletion (Low Likelihood, Critical Impact)
*   **Risk**: In WACRM, data boundaries are guaranteed at the database level using Supabase RLS. Moving auth checks entirely to the application server layer (Next.js middleware and route handlers) means a single missing check on an API endpoint could expose teacher or student records.
*   **Mitigation**: Implement automated integration tests checking for authorization checks on all API endpoints. Use wrapper middlewares for role validation (`admin`, `editor`, `viewer`) on the FastAPI and Next.js routers.

### 4.3 Out-of-Order Message Processing in Async Mode (Medium Likelihood, Medium Impact)
*   **Risk**: Heavy Cloud Functions (ASR transcription, Gemma VM evaluation) process asynchronously via Pub/Sub. If a user sends multiple messages rapidly, a race condition could occur where the second message initiates a step before the first message's async handler calls `/resume` to update the flow state, corrupting the session.
*   **Mitigation**: Implement database-level optimistic locking or a queue processing mechanism on active sessions. If a session is in `awaiting_callback` status, buffer incoming customer webhooks until the lock is released or the callback resumes.

### 4.4 GCS URL Expiration during Meta Delivery Delays (Low Likelihood, Medium Impact)
*   **Risk**: Files (audio/PDF) are served via GCS signed URLs with a short Time-To-Live (TTL) for security. If Meta Graph API encounters rate-limiting or retry delays when fetching the media asset from the signed URL, the URL may expire before Meta caches it, resulting in failed deliveries.
*   **Mitigation**: Set a reasonable buffer for GCS signed URLs (e.g. 15-30 minutes) and handle Meta webhook delivery failure codes (e.g., retrying the send with a refreshed URL if the delivery status returns `failed`).

