# Phase 2: Other Entities Migration

## Objective
Migrate the remaining entities (Contacts, Tags, Teams, and internal user states) from Supabase Realtime/Fetch to Drizzle & Server Actions.

## Proposed Strategy
1. **Drizzle Schema Completion**: Ensure schemas for `contacts`, `tags`, `teams`, `profiles`, and `accounts` are fully accurately mapped.
2. **Contact Actions**: 
   - Create Server Actions in `src/app/actions/contacts.ts` for fetching, creating, updating, and deleting contacts.
   - Refactor contact sidebar and contact listing UI to use these Server Actions.
3. **Tags & Teams**: 
   - Migrate tag management UI to use Drizzle-based Server Actions.
   - Migrate team management (if any UI exists) to Drizzle.
4. **Auth & Profiles**: 
   - Ensure profile updates bypass Supabase data client, directly updating Neon.
5. **Component Updates**: Verify all components interacting with these entities use standard polling or Server Actions instead of `useRealtime` or `supabase.from()`.
