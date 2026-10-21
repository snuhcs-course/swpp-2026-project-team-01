-- Conversation admission budgets (design decision 14), one row per scope, scope
-- key and window kind. A window starts at the first accepted message after the
-- previous one expired, and count is the messages accepted in it. scope_key is
-- the host account, request or intake ID, or 'service'. Rows are locked in a
-- fixed order: the discussion's own scope first, then service.
CREATE TABLE "app"."admission_windows" (
  "scope" text NOT NULL CHECK ("scope" IN ('host', 'request', 'intake', 'service')),
  "scope_key" text NOT NULL,
  "window_kind" text NOT NULL CHECK ("window_kind" IN ('minute', 'hour')),
  "window_start" timestamptz NOT NULL,
  "count" integer NOT NULL DEFAULT 0 CHECK ("count" >= 0),
  PRIMARY KEY ("scope", "scope_key", "window_kind")
);

ALTER TABLE "app"."admission_windows" ENABLE ROW LEVEL SECURITY;
