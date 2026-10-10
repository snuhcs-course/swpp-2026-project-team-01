import {z} from 'zod';

// Disposable browser fixtures only. Scope every delete to this fixture host;
// callers must stop application/runtime workers before invoking cleanup.
export function cleanupBrowserHostSql(host:string,request:string,invitationId:string,contact:string){
 const cleanupId=z.uuid().parse(host),requestId=z.uuid().parse(request),invitation=z.uuid().parse(invitationId);
 const email=z.email().parse(contact).replaceAll("'","''");
 return `set session_replication_role=replica;
delete from fmat.audit_events where subject_id in(select id::text from fmat.oauth_exchanges where actor->>'id'='${cleanupId}' or actor->>'requestId'='${requestId}');
delete from fmat.oauth_exchanges where actor->>'id'='${cleanupId}' or actor->>'requestId'='${requestId}';
delete from fmat.conversation_model_receipts where conversation_id in(select id from fmat.conversation_scopes where host_id='${cleanupId}');
delete from fmat.conversation_model_usage where conversation_id in(select id from fmat.conversation_scopes where host_id='${cleanupId}');
delete from fmat.runtime_messages where conversation_id in(select id from fmat.conversation_scopes where host_id='${cleanupId}');
delete from fmat.conversation_grants where conversation_id in(select id from fmat.conversation_scopes where host_id='${cleanupId}');
delete from fmat.conversation_generations where conversation_id in(select id from fmat.conversation_scopes where host_id='${cleanupId}');
delete from fmat.conversation_scopes where host_id='${cleanupId}';
delete from fmat.request_closures where request_id in(select id from fmat.requests where host_id='${cleanupId}');
delete from fmat.request_history where request_id in(select id from fmat.requests where host_id='${cleanupId}');
delete from fmat.idempotency where actor_scope in(select 'guest:'||token_hash from fmat.requests where host_id='${cleanupId}');
delete from fmat.calendar_connections where principal_id='${requestId}';
delete from fmat.audit_events where subject_id in(select id::text from fmat.requests where host_id='${cleanupId}');
delete from fmat.idempotency where operation='request_create' and input->>'handle'='browser-'||left('${cleanupId}',8);
update fmat.requests set candidate_publication_id=null where host_id='${cleanupId}';
delete from fmat.proposal_evidence where request_id in(select id from fmat.requests where host_id='${cleanupId}');
delete from fmat.proposals where request_id in(select id from fmat.requests where host_id='${cleanupId}');
delete from fmat.candidate_publications where request_id in(select id from fmat.requests where host_id='${cleanupId}');
delete from fmat.candidate_rankings where request_id in(select id from fmat.requests where host_id='${cleanupId}');
delete from fmat.private_review_checks where request_id in(select id from fmat.requests where host_id='${cleanupId}');
delete from fmat.preference_decisions where request_id in(select id from fmat.requests where host_id='${cleanupId}');
delete from fmat.travel_allowances where request_id in(select id from fmat.requests where host_id='${cleanupId}');
delete from fmat.candidate_evaluations where request_id in(select id from fmat.requests where host_id='${cleanupId}');
-- Replica mode skips the request FK's ON DELETE CASCADE. Explicitly remove
-- pending/applied revisions before their request and host, including on failure.
delete from fmat.host_revision_drafts where host_id='${cleanupId}';
delete from fmat.requests where host_id='${cleanupId}';
delete from fmat.idempotency where actor_scope='host:${cleanupId}' or input->>'email'='${email}';
delete from fmat.audit_events where subject_id in ('${cleanupId}','${invitation}');
delete from fmat.calendar_connections where principal_id in ('${cleanupId}','${requestId}');
set session_replication_role=origin;
delete from fmat.hosts where id='${cleanupId}';
delete from fmat.invitations where id='${invitation}';
delete from fmat.waitlist where email='${email}';
`;
}
