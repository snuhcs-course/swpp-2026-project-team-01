ALTER TABLE app.host_accounts
  ADD COLUMN accepting_requests boolean NOT NULL DEFAULT true,
  ADD COLUMN intake_revision integer NOT NULL DEFAULT 0;
