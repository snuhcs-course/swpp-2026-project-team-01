-- Offline-authored coverage; run against a disposable local stack after the
-- migration chain is explicitly permitted to be applied.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);
select has_table('app', 'host_assistant_context', 'private account context exists');
select hasnt_column('app', 'imessage_bindings', 'selected_request_id', 'requests no longer route account messages');
select ok((select relrowsecurity from pg_class where oid = 'app.host_assistant_context'::regclass), 'context has RLS');
select ok(not has_table_privilege('authenticated', 'app.host_assistant_context', 'SELECT'), 'authenticated cannot read private context');
select ok(not has_table_privilege('anon', 'app.host_assistant_context', 'SELECT'), 'anonymous cannot read private context');
insert into app.host_accounts(id) values ('00000000-0000-4000-8000-000000000ad1');
insert into app.host_assistant_context(host_account_id, scope_key, kind, entry_key, content, operation_id, confirmed, expires_at)
values ('00000000-0000-4000-8000-000000000ad1', 'scope', 'memory', 'dated', '{"text":"exams"}', 'save-dated', true, now() - interval '1 second');
select throws_ok($$insert into app.host_assistant_context(host_account_id, scope_key, kind, entry_key, operation_id)
values ('00000000-0000-4000-8000-000000000ad1', 'scope', 'memory', 'dated', 'replay')$$, '23505', null, 'entry identity deduplicates writes');
select throws_ok($$update app.host_assistant_context set revision = 0$$, '23514', null, 'revision must stay positive');
do $$ begin perform * from app.cleanup_retained_records(10); end $$;
select is((select content::text from app.host_assistant_context where entry_key = 'dated'), '{}', 'expiry clears private text');
select ok((select forgotten_at is not null from app.host_assistant_context where entry_key = 'dated'), 'expiry keeps a replay tombstone');
do $$ begin perform * from app.operator_delete_host('00000000-0000-4000-8000-000000000ad1', 'test', 'account-context test', 'local'); end $$;
select is((select count(*) from app.host_assistant_context where host_account_id = '00000000-0000-4000-8000-000000000ad1'), 0::bigint, 'account deletion removes private context despite account tombstone');
select * from finish();
rollback;
