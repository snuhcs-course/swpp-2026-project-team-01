-- Private application schema. The server connects as `postgres`, which owns every
-- object here. The Data API does not expose it, and no client role may use it.
CREATE SCHEMA "app" AUTHORIZATION "postgres";

REVOKE ALL ON SCHEMA "app" FROM PUBLIC;
