database schema sync with design docs

-   upload mock data
-   testing with wacrm

make eval doc:

-   features present
-   to make - know from design doc
-   conclusion - risks

put separate interface for user message simulation at a new port - test with wacrm

~run db schema acc to ER diagram with local psql not supabase~

DECISION (2026-07-11): Keep Supabase, self-host it via Docker instead of replacing it.

-   Old plan (supabase\_to\_postgres\_migration.md) is ON HOLD — too many Supabase deps (30 migrations, 45+ files, 4 subsystems)
-   New plan: docs/self\_hosted\_supabase\_migration.md — just change 3 env vars
-   Pending stakeholder review of risks before proceeding
-   migrations/001\_new\_schema.sql is OBSOLETE (was the 8-table scope-reduced schema) — DO NOT USE

Gotta try the migratoin one step at a time

-   first replace the database from supa to psql
-   for now other supabase dependencies keep using api
-   for the orm use Drizzle

IMPORTANT: check current database schema - where it differs from wacrm default

TODO: consider consequences and DB migration structures before pushing nigrations to replace supabase - IMP

-   for now, the wacrm api allows all origins (I just updated the WACRM backend to allow CORS requests to /api/v1/\* so your Simulator can successfully connect to it. Specifically, I:

Updated next.config.ts to include Access-Control-Allow-Origin: \* and related headers for all /api/\* routes.)  
 **should consder replacing that to some domains**


PENDING
- The Database Migration (Currently In Progress)
- currently the automations have several options(like changing contacts, sending webhooks) which havent been functional from backend gotta complete
- API security (later)


