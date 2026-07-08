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

Viewed tsconfig.json:18-35
Ran command: `git status`
Ran command: `git commit`
Ran command: `git commit -m "fixed mocker ui, still got problem with message sending, messages sent dont show up, anther problem with invalid phone number in wacrm needs to fixed by removing any check for invalid phone number during mock stage"`
Ran command: `git push`
Ran command: `npm run dev:all`

The `teacher-simulator` **is actually given the Supabase API keys automatically!** It reads them directly from the main project's `.env.local` file.

Here is how the magic works behind the scenes in the configuration we set up:

### 1. The Vite Configuration (`vite.config.ts`)
In [vite.config.ts](file:///home/iamsrinjoy/important-stuff/wacrm/teacher-simulator/vite.config.ts), we added two key settings:
```typescript
  envDir: '../',
  envPrefix: 'NEXT_PUBLIC_',
```
*   `envDir: '../'`: Tells Vite that the environment variables file (`.env.local`) is located one level up in the parent directory (the root project folder).
*   `envPrefix: 'NEXT_PUBLIC_'`: Tells Vite that it is allowed to expose any environment variables starting with `NEXT_PUBLIC_` to the frontend bundle. (Normally, Vite restricts access to variables that do not start with `VITE_`).

### 2. The Supabase Client (`src/lib/supabase.ts`)
In [supabase.ts](file:///home/iamsrinjoy/important-stuff/wacrm/teacher-simulator/src/lib/supabase.ts), the Supabase client loads these shared variables directly using Vite's environment metadata:
```typescript
const supabaseUrl = import.meta.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
```

So the simulator inherits your credentials dynamically from the parent project. You don't have to duplicate, copy/paste, or maintain a separate `.env` file inside the simulator folder!

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
