CREATE TRIGGER "jobs_wake_worker"
AFTER INSERT ON "app"."jobs"
REFERENCING NEW TABLE AS "inserted_jobs"
FOR EACH STATEMENT
EXECUTE FUNCTION "app"."wake_worker"();
