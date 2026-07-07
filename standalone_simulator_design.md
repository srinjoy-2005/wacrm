# Technical Specification: Standalone WhatsApp User Simulator

This document details the architectural design, security constraints, and integration details for the standalone **WhatsApp User/Teacher Simulator** built to enable local, offline end-to-end testing of the CRM platform.

---

## 1. Design Choice & Rationales

To mock and test the CRM messaging workflows, we chose **Option A: A Standalone Vite + React Single-Page Application (SPA)** running on a dedicated port (`3001`).

```
+----------------------------+            +----------------------------+
|         WACRM CRM          |            |  WhatsApp User Simulator   |
|   Next.js App (Port 3000)  |            |   Vite React (Port 3001)   |
|                            |            |                            |
|   Staff Dashboard View     |            |   Mock Customer Chat UI    |
+--------------+-------------+            +-------------+--------------+
               |                                        |
               |                                        |
               v                                        v
      [Next.js Server API]                     [Supabase DB / Realtime]
               |                                        |
               +-------------------+--------------------+
                                   |
                                   v
                             [Supabase DB]
```

### Key Rationale
1.  **Logical Decoupling**: Separates staff-facing CRM administration panels from customer-facing WhatsApp messaging simulation.
2.  **Performance & Developer Velocity**: Built using Vite + TypeScript, which leverages native ES modules for near-instantaneous hot-module replacement (HMR) and startup times (<100ms).
3.  **Cross-Origin Communication**: Simulator triggers inbound webhooks by sending HTTP POST payloads directly to WACRM’s local endpoint: `http://localhost:3000/api/whatsapp/webhook`.
4.  **CORS & OPTIONS Handling**: We added an `OPTIONS` route preflight handler and corresponding Access-Control headers inside `/api/whatsapp/webhook` to support cross-origin webhook dispatch safely in local development.

---

## 2. Authentication, Browser Isolation & Database Security

### 2.1 Browser Origin Isolation
Browser security models isolate storage (Cookies, LocalStorage, IndexedDB) by origin (`protocol + host + port`). 
Because the simulator runs on port `3001` and WACRM runs on port `3000`, the browser treats them as completely distinct origins and isolates their authentication states. 

Therefore, a staff user logged into WACRM on port `3000` will start as unauthenticated when they open port `3001`.

### 2.2 Row-Level Security (RLS) & Profile Scoping
WACRM relies on **Supabase Row-Level Security (RLS)** policies to isolate data. Database tables like `contacts` and `messages` are locked down; data is queried using the client-side session token of the authenticated staff member.

*   **Auth requirement**: To query contacts or subscribe to real-time chat updates on port `3001`, the simulator requires the user to log in once using their standard WACRM credentials.
*   **Scoped Profiles Access**: Because the simulator client logs in with the staff member's profile credentials, **the simulator gets access to the exact same database contacts and conversations owned by that staff account**. 
*   This ensures that any test contact (simulated teacher/parent) created inside the simulator immediately maps to the active staff account's inbox on port `3000` without data leaks or cross-tenant contamination.

### 2.3 Real-Time Sync via Supabase WebSockets
Instead of simple HTTP polling, the simulator establishes a direct WebSocket connection via Supabase Client:
*   It subscribes to `messages` INSERT events filtered by the current `conversation_id`.
*   When a staff user sends a reply from WACRM (port 3000), Supabase publishes the insert event. The simulator (port 3001) catches it and pushes the chat bubble onto the UI in real-time.
*   It also subscribes to UPDATE events on `messages` to dynamically update message delivery checkmarks (sent, delivered, read) inside the phone mockup.

---

## 3. Setup and Execution

### 3.1 Dependencies
*   `concurrently`: Runs the Next.js server and Vite dev server in parallel.
*   `@supabase/supabase-js`: Interacts with database tables and listens to Realtime WebSockets.
*   `tailwindcss` & `@tailwindcss/vite`: Tailwind CSS v4 styling compiler.

### 3.2 Concurrent Server Execution
To simplify local developer onboarding, we configured a monorepo-style dev script in the root `package.json`:

```bash
npm run dev:all
```

Under the hood, this script runs:
`concurrently -k -n "wacrm,simulator" -c "blue,magenta" "npm run dev" "npm run dev:simulator"`

This command spins up the Next.js server on `http://localhost:3000` and the Vite React simulator on `http://localhost:3001` concurrently in a single terminal window, piping both outputs side-by-side with color prefixes.
