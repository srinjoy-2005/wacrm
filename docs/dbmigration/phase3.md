# Phase 3: Total Supabase Deprecation & Infrastructure Optimization

## Objective
Finalize the migration by completely removing the Supabase Client dependency across the entire codebase and moving all remaining infrastructure to GCP.

## Proposed Strategy
1. **Remove Supabase Client**: Strip out `@supabase/supabase-js` entirely. Delete `@/lib/supabase` utilities.
2. **Authentication Migration**: Replace Supabase Auth with a custom solution (e.g., NextAuth/Auth.js) or integrate directly with the new infrastructure context.
3. **Storage Migration**: Move media/storage buckets (e.g., `chat-media`) to Google Cloud Storage.
4. **Deploy to GCP**: Adjust the CI/CD pipeline and deployment config to run the Next.js app in Google Cloud Run.
5. **Code Cleanup**: Remove all unused Supabase-related environment variables and clean up obsolete code.
