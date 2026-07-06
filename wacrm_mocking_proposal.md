# Technical Proposal: Local WhatsApp Mocking & Simulation Framework for wacrm

## Executive Summary

To enable local developer onboarding, testing, and customization of the **wacrm** open-source WhatsApp CRM without requiring active Meta Cloud API keys, we have designed and implemented a **Local Mocking and Simulation Layer**. 

By introducing a single toggle (`MOCK_WHATSAPP=true`), developers can completely bypass external Meta API requests while retaining the full functionality of the shared inbox, CRM contacts database, pipelines, automations, templates, and flows. This architecture allows developers to build, test, and validate features locally with zero external network dependencies or billing risks.

---

## Architectural Design

The mocking layer intercepts the standard data flow at three critical junctions:

```mermaid
graph TD
    subgraph Client Panel (Browser)
        A[Shared Inbox & Settings] -->|API Requests| B[Next.js Server API Routes]
        H[WhatsApp Simulator Panel] -->|Local Webhook Trigger| G[Local Webhook Endpoint]
    end
    
    subgraph Next.js Backend
        B -->|Config & Sending| C{MOCK_WHATSAPP?}
        C -->|true| D[Mock Layer: return static/logs]
        C -->|false| E[Meta Graph API]
        G -->|Signature Check Bypass| F[Inbound Msg Processing]
    end
    
    subgraph Database
        F -->|Realtime Update| I[Supabase DB]
        D -->|Sync/Submit| I
    end
```

### 1. Environment Variable Control (`.env.local`)
A new environment flag controls the mode toggle:
- `MOCK_WHATSAPP=true` activates the interceptor code across the codebase.
- `META_APP_SECRET=mock-secret` (or any string) satisfies configuration checks without verifying real hashes.

---

## Detailed Code Modifications

### 1. Webhook Signature Bypass
*   **File**: `src/lib/whatsapp/webhook-signature.ts`
*   **Change**: Intercepted `verifyMetaWebhookSignature`. When `MOCK_WHATSAPP=true` is enabled, the function returns `true` immediately.
*   **Impact**: Developers can simulate inbound webhook requests using local browser tools (like curl or our simulator panel) without needing to compute cryptographic HMAC-SHA256 signatures matching an active Meta App Secret.

### 2. Meta Graph API Mocking Layer
*   **File**: `src/lib/whatsapp/meta-api.ts`
*   **Change**: Intercepted 16 outbound integration helper functions (including `verifyPhoneNumber`, `registerPhoneNumber`, `sendTextMessage`, `sendTemplateMessage`, `sendInteractiveButtons`, etc.). 
*   **Impact**:
    *   **Outgoing messages** (text, media, buttons, templates) print to the server terminal console (`[Mock WhatsApp Send]...`) and return a synthetic `mock-wamid-<uuid>` message ID.
    *   **Credentials validation** returns success with mock metadata (`+1 555-555-5555`, name: `Mock WhatsApp Local`).
    *   **Media uploads & downloads** bypass Graph CDN calls and return synthetic buffers and handles.

### 3. Database Sync & Submission Overrides
*   **Files**: 
    *   `src/app/api/whatsapp/templates/sync/route.ts`
    *   `src/app/api/whatsapp/templates/submit/route.ts`
    *   `src/app/api/whatsapp/config/route.ts`
*   **Change**: 
    *   The **Sync** endpoint generates and inserts two mock templates (`welcome_message` and `special_promotion`) to local Supabase database instead of querying Meta.
    *   The **Submit** endpoint automatically dry-runs and mock-approves any newly created templates.
    *   The **Config** GET handler returns an `is_mock: true` flag in its JSON response.

### 4. Interactive WhatsApp Simulator UI Panel
*   **Files**:
    *   `src/components/settings/settings-sections.ts`
    *   `src/app/(dashboard)/settings/page.tsx`
    *   `src/components/settings/developer-simulator.tsx` (New)
*   **Description**: A premium, high-contrast console tab called **WhatsApp Simulator** added to settings. It allows the developer to:
    *   **Simulate Inbound Messages**: Choose an existing customer from Supabase or create a new one, choose text or button replies, and send.
    *   **Simulate Delivery Status Updates**: Select any sent agent reply and trigger transitions (`delivered`, `read`, `failed`).
    *   **Sync Mock Templates**: Populate local database schemas with mock templates in one click.
    *   **Live Payload Terminal**: Includes a dedicated console showing the raw JSON payload posted to the local webhook, serving as reference documentation.

---

## Testing & Verification Workflows

Developers can verify the CRM end-to-end using the following local flow:

1.  **Mock Setup**: Click **Test API Connection** in Settings -> WhatsApp. The UI confirms connection with a 'simulated success' toast and a 'simulator active' banner.
2.  **Inbound Flow**: Simulate a text message from a client in the Simulator. The message propagates through the local `/api/whatsapp/webhook` route and updates the **Shared Inbox** instantly via Supabase Realtime Channels.
3.  **Outbound Flow**: Reply to the customer from the Shared Inbox composer. The console logs the outbound request, returning a simulated message ID.
4.  **Status Flow**: Choose the replied message in the Simulator and trigger `read` status. The checkmarks on the message bubble in the inbox turn blue in real-time.

---

## Extending the Mock Layer

To add new mock behaviors (e.g. simulating catalog templates or location sharing):
1.  Add mock schemas in `src/components/settings/developer-simulator.tsx` inside the payload building functions.
2.  Add payload processors in `src/app/api/whatsapp/webhook/route.ts` inside `parseMessageContent` or `processMessage` to handle custom payload fields.
