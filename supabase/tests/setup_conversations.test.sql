begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create temporary table setup_fixture(name text primary key,value jsonb not null);
insert into setup_fixture values
 ('host','{"kind":"host","id":"00000000-0000-4000-8000-000000000071","email":"setup@example.com"}'),
 ('other','{"kind":"host","id":"00000000-0000-4000-8000-000000000072","email":"other-setup@example.com"}'),
 ('worker','{"kind":"worker","id":"setup-bridge"}'),
 ('operator','{"kind":"operator","id":"setup-test"}'),
 ('rules','{"timezone":"Asia/Seoul","durationMinutes":30,"availability":[{"days":[1,2,3,4,5],"start":"09:00","end":"17:00"}],"focusBlocks":[],"bufferMinutes":15,"travelMode":"TRANSIT","preferences":"Private preference"}'),
 ('channel','{"provider":"imessage","senderId":"+821012345678","privateConversationId":"private-channel","isGroup":false}');
create function pg_temp.item(n text) returns jsonb language sql as $$select value from setup_fixture where name=n$$;
create function pg_temp.cmd(op text,who text,input jsonb default '{}') returns jsonb language sql as $$
 select case when who='operator' and op='invite_issue' then public.fmat_invitation_operator('issue',pg_temp.item(who)->>'id',jsonb_build_object('project','local','email',input->>'email','tokenHash',input->>'tokenHash','delivery','manual','origin','http://localhost:3000','idempotencyKey',gen_random_uuid())) when who='operator' and op='invite_revoke' then public.fmat_invitation_operator('revoke',pg_temp.item(who)->>'id',jsonb_build_object('project','local','invitationId',input->>'invitationId','idempotencyKey',gen_random_uuid())) else public.fmat_command(op,pg_temp.item(who),input||jsonb_build_object('idempotencyKey',gen_random_uuid()::text)) end
$$;
select ok(not has_table_privilege('authenticated','fmat.setup_turns','SELECT'),'authenticated clients cannot query private setup turns');
select ok(not has_table_privilege('anon','fmat.setup_drafts','SELECT'),'public clients cannot query private drafts');
select ok(not has_table_privilege('service_role','fmat.setup_channel_challenges','SELECT'),'even service role uses audited command surface');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('fmat.setup_conversations'::regclass,'fmat.setup_turns'::regclass,'fmat.setup_drafts'::regclass,'fmat.setup_reviews'::regclass,'fmat.setup_link_continuations'::regclass,'fmat.setup_channel_challenges'::regclass,'fmat.setup_channel_links'::regclass,'fmat.setup_provider_inbound'::regclass,'fmat.setup_provider_outbound'::regclass,'fmat.setup_bridge_checkpoints'::regclass)),'all conversation and provider tables enable RLS');
select throws_ok($$select pg_temp.cmd('setup_conversation_read','other')$$,'P0001','HOST_NOT_ADMITTED','unadmitted accounts cannot create conversations');
select pg_temp.cmd('invite_issue','operator',jsonb_build_object('email','setup@example.com','tokenHash',repeat('7',64),'expiresAt',now()+interval '1 day'));
select pg_temp.cmd('invite_redeem','host',jsonb_build_object('tokenHash',repeat('7',64)));
insert into setup_fixture values('initial',pg_temp.cmd('setup_conversation_read','host'));
select is((pg_temp.item('initial')->>'revision')::integer,0,'conversation starts at revision zero');
select is(jsonb_array_length(pg_temp.item('initial')->'turns'),0,'conversation initially empty');
select is(pg_temp.cmd('setup_conversation_read','host')->>'id',pg_temp.item('initial')->>'id','refresh resumes same conversation');
select throws_ok($$select public.fmat_command('setup_conversation_read','{"kind":"public"}','{}')$$,'P0001','FORBIDDEN','public clients cannot read host private state');
insert into setup_fixture values('partial',pg_temp.cmd('setup_turn_append','host',jsonb_build_object('expectedRevision',0,'clientTurnId','00000000-0000-4000-8000-000000000081','channel','web','text','Call me Setup Host','assistantText','I will prepare your settings.','extraction',jsonb_build_object('patch',jsonb_build_object('displayName','Setup Host')))));
select is((pg_temp.item('partial')->>'revision')::integer,1,'host turn and assistant saved atomically in one revision');
select is(jsonb_array_length(pg_temp.item('partial')->'turns'),2,'both turn roles durable');
select is(pg_temp.item('partial')->'review','null'::jsonb,'incomplete settings remain draft without a review');
select ok((select rules is null from fmat.hosts where id=(pg_temp.item('host')->>'id')::uuid),'draft extraction does not alter confirmed rules');
select throws_ok($$select pg_temp.cmd('setup_turn_append','host','{"expectedRevision":0,"clientTurnId":"00000000-0000-4000-8000-000000000082","channel":"web","text":"Stale turn"}')$$,'P0001','CONVERSATION_STALE','stale concurrent turn cannot overwrite draft');
insert into setup_fixture values('review',pg_temp.cmd('setup_turn_append','host',jsonb_build_object('expectedRevision',1,'clientTurnId','00000000-0000-4000-8000-000000000083','channel','web','text','Use weekday rules','assistantText','Review these settings before saving.','extraction',jsonb_build_object('patch',jsonb_build_object('handle','setup-host','rules',pg_temp.item('rules'))))));
select is(pg_temp.item('review')->'review'->>'status','pending','complete draft produces exact current review');
select is(pg_temp.item('review')->'review'->'settings'->>'displayName','Setup Host','draft merges previously gathered fields');
select throws_ok($$select pg_temp.cmd('setup_review_confirm','host','{"expectedRevision":2,"reviewRevision":1,"expectedDraftRevision":1,"expectedRulesVersion":0}')$$,'P0001','DRAFT_STALE','confirmation binds exact draft revision');
select throws_ok($$select pg_temp.cmd('setup_review_confirm','host','{"expectedRevision":2,"reviewRevision":1,"expectedDraftRevision":2,"expectedRulesVersion":9}')$$,'P0001','RULES_STALE','confirmation binds confirmed rules version');
insert into setup_fixture values('confirmed',pg_temp.cmd('setup_review_confirm','host','{"expectedRevision":2,"reviewRevision":1,"expectedDraftRevision":2,"expectedRulesVersion":0}'));
select is(pg_temp.item('confirmed')->'review'->>'status','confirmed','explicit confirmation marks review confirmed');
select is((select rules_version from fmat.hosts where id=(pg_temp.item('host')->>'id')::uuid),1,'explicit confirmation uses existing setup_save rules version');
select is((select rules from fmat.hosts where id=(pg_temp.item('host')->>'id')::uuid),pg_temp.item('rules'),'only reviewed rules become confirmed');
select is(pg_temp.cmd('setup_turn_lookup','host','{"clientTurnId":"00000000-0000-4000-8000-000000000083","channel":"web","text":"Use weekday rules"}'),pg_temp.item('review'),'turn retry retrieves original result snapshot despite later confirmation');
select throws_ok($$select pg_temp.cmd('setup_turn_lookup','host','{"clientTurnId":"00000000-0000-4000-8000-000000000083","channel":"web","text":"Changed text"}')$$,'P0001','IDEMPOTENCY_CONFLICT','same turn identity cannot replay different content');
insert into setup_fixture values('ambiguous',pg_temp.cmd('setup_turn_append','host',jsonb_build_object('expectedRevision',3,'clientTurnId','00000000-0000-4000-8000-000000000084','channel','web','text','Prefer late afternoons','extraction',jsonb_build_object('patch','{}'::jsonb,'ambiguousFields',jsonb_build_array('availability')))));
select is(pg_temp.item('ambiguous')->'draft'->'unresolved','["availability"]'::jsonb,'ambiguous extraction keeps unresolved fields durable');
select is(pg_temp.item('ambiguous')->'review'->>'status','confirmed','ambiguous new draft cannot create a pending review');
select throws_ok($$select pg_temp.cmd('setup_review_confirm','host','{"expectedRevision":4,"reviewRevision":1,"expectedDraftRevision":3,"expectedRulesVersion":1}')$$,'P0001','REVIEW_STALE','previous confirmed review cannot authorize new draft');
select throws_ok($$select pg_temp.cmd('setup_channel_authorize','worker',pg_temp.item('channel'))$$,'P0001','LINK_NOT_FOUND','unlinked private sender has no host authority');
insert into setup_fixture values('challenge',pg_temp.cmd('setup_link_challenge_start','host',jsonb_build_object('challengeSecretHash',repeat('a',64),'browserProofHash',repeat('b',64))));
select is(pg_temp.cmd('setup_conversation_read','host')->'linkChallenge'->>'method','link','legacy inbound challenge remains a link proof');
select throws_ok($$select pg_temp.cmd('setup_link_confirm','host',jsonb_build_object('challengeId',pg_temp.item('challenge')->>'challengeId','browserProofHash',repeat('b',64)))$$,'P0001','CHALLENGE_INVALID','browser confirmation requires fresh private sender proof');
select throws_ok($$select pg_temp.cmd('setup_link_challenge_claim','worker',pg_temp.item('channel')||jsonb_build_object('challengeId',pg_temp.item('challenge')->>'challengeId','challengeSecretHash',repeat('a',64),'isGroup',true))$$,'P0001','FORBIDDEN','group conversation cannot claim host link');
select throws_ok($$select pg_temp.cmd('setup_link_challenge_claim','worker',pg_temp.item('channel')||jsonb_build_object('challengeId',pg_temp.item('challenge')->>'challengeId','challengeSecretHash',repeat('f',64)))$$,'P0001','CHALLENGE_INVALID','wrong code cannot claim private link');
select lives_ok($$select pg_temp.cmd('setup_link_challenge_claim','worker',pg_temp.item('channel')||jsonb_build_object('challengeId',pg_temp.item('challenge')->>'challengeId','challengeSecretHash',repeat('a',64)))$$,'exact private sender claims proof once');
select is(pg_temp.cmd('setup_conversation_read','host')->'linkChallenge'->>'maskedSender','+8…78','browser sees masked observed private sender');
select throws_ok($$select pg_temp.cmd('setup_link_confirm','host',jsonb_build_object('challengeId',pg_temp.item('challenge')->>'challengeId','browserProofHash',repeat('f',64)))$$,'P0001','CHALLENGE_INVALID','different browser proof cannot confirm link');
insert into setup_fixture values('linked',pg_temp.cmd('setup_link_confirm','host',jsonb_build_object('challengeId',pg_temp.item('challenge')->>'challengeId','browserProofHash',repeat('b',64))));
select is(pg_temp.cmd('setup_channel_authorize','worker',pg_temp.item('channel'))->>'hostId',pg_temp.item('host')->>'id','only linked private channel derives host');
select throws_ok($$select pg_temp.cmd('setup_channel_authorize','worker',pg_temp.item('channel')||'{"privateConversationId":"different"}'::jsonb)$$,'P0001','LINK_NOT_FOUND','private conversation binding cannot change');
select is(pg_temp.cmd('setup_conversation_read','worker',pg_temp.item('channel'))->>'id',pg_temp.item('initial')->>'id','linked channel resumes the same website conversation');
insert into setup_fixture values('inbound',pg_temp.cmd('setup_provider_inbound_record','worker',pg_temp.item('channel')||jsonb_build_object('providerMessageId','provider-message-1','occurredAt','2026-10-05T06:00:00Z','text','Set buffer to twenty minutes')));
select is((pg_temp.cmd('setup_provider_inbound_record','worker',pg_temp.item('channel')||jsonb_build_object('providerMessageId','provider-message-1','occurredAt','2026-10-05T06:00:00Z','text','Set buffer to twenty minutes'))->>'duplicate')::boolean,true,'duplicate provider event reuses durable inbound');
select throws_ok($$select pg_temp.cmd('setup_provider_outbound_prepare','worker',jsonb_build_object('inboundId',pg_temp.item('inbound')->>'inboundId','clientMessageId','00000000-0000-4000-8000-000000000091','text','Not yet processed'))$$,'P0001','INBOUND_NOT_PROCESSED','no reply can dispatch before inbound is durably processed');
insert into setup_fixture values('privateReview',pg_temp.cmd('setup_turn_append','worker',pg_temp.item('channel')||jsonb_build_object('expectedRevision',4,'clientTurnId','00000000-0000-4000-8000-000000000085','channel','imessage','providerMessageId','provider-message-1','text','Set buffer to twenty minutes','assistantText','Review buffer twenty minutes.','extraction',jsonb_build_object('patch',jsonb_build_object('rules',jsonb_build_object('bufferMinutes',20))))));
select is(pg_temp.item('privateReview')->'review'->>'status','pending','private channel creates review without silently saving');
select is(pg_temp.cmd('setup_provider_inbound_record','worker',pg_temp.item('channel')||jsonb_build_object('providerMessageId','provider-message-1','occurredAt','2026-10-05T06:00:00Z','text','Set buffer to twenty minutes'))->'result',pg_temp.item('privateReview'),'crash after private turn commit recovers exact original result before outbox preparation');
select ok((select processed_at is not null from fmat.setup_provider_inbound where id=(pg_temp.item('inbound')->>'inboundId')::uuid),'private turn commit marks durable inbound processed');
insert into setup_fixture values('outbound',pg_temp.cmd('setup_provider_outbound_prepare','worker',jsonb_build_object('inboundId',pg_temp.item('inbound')->>'inboundId','clientMessageId','00000000-0000-4000-8000-000000000091','text','Review buffer twenty minutes.')));
insert into setup_fixture values('dispatch',pg_temp.cmd('setup_provider_outbound_claim','worker','{"provider":"imessage"}'));
select is(pg_temp.item('dispatch')->>'action','dispatch','first claim authorizes one dispatch');
select is((select status from fmat.setup_provider_outbound where id=(pg_temp.item('outbound')->>'outboundId')::uuid),'uncertain','dispatch attempt fenced before provider send');
select is(pg_temp.cmd('setup_provider_outbound_claim','worker','{"provider":"imessage"}')->>'action','none','retry cannot immediately dispatch an attempted intent');
update fmat.setup_provider_outbound set updated_at=now()-interval '31 seconds' where id=(pg_temp.item('dispatch')->>'intentId')::uuid;
select is(pg_temp.cmd('setup_provider_outbound_claim','worker','{"provider":"imessage"}')->>'action','reconcile','restart reconciles an attempted intent and never authorizes a second send');
select is(pg_temp.cmd('setup_provider_outbound_authorize','worker',jsonb_build_object('intentId',pg_temp.item('dispatch')->>'intentId'))->>'action','reconcile','pre-send authority check retains stable intent');
select is(pg_temp.cmd('setup_provider_outbound_record','worker',jsonb_build_object('intentId',pg_temp.item('dispatch')->>'intentId','outcome','accepted','providerReference','provider-reply-1'))->>'status','accepted','first successful acknowledgement persists after uncertain send fence');
select is(pg_temp.cmd('setup_provider_outbound_claim','worker','{"provider":"imessage"}')->>'action','none','accepted provider reply is never redispatched');
select pg_temp.cmd('setup_provider_inbound_record','worker',pg_temp.item('channel')||jsonb_build_object('providerMessageId','provider-message-2','occurredAt','2026-10-05T06:01:00Z','text','CONFIRM 2'));
select lives_ok($$select pg_temp.cmd('setup_review_confirm','worker',pg_temp.item('channel')||jsonb_build_object('providerMessageId','provider-message-2','expectedRevision',5,'reviewRevision',2,'expectedDraftRevision',4,'expectedRulesVersion',1))$$,'bound private explicit current confirmation uses existing save guard');
select ok((select processed_at is not null from fmat.setup_provider_inbound where provider_message_id='provider-message-2'),'private confirmation records inbound before reply preparation');
select is((select result->'review'->>'status' from fmat.setup_provider_inbound where provider_message_id='provider-message-2'),'confirmed','crash after private confirmation recovers exact confirmation result');
select is((select (rules->>'bufferMinutes')::integer from fmat.hosts where id=(pg_temp.item('host')->>'id')::uuid),20,'private confirmed rule applies exactly reviewed setting');
select pg_temp.cmd('setup_provider_inbound_record','worker',pg_temp.item('channel')||jsonb_build_object('providerMessageId','provider-message-3','occurredAt','2026-10-05T06:02:00Z','text','One more turn'));
select pg_temp.cmd('setup_turn_append','worker',pg_temp.item('channel')||jsonb_build_object('providerMessageId','provider-message-3','expectedRevision',6,'clientTurnId','00000000-0000-4000-8000-000000000086','channel','imessage','text','One more turn','assistantText','Saved your conversation.'));
insert into setup_fixture values('queued',pg_temp.cmd('setup_provider_outbound_prepare','worker',jsonb_build_object('inboundId',(select id::text from fmat.setup_provider_inbound where provider_message_id='provider-message-3'),'clientMessageId','00000000-0000-4000-8000-000000000092','text','Saved your conversation.')));
select pg_temp.cmd('setup_link_unlink','host',jsonb_build_object('linkId',pg_temp.item('linked')->'channelLink'->>'id'));
select is(pg_temp.cmd('setup_provider_outbound_claim','worker','{"provider":"imessage"}')->>'action','none','unlink immediately removes queued send authority');
select is(pg_temp.cmd('setup_provider_outbound_record','worker',jsonb_build_object('intentId',pg_temp.item('queued')->>'outboundId','outcome','revoked'))->>'status','revoked','revoked intent cancellation persists without regaining private authority');
select throws_ok($$select pg_temp.cmd('setup_provider_outbound_prepare','worker',jsonb_build_object('inboundId',(select id::text from fmat.setup_provider_inbound where provider_message_id='provider-message-3'),'clientMessageId','00000000-0000-4000-8000-000000000092','text','Saved your conversation.'))$$,'P0001','LINK_NOT_FOUND','unlink blocks even repeat preparation of durable reply');
select throws_ok($$select pg_temp.cmd('setup_provider_outbound_authorize','worker',jsonb_build_object('intentId',pg_temp.item('queued')->>'outboundId'))$$,'P0001','LINK_NOT_FOUND','unlink blocks final send authorization');
select throws_ok($$select pg_temp.cmd('setup_conversation_read','worker',pg_temp.item('channel'))$$,'P0001','LINK_NOT_FOUND','unlinked channel cannot read private state');
select is(pg_temp.cmd('setup_conversation_read','host')->'channelLink','null'::jsonb,'website retains conversation after unlink');
-- Browser-started OTP sends exactly one six-digit code to the intended private recipient.
update fmat.setup_channel_challenges set created_at=now()-interval '2 minutes',expires_at=now()+interval '8 minutes' where host_id=(pg_temp.item('host')->>'id')::uuid;
insert into setup_fixture values('otpChallenge',pg_temp.cmd('setup_link_challenge_start','host',jsonb_build_object(
  'method','otp','challengeId','00000000-0000-4000-8000-000000000101','recipientId','+821025742625',
  'challengeSecretHash',repeat('1',64),'browserProofHash',repeat('2',64),
  'clientMessageId','00000000-0000-4000-8000-000000000102','replyText','Find Me a Time code: 123456')));
select is(pg_temp.item('otpChallenge')->>'method','otp','browser can start an outbound OTP challenge');
select is(pg_temp.cmd('setup_link_challenge_start','host',jsonb_build_object(
  'method','otp','challengeId','00000000-0000-4000-8000-000000000101','recipientId','+821025742625',
  'challengeSecretHash',repeat('1',64),'browserProofHash',repeat('2',64),
  'clientMessageId','00000000-0000-4000-8000-000000000102','replyText','Find Me a Time code: 123456'))->>'challengeId',pg_temp.item('otpChallenge')->>'challengeId','exact OTP start retry returns the original challenge before rate limiting');
select is((select count(*)::text from fmat.setup_provider_outbound where challenge_id=(pg_temp.item('otpChallenge')->>'challengeId')::uuid),'1','exact OTP start retry does not duplicate the provider send');
select throws_ok($$select pg_temp.cmd('setup_link_challenge_start','host',jsonb_build_object(
  'method','otp','challengeId','00000000-0000-4000-8000-000000000101','recipientId','+821025742625',
  'challengeSecretHash',repeat('1',64),'browserProofHash',repeat('2',64),
  'clientMessageId','00000000-0000-4000-8000-000000000102','replyText','Changed OTP text'))$$,'P0001','IDEMPOTENCY_CONFLICT','OTP start retry cannot change delivery content');
select is(pg_temp.cmd('setup_conversation_read','host')->'linkChallenge'->>'maskedSender','+8…25','OTP view masks the intended recipient');
select is(pg_temp.cmd('setup_conversation_read','host')->'linkChallenge'->>'deliveryStatus','prepared','OTP view exposes durable delivery status');
select throws_ok($$select pg_temp.cmd('setup_link_challenge_claim','worker',pg_temp.item('channel')||jsonb_build_object('challengeId',pg_temp.item('otpChallenge')->>'challengeId','challengeSecretHash',repeat('1',64)))$$,'P0001','CHALLENGE_INVALID','inbound LINK proof cannot claim an outbound OTP challenge');
insert into setup_fixture values('otpDispatch',pg_temp.cmd('setup_provider_outbound_claim','worker','{"provider":"imessage"}'));
select is(pg_temp.item('otpDispatch')->>'action','dispatch','OTP outbox authorizes one provider send');
select is(pg_temp.item('otpDispatch')->>'conversationId','any;-;+821025742625','OTP targets the expected Photon conversation identifier');
select is(pg_temp.cmd('setup_provider_outbound_claim','worker','{"provider":"imessage"}')->>'action','none','uncertain OTP is not sent twice');
select is(pg_temp.cmd('setup_provider_outbound_authorize','worker',jsonb_build_object('intentId',pg_temp.item('otpDispatch')->>'intentId'))->>'action','reconcile','OTP authorization preserves uncertain-send fencing');
select is(pg_temp.cmd('setup_provider_outbound_record','worker',jsonb_build_object('intentId',pg_temp.item('otpDispatch')->>'intentId','outcome','accepted','providerReference','otp-provider-1'))->>'status','accepted','OTP provider acceptance is durable');
select is(pg_temp.cmd('setup_conversation_read','host')->'linkChallenge'->>'deliveryStatus','accepted','OTP view follows provider delivery state');
select is(pg_temp.cmd('setup_link_confirm','host',jsonb_build_object('challengeId',pg_temp.item('otpChallenge')->>'challengeId','codeHash',repeat('3',64),'browserProofHash',repeat('2',64)))->>'remainingAttempts','4','wrong OTP decrements the durable attempt budget');
select throws_ok($$select pg_temp.cmd('setup_link_confirm','host',jsonb_build_object('challengeId',pg_temp.item('otpChallenge')->>'challengeId','codeHash',repeat('1',64),'browserProofHash',repeat('f',64)))$$,'P0001','CHALLENGE_INVALID','correct OTP cannot move to a different browser proof');
insert into setup_fixture values('otpLinked',pg_temp.cmd('setup_link_confirm','host',jsonb_build_object('challengeId',pg_temp.item('otpChallenge')->>'challengeId','codeHash',repeat('1',64),'browserProofHash',repeat('2',64))));
select is(pg_temp.cmd('setup_channel_authorize','worker','{"provider":"imessage","senderId":"+821025742625","privateConversationId":"any;-;+821025742625","isGroup":false}')->>'hostId',pg_temp.item('host')->>'id','correct OTP binds the exact expected sender and conversation');
-- A second host cannot claim a recipient that is already actively linked, and recipient sends are rate limited across hosts.
select pg_temp.cmd('invite_issue','operator',jsonb_build_object('email','other-setup@example.com','tokenHash',repeat('8',64),'expiresAt',now()+interval '1 day'));
select pg_temp.cmd('invite_redeem','other',jsonb_build_object('tokenHash',repeat('8',64)));
select throws_ok($$select pg_temp.cmd('setup_link_challenge_start','other',jsonb_build_object('method','otp','challengeId','00000000-0000-4000-8000-000000000103','recipientId','+821025742625','challengeSecretHash',repeat('4',64),'browserProofHash',repeat('5',64),'clientMessageId','00000000-0000-4000-8000-000000000104','replyText','Find Me a Time code: 654321'))$$,'P0001','RATE_LIMITED','recipient OTP sends are rate limited across hosts');
update fmat.setup_channel_challenges set created_at=now()-interval '2 minutes',expires_at=now()+interval '8 minutes' where id=(pg_temp.item('otpChallenge')->>'challengeId')::uuid;
insert into setup_fixture values('conflictChallenge',pg_temp.cmd('setup_link_challenge_start','other',jsonb_build_object('method','otp','challengeId','00000000-0000-4000-8000-000000000103','recipientId','+821025742625','challengeSecretHash',repeat('4',64),'browserProofHash',repeat('5',64),'clientMessageId','00000000-0000-4000-8000-000000000104','replyText','Find Me a Time code: 654321')));
insert into setup_fixture values('conflictDispatch',pg_temp.cmd('setup_provider_outbound_claim','worker','{"provider":"imessage"}'));
select pg_temp.cmd('setup_provider_outbound_record','worker',jsonb_build_object('intentId',pg_temp.item('conflictDispatch')->>'intentId','outcome','accepted'));
select throws_ok($$select pg_temp.cmd('setup_link_confirm','other',jsonb_build_object('challengeId',pg_temp.item('conflictChallenge')->>'challengeId','codeHash',repeat('4',64),'browserProofHash',repeat('5',64)))$$,'P0001','LINK_CONFLICT','OTP cannot rebind an actively linked sender to another host');
update fmat.setup_channel_challenges set created_at=now()-interval '11 minutes',expires_at=now()-interval '1 minute' where id=(pg_temp.item('conflictChallenge')->>'challengeId')::uuid;
select throws_ok($$select pg_temp.cmd('setup_link_confirm','other',jsonb_build_object('challengeId',pg_temp.item('conflictChallenge')->>'challengeId','codeHash',repeat('4',64),'browserProofHash',repeat('5',64)))$$,'P0001','CHALLENGE_INVALID','expired OTP cannot link a sender');
-- Five wrong codes lock a challenge without rolling back its attempt counter.
insert into setup_fixture values('lockedChallenge',pg_temp.cmd('setup_link_challenge_start','other',jsonb_build_object('method','otp','challengeId','00000000-0000-4000-8000-000000000105','recipientId','+821055555555','challengeSecretHash',repeat('6',64),'browserProofHash',repeat('7',64),'clientMessageId','00000000-0000-4000-8000-000000000106','replyText','Find Me a Time code: 111111')));
insert into setup_fixture values('lockedDispatch',pg_temp.cmd('setup_provider_outbound_claim','worker','{"provider":"imessage"}'));
select pg_temp.cmd('setup_provider_outbound_record','worker',jsonb_build_object('intentId',pg_temp.item('lockedDispatch')->>'intentId','outcome','accepted'));
select is(pg_temp.cmd('setup_link_confirm','other',jsonb_build_object('challengeId',pg_temp.item('lockedChallenge')->>'challengeId','codeHash',repeat('0',64),'browserProofHash',repeat('7',64)))->>'remainingAttempts','4','first wrong OTP leaves four attempts');
select is(pg_temp.cmd('setup_link_confirm','other',jsonb_build_object('challengeId',pg_temp.item('lockedChallenge')->>'challengeId','codeHash',repeat('0',64),'browserProofHash',repeat('7',64)))->>'remainingAttempts','3','second wrong OTP leaves three attempts');
select is(pg_temp.cmd('setup_link_confirm','other',jsonb_build_object('challengeId',pg_temp.item('lockedChallenge')->>'challengeId','codeHash',repeat('0',64),'browserProofHash',repeat('7',64)))->>'remainingAttempts','2','third wrong OTP leaves two attempts');
select is(pg_temp.cmd('setup_link_confirm','other',jsonb_build_object('challengeId',pg_temp.item('lockedChallenge')->>'challengeId','codeHash',repeat('0',64),'browserProofHash',repeat('7',64)))->>'remainingAttempts','1','fourth wrong OTP leaves one attempt');
select is(pg_temp.cmd('setup_link_confirm','other',jsonb_build_object('challengeId',pg_temp.item('lockedChallenge')->>'challengeId','codeHash',repeat('0',64),'browserProofHash',repeat('7',64)))->>'remainingAttempts','0','fifth wrong OTP locks the challenge');
select is(pg_temp.cmd('setup_link_confirm','other',jsonb_build_object('challengeId',pg_temp.item('lockedChallenge')->>'challengeId','codeHash',repeat('6',64),'browserProofHash',repeat('7',64)))->>'status','invalid_code','correct code cannot bypass OTP lockout');
-- Failed provider delivery fences confirmation, and uncertainty is reconciled rather than resent.
update fmat.setup_channel_challenges set created_at=now()-interval '2 minutes',expires_at=now()+interval '8 minutes' where id=(pg_temp.item('lockedChallenge')->>'challengeId')::uuid;
insert into setup_fixture values('failedChallenge',pg_temp.cmd('setup_link_challenge_start','other',jsonb_build_object('method','otp','challengeId','00000000-0000-4000-8000-000000000107','recipientId','+821066666666','challengeSecretHash',repeat('8',64),'browserProofHash',repeat('9',64),'clientMessageId','00000000-0000-4000-8000-000000000108','replyText','Find Me a Time code: 222222')));
insert into setup_fixture values('failedDispatch',pg_temp.cmd('setup_provider_outbound_claim','worker','{"provider":"imessage"}'));
select is(pg_temp.cmd('setup_provider_outbound_claim','worker','{"provider":"imessage"}')->>'action','none','uncertain failed-path OTP is not duplicated');
update fmat.setup_provider_outbound set updated_at=now()-interval '31 seconds' where id=(pg_temp.item('failedDispatch')->>'intentId')::uuid;
select is(pg_temp.cmd('setup_provider_outbound_claim','worker','{"provider":"imessage"}')->>'action','reconcile','stale uncertain OTP requires provider reconciliation');
select is(pg_temp.cmd('setup_provider_outbound_record','worker',jsonb_build_object('intentId',pg_temp.item('failedDispatch')->>'intentId','outcome','failed','errorCode','provider_rejected'))->>'status','failed','failed OTP delivery is durable');
select throws_ok($$select pg_temp.cmd('setup_link_confirm','other',jsonb_build_object('challengeId',pg_temp.item('failedChallenge')->>'challengeId','codeHash',repeat('8',64),'browserProofHash',repeat('9',64)))$$,'P0001','CHALLENGE_INVALID','failed outbound OTP cannot authorize a link');
select pg_temp.cmd('setup_link_unlink','host',jsonb_build_object('linkId',pg_temp.item('otpLinked')->'channelLink'->>'id'));
select is(pg_temp.cmd('setup_bridge_resume','worker','{"provider":"imessage"}')->'lastSequence','null'::jsonb,'new bridge has no checkpoint');
select is(pg_temp.cmd('setup_bridge_checkpoint','worker','{"provider":"imessage","providerSequence":"101","disposition":"ignored_group"}')->>'lastSequence','101','ignored private events still durably advance cursor');
select is(pg_temp.cmd('setup_bridge_checkpoint','worker','{"provider":"imessage","providerSequence":"100"}')->>'lastSequence','101','older provider event cannot move checkpoint backwards');
select throws_ok($$select pg_temp.cmd('setup_bridge_resume','host','{"provider":"imessage"}')$$,'P0001','FORBIDDEN','host browser cannot inspect provider cursor');
-- Inbound-started continuation never grants authority until a new private proof and browser confirmation.
insert into setup_fixture values('continuation',pg_temp.cmd('setup_link_inbound_start','worker',pg_temp.item('channel')||jsonb_build_object('continuationId','00000000-0000-4000-8000-000000000093','continuationSecretHash',repeat('c',64),'clientMessageId','00000000-0000-4000-8000-000000000094','replyText','Continue setup in your browser.')));
select is(pg_temp.cmd('setup_provider_outbound_claim','worker','{"provider":"imessage"}')->>'conversationId','private-channel','unlinked continuation reply targets only origin private conversation');
update fmat.setup_channel_challenges set created_at=now()-interval '2 minutes',expires_at=now()+interval '8 minutes' where host_id=(pg_temp.item('host')->>'id')::uuid;
insert into setup_fixture values('continuedChallenge',pg_temp.cmd('setup_link_challenge_start','host',jsonb_build_object('challengeSecretHash',repeat('d',64),'browserProofHash',repeat('e',64),'continuationId',pg_temp.item('continuation')->>'continuationId','continuationSecretHash',repeat('c',64))));
select throws_ok($$select pg_temp.cmd('setup_link_challenge_claim','worker',pg_temp.item('channel')||jsonb_build_object('senderId','attacker','challengeId',pg_temp.item('continuedChallenge')->>'challengeId','challengeSecretHash',repeat('d',64)))$$,'P0001','CHALLENGE_INVALID','browser continuation stays bound to original private sender');
select lives_ok($$select pg_temp.cmd('setup_link_challenge_claim','worker',pg_temp.item('channel')||jsonb_build_object('challengeId',pg_temp.item('continuedChallenge')->>'challengeId','challengeSecretHash',repeat('d',64)))$$,'original sender proves fresh continuation challenge');
select lives_ok($$select pg_temp.cmd('setup_link_confirm','host',jsonb_build_object('challengeId',pg_temp.item('continuedChallenge')->>'challengeId','browserProofHash',repeat('e',64)))$$,'fresh origin proof plus authenticated browser can relink');
-- Current browser form saves supersede the base version of a conversation review.
insert into setup_fixture values('driftReview',pg_temp.cmd('setup_turn_append','host',jsonb_build_object('expectedRevision',7,'clientTurnId','00000000-0000-4000-8000-000000000095','channel','web','text','Set buffer twenty five','extraction',jsonb_build_object('patch',jsonb_build_object('rules',jsonb_build_object('bufferMinutes',25))))));
select pg_temp.cmd('setup_save','host',jsonb_build_object('handle','setup-host','displayName','Name from form','rules',pg_temp.item('rules')||jsonb_build_object('bufferMinutes',40)));
select throws_ok($$select pg_temp.cmd('setup_review_confirm','host','{"expectedRevision":8,"reviewRevision":3,"expectedDraftRevision":5,"expectedRulesVersion":2}')$$,'P0001','RULES_STALE','structured fallback change prevents approval of stale conversation review');
insert into setup_fixture values('rebased',pg_temp.cmd('setup_turn_append','host',jsonb_build_object('expectedRevision',8,'clientTurnId','00000000-0000-4000-8000-000000000096','channel','web','text','Change my preference','extraction',jsonb_build_object('patch',jsonb_build_object('rules',jsonb_build_object('preferences','New preference'))))));
select is(pg_temp.item('rebased')->'draft'->'settings'->>'displayName','Name from form','next turn rebases on current structured fallback settings');
select is((pg_temp.item('rebased')->'draft'->'settings'->'rules'->>'bufferMinutes')::integer,40,'rebase does not resurrect superseded buffer setting');
select throws_ok($$select pg_temp.cmd('setup_turn_append','host','{"expectedRevision":9,"clientTurnId":"00000000-0000-4000-8000-000000000097","channel":"web","text":"Change provider authority","extraction":{"patch":{"rules":{"token":"secret"}}}}')$$,'P0001','INVALID_INPUT','draft rule patch cannot introduce credential or arbitrary tool fields');
select throws_ok($$select pg_temp.cmd('setup_turn_lookup','host','{"clientTurnId":"00000000-0000-4000-8000-000000000083","channel":"web","text":"Use weekday rules","expectedRevision":9}')$$,'P0001','IDEMPOTENCY_CONFLICT','turn replay cannot change original revision fingerprint');
-- Provider order is preserved even across a worker restart.
select pg_temp.cmd('setup_provider_inbound_record','worker',pg_temp.item('channel')||jsonb_build_object('providerMessageId','provider-message-4','occurredAt','2026-10-05T06:03:00Z','text','First queued turn'));
select pg_temp.cmd('setup_provider_inbound_record','worker',pg_temp.item('channel')||jsonb_build_object('providerMessageId','provider-message-5','occurredAt','2026-10-05T06:04:00Z','text','Second queued turn'));
select throws_ok($$select pg_temp.cmd('setup_turn_append','worker',pg_temp.item('channel')||jsonb_build_object('providerMessageId','provider-message-5','expectedRevision',9,'clientTurnId','00000000-0000-4000-8000-000000000098','channel','imessage','text','Second queued turn'))$$,'P0001','INBOUND_OUT_OF_ORDER','later provider turn cannot overtake durable earlier inbound');
select lives_ok($$select pg_temp.cmd('setup_turn_append','worker',pg_temp.item('channel')||jsonb_build_object('providerMessageId','provider-message-4','expectedRevision',9,'clientTurnId','00000000-0000-4000-8000-000000000099','channel','imessage','text','First queued turn'))$$,'earlier queued provider turn can resume processing');
select lives_ok($$select pg_temp.cmd('setup_turn_append','worker',pg_temp.item('channel')||jsonb_build_object('providerMessageId','provider-message-5','expectedRevision',10,'clientTurnId','00000000-0000-4000-8000-000000000100','channel','imessage','text','Second queued turn'))$$,'second turn can process only after earlier commit');
-- Short-lived private continuation and proof cannot be replayed after expiry.
update fmat.setup_channel_challenges set created_at=now()-interval '11 minutes',expires_at=now()-interval '1 minute',consumed_at=null where id=(pg_temp.item('continuedChallenge')->>'challengeId')::uuid;
select throws_ok($$select pg_temp.cmd('setup_link_challenge_claim','worker',pg_temp.item('channel')||jsonb_build_object('challengeId',pg_temp.item('continuedChallenge')->>'challengeId','challengeSecretHash',repeat('d',64)))$$,'P0001','CHALLENGE_INVALID','expired private proof cannot be reused');
select throws_ok($$select pg_temp.cmd('setup_link_confirm','host',jsonb_build_object('challengeId',pg_temp.item('continuedChallenge')->>'challengeId','browserProofHash',repeat('e',64)))$$,'P0001','CHALLENGE_INVALID','expired private proof cannot be browser confirmed');
update fmat.hosts set revoked_at=now() where id=(pg_temp.item('host')->>'id')::uuid;
select throws_ok($$select pg_temp.cmd('setup_conversation_read','host')$$,'P0001','HOST_NOT_ADMITTED','revoked admission closes browser setup authority');
select throws_ok($$select pg_temp.cmd('setup_conversation_read','worker',pg_temp.item('channel'))$$,'P0001','LINK_NOT_FOUND','revoked admission also closes linked channel authority');
select * from finish();
rollback;
