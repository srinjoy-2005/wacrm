-- ============================================================
-- WACRM New Schema — 001_new_schema.sql
-- 
-- Clean-slate 8-table schema replacing the old Supabase-backed
-- 25+ table design. No RLS policies, no auth.users references.
--
-- Tables: contacts, conversations, messages, delivery_log,
--         flows, sessions, collections, collection_members
--
-- Idempotent — safe to run multiple times (uses IF NOT EXISTS).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- CONTACTS
-- ============================================================
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone TEXT NOT NULL UNIQUE,
  name TEXT,
  segment TEXT,
  preferred_language TEXT DEFAULT 'en',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CONVERSATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open',
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conversations_contact ON conversations(contact_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);

-- ============================================================
-- MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body TEXT,
  transcript TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'sent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

-- ============================================================
-- DELIVERY_LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS delivery_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_delivery_log_message ON delivery_log(message_id);

-- ============================================================
-- FLOWS
-- ============================================================
CREATE TABLE IF NOT EXISTS flows (
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
CREATE INDEX IF NOT EXISTS idx_flows_status ON flows(status);

-- ============================================================
-- SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  state TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_contact ON sessions(contact_id);
CREATE INDEX IF NOT EXISTS idx_sessions_flow ON sessions(flow_id);

-- ============================================================
-- COLLECTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS collections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- COLLECTION_MEMBERS (Many-to-Many: Contacts <-> Collections)
-- ============================================================
CREATE TABLE IF NOT EXISTS collection_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(collection_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_collection_members_collection ON collection_members(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_members_contact ON collection_members(contact_id);
