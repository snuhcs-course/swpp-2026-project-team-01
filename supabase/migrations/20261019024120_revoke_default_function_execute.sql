-- PostgreSQL grants EXECUTE on every new function to PUBLIC, which `anon` and
-- `authenticated` inherit. A per-schema default cannot remove a global grant, and
-- pg-delta does not diff global default privileges, so this is hand-written and
-- mirrored in supabase/schemas/_custom/ for later syncs.
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
