alter table fmat.setup_conversations add column analysis_decided boolean not null default false;
alter table fmat.setup_conversations add column dismissed_suggestions text[] not null default '{}' check(dismissed_suggestions<@array['schedule','mode']);
