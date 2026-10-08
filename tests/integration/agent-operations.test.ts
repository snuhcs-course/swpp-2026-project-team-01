import test from 'node:test';
import {agentMcpHttp} from '../../lib/server/mcp/http.ts';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout} from 'node:timers/promises';
import {execFileSync} from 'node:child_process';
import {generateKeyPair,exportJWK} from 'jose';
import {Database} from '../../lib/server/database/client.ts';
import {AgentCredentials} from '../../lib/server/oauth/credentials.ts';
import {AgentOAuthTokens,type AgentTokenGrant} from '../../lib/server/oauth/tokens.ts';
import {AgentConversations} from '../../lib/server/oauth/conversations.ts';
import {AgentOperations} from '../../lib/server/oauth/operations.ts';
import {LocalSql} from './local-sql.ts';
const q=(v:string)=>`'${v.replaceAll("'","''")}'`;
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const parse=(v:string)=>JSON.parse(v) as Record<string,string>;
const resource='https://release.findmeatime.com/mcp',redirect='https://client.example/cb',verifier='A'.repeat(43),browser='a'.repeat(64);
async function blocked(db:LocalSql,name:string){for(let n=0;n<60;n++){if(await db.query(`select exists(select 1 from pg_stat_activity where application_name=${q(name)} and wait_event_type='Lock');`)==='t')return;await setTimeout(50);}throw Error('No observed lock wait');}

test('agent operations recheck revocation and expiry under domain and downstream locks',async()=>{
 const db=new LocalSql(),lock=new LocalSql(),wait=new LocalSql(),peers=Array.from({length:8},()=>new LocalSql());
 const host=randomUUID(),session=randomUUID(),invitation=randomUUID(),client=randomUUID(),waitName=`oauth-grant-${randomUUID()}`;
 type Fixture={request:string|null;authorization:string;credential:string;code:string;refresh:string;grant:string};
 const consent=(f:Fixture)=>`select public.fmat_oauth_consent(${q(f.authorization)},${q(browser)},${q(f.credential)}::jsonb,'grant',${q(f.code)});`;
 async function fixture(kind:'host'|'guest'='guest',issue=true):Promise<Fixture>{
  const authorization=randomUUID(),request=kind==='guest'?randomUUID():null;
  const secret=hash(randomUUID());
  if(request)await db.query(`insert into fmat.requests(id,host_id,details,token_hash,expires_at) values(${q(request)},${q(host)},'{}',${q(secret)},clock_timestamp()+interval '1 day');`);
  const credential=JSON.stringify(request?{kind,requestId:request,tokenHash:secret}:{kind,subject:host,sessionId:session,expiresAt:new Date(Date.now()+3600000).toISOString()});
  // This suite isolates lifecycle concurrency from the registry suite's global
  // budget tests. Seed only the already-tested pending authorization boundary.
  await db.query(`insert into fmat.oauth_authorizations(id,client_id,resource,redirect_uri,scope,code_challenge,state,browser_hash,created_at,expires_at) values(${q(authorization)},${q(client)},${q(resource)},${q(redirect)},${q(kind==='host'?'host:read host:write':'request:read request:write')},${q(createHash('sha256').update(verifier).digest('base64url'))},'state',${q(browser)},statement_timestamp(),statement_timestamp()+interval '10 minutes');`);
  const f={request,authorization,credential,code:hash(randomUUID()),refresh:hash(randomUUID()),grant:''};
  if(issue){assert.equal(parse(await db.query(consent(f))).decision,'grant');f.grant=await db.query(`select id from fmat.oauth_grants where authorization_id=${q(authorization)};`);}
  return f;
 }
 try{
  await db.query(`insert into auth.users(id,email,email_confirmed_at) values(${q(host)},'oauth-concurrent@example.test',now());insert into auth.sessions(id,user_id) values(${q(session)},${q(host)});insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values(${q(invitation)},'oauth-concurrent@example.test',${q(hash(invitation))},now()+interval '1 day','oauth-concurrency');insert into fmat.hosts(id,email,invitation_id) values(${q(host)},'oauth-concurrent@example.test',${q(invitation)});insert into fmat.oauth_clients(id,name,redirect_uris,resource) values(${q(client)},'OAuth grant fixture',array[${q(redirect)}],${q(resource)});`);
  await wait.query(`set application_name=${q(waitName)};`);
  await wait.query(`create function pg_temp.operation_error(sql text) returns text language plpgsql as $$begin execute sql;return 'NO_ERROR';exception when others then return SQLERRM;end$$;`);
  const hostGrant=await fixture('host'),guest=await fixture();
  const op=(f:Fixture,operation:string,request:string|null=f.request,input:unknown={},key:string|null=null,expiry=Math.floor(Date.now()/1000)+300)=>`select public.fmat_agent_operation(${q(f.grant)},${q(client)},${q(resource)},${q(f.request?'guest':'host')},${q(f.request??host)},${q(f.request?'request:read request:write':'host:read host:write')},${expiry},${q(operation)},${request?q(request):'null'},${q(JSON.stringify(input))}::jsonb,${key?q(key):'null'});`;
  assert.equal(parse(await db.query(op(guest,'request_read'))).id,guest.request);
  const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  assert.ok(['127.0.0.1','localhost'].includes(new URL(local.API_URL).hostname));
  const pair=await generateKeyPair('ES256',{extractable:true}),env={APP_ORIGIN:'https://release.findmeatime.com',SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,AGENT_OAUTH_SIGNING_JWK:JSON.stringify({...await exportJWK(pair.privateKey),kid:'integration'})};
  const database=new Database(env),projection=JSON.parse(await db.query(`select fmat.oauth_grant_projection(g) from fmat.oauth_grants g where id=${q(guest.grant)};`)) as AgentTokenGrant;
  const access=await new AgentOAuthTokens(env).issue(projection,async()=>{}),credential=await new AgentCredentials(env,database).verify(access),operations=new AgentOperations(database);
  assert.equal((await operations.execute(credential,{operation:'request_read',requestId:guest.request,input:{}}) as {id:string}).id,guest.request);
  const mcp=agentMcpHttp(env,new AgentCredentials(env,database),operations);
  const mcpRequest=(name='fmat_get_request',requestId=guest.request)=>new Request(resource,{method:'POST',headers:{authorization:'Bearer '+access,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{requestId,input:{}}}})});
  const viaMcp=await mcp(mcpRequest());assert.equal(viaMcp.status,200);
  assert.equal((await viaMcp.json()).result.structuredContent.result.id,guest.request);
  const foreign=await mcp(mcpRequest('fmat_get_request',randomUUID()));assert.equal((await foreign.json()).result.isError,true);
  assert.equal((await mcp(mcpRequest('fmat_review_decision'))).status,403);
  await db.query(`insert into fmat.requests(host_id,details,token_hash,expires_at,private_notes) select ${q(host)},jsonb_build_object('purpose','List probe '||n,'requesterEmail','private@example.test'),encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),clock_timestamp()+interval '1 day','private list note' from generate_series(1,35) n;`);
  const hostProjection=JSON.parse(await db.query(`select fmat.oauth_grant_projection(g) from fmat.oauth_grants g where id=${q(hostGrant.grant)};`)) as AgentTokenGrant;
  const hostAccess=await new AgentOAuthTokens(env).issue(hostProjection,async()=>{});
  const listRequest=(input:unknown={})=>new Request(resource,{method:'POST',headers:{authorization:'Bearer '+hostAccess,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'fmat_list_requests',arguments:{input}}})});
  const firstPage=(await(await mcp(listRequest())).json()).result.structuredContent.result;
  assert.equal(firstPage.requests.length,30);assert.ok(firstPage.nextCursor);
  const nextPage=(await(await mcp(listRequest(firstPage.nextCursor))).json()).result.structuredContent.result;
  assert.equal(nextPage.requests.length,6);assert.equal(nextPage.nextCursor,null);
  assert.equal(new Set([...firstPage.requests,...nextPage.requests].map((r:{requestId:string})=>r.requestId)).size,36);
  assert.ok(!JSON.stringify(firstPage).includes('private@example.test'));assert.ok(!JSON.stringify(firstPage).includes('private list note'));
  assert.equal((await(await mcp(listRequest({...firstPage.nextCursor,beforeId:randomUUID()}))).json()).result.isError,true);
  const expiredList=await fixture('host');
  await lock.query(`begin;select 1 from fmat.oauth_grants where id=${q(expiredList.grant)} for update;`);
  let listPending=wait.query(op(expiredList,'requests_list',null,{},null,Math.floor(Date.now()/1000)+2));
  await blocked(db,waitName);await lock.query('select pg_sleep(2.1);commit;');
  assert.equal(parse(await listPending).error,'invalid_token','list expiry after grant lock wait returns no summaries');
  const historyId=randomUUID();
  await db.query(`insert into fmat.conversation_scopes(id,host_id,request_id,audience,runtime_session_id) values(${q(historyId)},${q(host)},${q(guest.request!)},'request_shared','internal-history-fixture');`);
  const histories=new AgentConversations(database);
  assert.deepEqual(await histories.resolve(credential,{audience:'request_shared',requestId:guest.request}),{conversationId:historyId,sessionId:'internal-history-fixture'});
  // The final authority check must cover waiting on the runtime binding lock.
  await lock.query(`begin;select 1 from fmat.conversation_scopes where id=${q(historyId)} for update;`);
  let historyPending=wait.query(op(guest,'conversation_resolve',guest.request,{audience:'request_shared'},null,Math.floor(Date.now()/1000)+2));
  await blocked(db,waitName);await lock.query('select pg_sleep(2.1);commit;');
  assert.equal(parse(await historyPending).error,'invalid_token','history binding wait cannot return an expired credential result');
  await db.query(`update fmat.requests set expires_at=clock_timestamp()+interval '2 seconds' where id=${q(guest.request!)};`);
  await lock.query(`begin;select 1 from fmat.conversation_scopes where id=${q(historyId)} for update;`);
  historyPending=wait.query(`select pg_temp.operation_error(${q(op(hostGrant,'conversation_resolve',guest.request,{audience:'request_shared'}))});`);
  await blocked(db,waitName);await lock.query('select pg_sleep(2.1);commit;');assert.equal(await historyPending,'REQUEST_CLOSED');
  await db.query(`update fmat.requests set expires_at=clock_timestamp()+interval '1 day' where id=${q(guest.request!)};`);
  await lock.query(`begin;update fmat.conversation_scopes set revoked_at=clock_timestamp() where id=${q(historyId)};`);
  historyPending=wait.query(`select pg_temp.operation_error(${q(op(guest,'conversation_resolve',guest.request,{audience:'request_shared'}))});`);
  await blocked(db,waitName);await lock.query('commit;');assert.equal(await historyPending,'NOT_FOUND');
  await assert.rejects(histories.resolve(credential,{audience:'request_shared',requestId:guest.request}));
  // Contended request read must observe rotation committed before its lock.
  await lock.query(`begin;update fmat.requests set token_hash=${q(hash(randomUUID()))} where id=${q(guest.request!)};`);
  let pending=wait.query(op(guest,'request_read'));await blocked(db,waitName);await lock.query('commit;');
  assert.equal(parse(await pending).error,'invalid_grant');
  assert.equal(await db.query(`select revoked_at is not null from fmat.oauth_grants where id=${q(guest.grant)};`),'t');
  await assert.rejects(operations.execute(credential,{operation:'request_read',requestId:guest.request,input:{}}));
  assert.equal((await mcp(mcpRequest())).status,401,'MCP rejects the signed token after request authority rotation');
  // Token expires while waiting for the initial request lock: no data returned.
  const expiring=await fixture();
  await lock.query(`begin;select 1 from fmat.requests where id=${q(expiring.request!)} for update;`);
  pending=wait.query(op(expiring,'request_read',expiring.request,{},null,Math.floor(Date.now()/1000)+2));
  await blocked(db,waitName);await lock.query('select pg_sleep(2.1);commit;');
  assert.equal(parse(await pending).error,'invalid_token');
  // Revoke while an operation waits at the grant lock.
  const revoked=await fixture();
  await lock.query(`begin;update fmat.oauth_grants set revoked_at=clock_timestamp() where id=${q(revoked.grant)};`);
  pending=wait.query(op(revoked,'request_read'));await blocked(db,waitName);await lock.query('commit;');
  assert.equal(parse(await pending).error,'invalid_grant');
  // Setup takes a later conversation lock. Expiry after this wait must roll
  // back the newly created draft, including its idempotency side effects.
  const initial=JSON.parse(await db.query(op(hostGrant,'setup_read')));
  const conversation=await db.query(`select id from fmat.setup_conversations where host_id=${q(host)};`);
  await lock.query(`begin;select 1 from fmat.setup_conversations where id=${q(conversation)} for update;`);
  const key=randomUUID(),draft={expectedRevision:initial.revision,patch:{displayName:'Expired agent draft'},unresolved:[]};
  pending=wait.query(op(hostGrant,'setup_draft',null,draft,key,Math.floor(Date.now()/1000)+2));
  await blocked(db,waitName);await lock.query('select pg_sleep(2.1);commit;');
  assert.equal(parse(await pending).error,'invalid_token');
  const after=JSON.parse(await db.query(op(hostGrant,'setup_read')));assert.equal(after.revision,initial.revision);assert.equal(after.draft,initial.draft);
  // Stable idempotency survives retry; another grant has its own namespace.
  const saved=JSON.parse(await db.query(op(hostGrant,'setup_draft',null,draft,key)));
  const replay=JSON.parse(await db.query(op(hostGrant,'setup_draft',null,draft,key)));assert.equal(saved.revision,replay.revision);
  const secondHost=await fixture('host');
  const both=await Promise.all(peers.slice(0,2).map((p,i)=>p.query(op(i?secondHost:hostGrant,'setup_read'))));assert.equal(JSON.parse(both[0]).revision,JSON.parse(both[1]).revision);
  await lock.query(`begin;update fmat.oauth_grants set revoked_at=clock_timestamp() where id=${q(hostGrant.grant)};`);
  listPending=wait.query(op(hostGrant,'requests_list'));await blocked(db,waitName);await lock.query('commit;');
  assert.equal(parse(await listPending).error,'invalid_grant','list observes concurrent grant revocation');
  assert.equal((await mcp(listRequest())).status,401,'MCP discovery stops after current host grant revocation');

 }finally{
  await lock.query('rollback;').catch(()=>{});
  await db.query(`delete from fmat.oauth_refresh_tokens where grant_id in(select id from fmat.oauth_grants where client_id=${q(client)});delete from fmat.oauth_codes where grant_id in(select id from fmat.oauth_grants where client_id=${q(client)});delete from fmat.oauth_grants where client_id=${q(client)};delete from fmat.oauth_authorizations where client_id=${q(client)};delete from fmat.oauth_clients where id=${q(client)};delete from fmat.setup_reviews where conversation_id in(select id from fmat.setup_conversations where host_id=${q(host)});delete from fmat.setup_drafts where conversation_id in(select id from fmat.setup_conversations where host_id=${q(host)});delete from fmat.setup_conversations where host_id=${q(host)};delete from fmat.conversation_scopes where host_id=${q(host)};delete from fmat.requests where host_id=${q(host)};delete from fmat.hosts where id=${q(host)};delete from fmat.invitations where id=${q(invitation)};delete from auth.users where id=${q(host)};`);
  for(const connection of [db,lock,wait,...peers])connection.close();
 }
});
