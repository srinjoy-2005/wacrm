# Walkthrough: Local WhatsApp Mock Mode & Simulator

To run wacrm locally and test its inbox, automations, pipelines, and template flows without real Meta WhatsApp API keys, we have built a **WhatsApp Mock and Simulator environment**. This document outlines how you and your team can get started.

---

## ⚙️ How to Configure Mock Mode

1. **Create Environment File**:
   Copy `.env.local.example` to `.env.local` in the project root:
   ```bash
   cp .env.local.example .env.local
   ```

2. **Generate Encryption Key**:
   Run this in your terminal to generate a 32-byte key:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Paste the generated string into your `.env.local` under `ENCRYPTION_KEY`.

3. **Set Supabase Credentials**:
   Wacrm requires a Supabase database instance to work. You can create a free project at [supabase.com](https://supabase.com) in 2 minutes, and find these values in **Project Settings → API**:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-public-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```
   > [!IMPORTANT]
   > Make sure to run the Supabase database migrations inside the `supabase/migrations/` folder on your Supabase dashboard SQL editor or via the Supabase CLI, so all tables and RLS rules are correctly initialized.

4. **Enable Simulator Mode**:
   Add this env var to your `.env.local`:
   ```env
   MOCK_WHATSAPP=true
   ```
   Also add a placeholder app secret (e.g. `mock-secret`) to satisfy the webhook verification config:
   ```env
   META_APP_SECRET=mock-secret
   ```

5. **Start Both Dev Servers**:
   Run the concurrent dev command to spin up WACRM (port 3000) and the Teacher Simulator (port 3001) in parallel:
   ```bash
   npm install
   npm run dev:all
   ```

---

## 🧪 Testing the Simulator

You have two choices for simulating user actions: the integrated settings page dashboard or the new standalone mobile simulator.

### A. Using the Standalone User Simulator (Port 3001)
The standalone React/Vite application simulates a WhatsApp mobile chat screen representing the customer's phone:
1. Open **[http://localhost:3001](http://localhost:3001)**.
2. **Authenticate**: Log in using your Supabase account credentials (the same email/password you used to sign up on WACRM) to authorize the database connection.
3. **Select/Create Profile**: In the left sidebar, select a contact profile (e.g. `Alice Miller`) or click `+` to register a new one.
4. **Chat**:
   - Type a message in the text box inside the simulated phone mockup and click **Send**. The message will post to the webhook and appear in WACRM's Inbox on port 3000.
   - Reply to the customer from the WACRM inbox. The reply will pop up instantly on the simulated phone screen on port 3001 via Supabase Realtime!
   - Tap interactive reply buttons under incoming messages to simulate button replies.
5. **Logs Inspector**: Inspect raw JSON payloads being dispatched and their response codes in the right-hand **Event Logs** sidebar.

### B. Using the Integrated Settings Panel (Port 3000)
1. Go to **Settings → WhatsApp Simulator**.
2. **Sync Templates**: Click **Sync Mock Templates** to load templates into the database.
3. **Simulate Inbound**: Choose a simulated customer, type a text body, and click **Trigger Inbound Message**.
4. **Simulate Status Updates**: Select any sent agent reply, choose a status (`delivered`, `read`), and click **Simulate Status Transition**.

---

## 📂 Code Modifications Summary

- **Webhook Signature Bypass** ([webhook-signature.ts](file:///home/iamsrinjoy/important-stuff/wacrm/src/lib/whatsapp/webhook-signature.ts)): Bypasses HMAC-SHA256 signature verification if `MOCK_WHATSAPP=true` is set.
- **Webhook CORS & OPTIONS Handler** ([route.ts (webhook)](file:///home/iamsrinjoy/important-stuff/wacrm/src/app/api/whatsapp/webhook/route.ts)): Added OPTIONS method handler and POST CORS response headers to support cross-origin webhook calls from the port 3001 simulator.
- **Mock Meta API Calls** ([meta-api.ts](file:///home/iamsrinjoy/important-stuff/wacrm/src/lib/whatsapp/meta-api.ts)): Intercepts all outgoing calls to Graph API (send, registration, media download, template submit) and returns synthetic mock values.
- **Sync Mock Templates** ([sync/route.ts](file:///home/iamsrinjoy/important-stuff/wacrm/src/app/api/whatsapp/templates/sync/route.ts)): Generates and syncs mock template database rows locally instead of calling Meta.
- **Developer Simulator Component** ([developer-simulator.tsx](file:///home/iamsrinjoy/important-stuff/wacrm/src/components/settings/developer-simulator.tsx)): The dashboard UI control board inside settings.
- **Standalone WhatsApp Simulator** ([App.tsx](file:///home/iamsrinjoy/important-stuff/wacrm/teacher-simulator/src/App.tsx)): Standalone mobile sandbox running on port 3001.
