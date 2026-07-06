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

5. **Start Dev Server**:
   ```bash
   npm install
   npm run dev
   ```

---

## 🧪 Testing the Simulator

### 1. Connecting a Mock WhatsApp Account
1. Open [http://localhost:3000](http://localhost:3000) and sign in/up.
2. Go to **Settings → WhatsApp**.
3. You will see a banner: `WhatsApp Simulator Mode Active`.
4. Enter any mock values:
   - **Phone Number ID**: e.g., `12345`
   - **WhatsApp Business Account ID**: e.g., `12345`
   - **Permanent Access Token**: e.g., `mock-token`
   - **Webhook Verify Token**: e.g., `my-token`
5. Click **Save Configuration**.
6. The status will update to **Credentials valid (Simulator)**.

### 2. Loading Mock Message Templates
1. Go to **Settings → WhatsApp Simulator**.
2. Click **Sync Mock Templates**.
3. Go to **Settings → Templates**. You will see two mock templates synced: `welcome_message` and `special_promotion`.

### 3. Simulating Inbound Customer Messages
1. Go to **Settings → WhatsApp Simulator**.
2. Choose **+ Create New Simulated Customer** under **Sender (Customer)**.
3. Fill in:
   - **Customer Name**: e.g., `Alice Miller`
   - **Phone Number**: e.g., `+12025550143`
4. Type a message body (e.g., `Hi, I am interested in your software!`) and click **Trigger Inbound Message**.
5. Go to the **Shared Inbox** page. You will see `Alice Miller`'s conversation is open, and her incoming message has arrived in real-time!

### 4. Replying & Simulating Delivery Statuses
1. Reply to Alice from the wacrm Inbox text composer (e.g., `Hi Alice, let me know how I can help!`).
2. Go to **Settings → WhatsApp Simulator**.
3. Under **Simulate Status Update**, you will see your reply message.
4. Select **read** or **delivered** status, and click **Simulate Status Transition**.
5. Back in the Inbox, you will see the checkmarks on your reply change to double blue (read status), showing real-time feedback.

---

## 📂 Code Modifications Summary

- **Webhook Signature Bypass** ([webhook-signature.ts](file:///home/iamsrinjoy/important-stuff/wacrm/src/lib/whatsapp/webhook-signature.ts)): Bypasses HMAC-SHA256 signature verification if `MOCK_WHATSAPP=true` is set.
- **Mock Meta API Calls** ([meta-api.ts](file:///home/iamsrinjoy/important-stuff/wacrm/src/lib/whatsapp/meta-api.ts)): Intercepts all outgoing calls to Graph API (send, registration, media download, template submit) and returns synthetic mock values.
- **Sync Mock Templates** ([sync/route.ts](file:///home/iamsrinjoy/important-stuff/wacrm/src/app/api/whatsapp/templates/sync/route.ts)): Generates and syncs mock template database rows locally instead of calling Meta.
- **Developer Simulator Component** ([developer-simulator.tsx](file:///home/iamsrinjoy/important-stuff/wacrm/src/components/settings/developer-simulator.tsx)): The dashboard UI control board for triggering webhook simulation.
