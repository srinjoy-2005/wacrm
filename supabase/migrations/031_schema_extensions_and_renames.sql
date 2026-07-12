-- ============================================================
-- 031_schema_extensions_and_renames.sql
--
-- Extending the schema to align with the new ER diagram while
-- preserving existing Supabase functionality.
--
-- 1. Extend contacts: add segment, preferred_language
-- 2. Extend messages: add transcript
-- 3. Create delivery_logs table
-- 4. Rename tags -> collections, contact_tags -> collection_members
-- 5. Rename flow_runs -> sessions, flow_run_events -> session_events
-- 6. Update dependent functions (merge_duplicate_contacts, filter_contacts)
-- ============================================================

-- 1) Contacts extensions
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS segment TEXT,
  ADD COLUMN IF NOT EXISTS preferred_language TEXT DEFAULT 'en';

-- 2) Messages extensions
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS transcript TEXT;

-- 3) Delivery logs table
CREATE TABLE IF NOT EXISTS delivery_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_logs_message_id ON delivery_logs(message_id);

ALTER TABLE delivery_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view delivery logs" ON delivery_logs FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = delivery_logs.message_id AND is_account_member(c.account_id)
  )
);
-- Note: the service role handles insertions for delivery logs, same as messages.

-- 4) Rename tags -> collections and contact_tags -> collection_members
ALTER TABLE IF EXISTS tags RENAME TO collections;
ALTER TABLE IF EXISTS contact_tags RENAME TO collection_members;
ALTER TABLE IF EXISTS collection_members RENAME COLUMN tag_id TO collection_id;

ALTER POLICY IF EXISTS "Users can manage own tags" ON collections RENAME TO "Users can manage own collections";
ALTER POLICY IF EXISTS "Users can manage contact tags" ON collection_members RENAME TO "Users can manage collection members";

ALTER INDEX IF EXISTS idx_contact_tags_contact RENAME TO idx_collection_members_contact;
ALTER INDEX IF EXISTS idx_contact_tags_tag RENAME TO idx_collection_members_collection;

-- 5) Rename flow_runs -> sessions and flow_run_events -> session_events
ALTER TABLE IF EXISTS flow_runs RENAME TO sessions;
ALTER TABLE IF EXISTS flow_run_events RENAME TO session_events;
ALTER TABLE IF EXISTS session_events RENAME COLUMN flow_run_id TO session_id;

ALTER POLICY IF EXISTS "Users see own flow runs" ON sessions RENAME TO "Users see own sessions";
ALTER POLICY IF EXISTS "flow_runs_select" ON sessions RENAME TO "sessions_select";

ALTER POLICY IF EXISTS "Users see events on their runs" ON session_events RENAME TO "Users see events on their sessions";
ALTER POLICY IF EXISTS "flow_run_events_select" ON session_events RENAME TO "session_events_select";

ALTER INDEX IF EXISTS idx_one_active_run_per_contact RENAME TO idx_one_active_session_per_contact;
ALTER INDEX IF EXISTS idx_flow_runs_active_advanced RENAME TO idx_sessions_active_advanced;
ALTER INDEX IF EXISTS idx_flow_runs_flow_started RENAME TO idx_sessions_flow_started;
ALTER INDEX IF EXISTS idx_flow_runs_account RENAME TO idx_sessions_account;
ALTER INDEX IF EXISTS idx_flow_run_events_run_type RENAME TO idx_session_events_session_type;
ALTER INDEX IF EXISTS idx_flow_run_events_run_time RENAME TO idx_session_events_session_time;

-- Update Realtime publication
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'flow_runs') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE flow_runs;
    ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
  END IF;
END $$;


-- 6) Drop and Recreate dependent RPCs

-- filter_contacts_by_collections (formerly filter_contacts_by_tags)
DROP FUNCTION IF EXISTS public.filter_contacts_by_tags(UUID[], TEXT, INT, INT);

CREATE OR REPLACE FUNCTION public.filter_contacts_by_collections(
  p_collection_ids UUID[],
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (contact contacts, total_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $func$
  WITH matched AS (
    SELECT DISTINCT c.id, c.created_at
    FROM contacts c
    JOIN collection_members cm ON cm.contact_id = c.id
    WHERE cm.collection_id = ANY(p_collection_ids)
      AND (
        p_search IS NULL
        OR c.name ILIKE '%' || p_search || '%'
        OR c.phone ILIKE '%' || p_search || '%'
        OR c.email ILIKE '%' || p_search || '%'
      )
  ),
  page AS (
    SELECT id, count(*) OVER() AS total_count
    FROM matched
    ORDER BY created_at DESC, id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT c AS contact, page.total_count
  FROM page
  JOIN contacts c ON c.id = page.id
  ORDER BY c.created_at DESC, c.id;
$func$;

ALTER FUNCTION public.filter_contacts_by_collections(UUID[], TEXT, INT, INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts_by_collections(UUID[], TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_contacts_by_collections(UUID[], TEXT, INT, INT) TO authenticated;

-- merge_duplicate_contacts
CREATE OR REPLACE FUNCTION public.merge_duplicate_contacts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_group   RECORD;
  v_survivor UUID;
  v_losers   UUID[];
  v_merged   INTEGER := 0;
BEGIN
  FOR v_group IN
    SELECT account_id,
           phone_normalized,
           array_agg(id ORDER BY created_at ASC, id ASC) AS ids
    FROM contacts
    WHERE phone_normalized <> ''
    GROUP BY account_id, phone_normalized
    HAVING count(*) > 1
  LOOP
    v_survivor := v_group.ids[1];
    v_losers   := v_group.ids[2:array_length(v_group.ids, 1)];

    UPDATE conversations                 SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE contact_notes                 SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE deals                         SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE broadcast_recipients          SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE automation_logs               SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE automation_pending_executions SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);

    -- conflict-guarded re-point for UNIQUE(contact_id, collection_id)
    UPDATE collection_members cm SET contact_id = v_survivor
      WHERE cm.contact_id = ANY(v_losers)
        AND NOT EXISTS (
          SELECT 1 FROM collection_members s
          WHERE s.contact_id = v_survivor AND s.collection_id = cm.collection_id
        );
    DELETE FROM collection_members WHERE contact_id = ANY(v_losers);

    -- custom values
    UPDATE contact_custom_values cv SET contact_id = v_survivor
      WHERE cv.contact_id = ANY(v_losers)
        AND NOT EXISTS (
          SELECT 1 FROM contact_custom_values s
          WHERE s.contact_id = v_survivor AND s.custom_field_id = cv.custom_field_id
        );
    DELETE FROM contact_custom_values WHERE contact_id = ANY(v_losers);

    -- sessions (formerly flow_runs)
    UPDATE sessions SET contact_id = v_survivor
      WHERE contact_id = ANY(v_losers) AND status <> 'active';

    DELETE FROM contacts WHERE id = ANY(v_losers);

    v_merged := v_merged + COALESCE(array_length(v_losers, 1), 0);
  END LOOP;

  RETURN v_merged;
END;
$func$;
