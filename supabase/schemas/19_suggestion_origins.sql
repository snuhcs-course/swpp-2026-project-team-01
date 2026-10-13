alter table fmat.setup_drafts add column origins jsonb not null default '{}' check(jsonb_typeof(origins)='object');
