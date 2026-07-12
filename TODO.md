database schema sync with design docs

- upload mock data 
- testing with wacrm 

make eval doc:
- features present
- to make - know from design doc
- conclusion - risks

put separate interface for user message simulation at a new port - test with wacrm

~~run db schema acc to ER diagram with local psql not supabase~~

DECISION (2026-07-11): Keep Supabase, self-host it via Docker instead of replacing it.
- Old plan (supabase_to_postgres_migration.md) is ON HOLD — too many Supabase deps (30 migrations, 45+ files, 4 subsystems)
- New plan: docs/self_hosted_supabase_migration.md — just change 3 env vars
- Pending stakeholder review of risks before proceeding
- migrations/001_new_schema.sql is OBSOLETE (was the 8-table scope-reduced schema) — DO NOT USE