-- Mirrors migration 20261019024120_revoke_default_function_execute, which pg-delta
-- does not generate, so declarative syncs see the same function privileges.
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
