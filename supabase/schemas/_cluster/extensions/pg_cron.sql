-- Runs the every-minute job sweep. Created by migration
-- 20261019031544_enable_pg_cron with IF NOT EXISTS, because the shared project
-- already ships it.
CREATE EXTENSION "pg_cron" SCHEMA "pg_catalog";
