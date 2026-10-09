import {generateKeyPair,exportJWK} from 'jose';
import {AgentOAuthTokens,type AgentTokenGrant} from '../../lib/server/oauth/tokens.ts';
import {agentMcpHttp} from '../../lib/server/mcp/http.ts';
import {AgentCredentials} from '../../lib/server/oauth/credentials.ts';
import {Database} from '../../lib/server/database/client.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { LocalSql } from '../integration/local-sql.ts';

test('real eve ingress binds request authority, deduplicates input and recovers a post-commit process kill', { timeout: 180_000 }, async () => {
  const root = process.cwd();
  const local = JSON.parse(execFileSync('supabase', ['status','-o','json'], { encoding:'utf8', stdio:['ignore','pipe','pipe'] }));
  assert.ok(['127.0.0.1','localhost'].includes(new URL(local.API_URL).hostname));
  await mkdir('.local/rebuild', { recursive:true });
  const fixture = await mkdtemp(resolve('.local/rebuild/runtime-fixture-'));
  await mkdir(join(fixture,'agent/channels'), { recursive:true });
  await mkdir(join(fixture,'agent/tools'), { recursive:true });
  await writeFile(join(fixture,'agent/instructions.md'), 'Exercise the production conversation boundary with synthetic data.');
  await writeFile(join(fixture,'package.json'), JSON.stringify({ name:'fmat-runtime-fixture',private:true,type:'module',dependencies:{eve:'0.71.3'} }));
  for (const [target, source] of Object.entries({
    'agent/agent.ts':'tests/runtime/fixture-agent.ts', 'agent/channels/eve.ts':'agent/channels/eve.ts',
    'agent/channels/conversations.ts':'agent/channels/conversations.ts',
    'agent/tools/propose_request_details.ts':'tests/runtime/fixture-update-tool.ts',
  })) await writeFile(join(fixture,target), `export { default } from ${JSON.stringify(resolve(source))};\n`);
  const build = spawn(process.execPath,[join(root,'node_modules/eve/bin/eve.js'),'build','--skip-sandbox-prewarm'], { cwd:fixture,stdio:['ignore','pipe','pipe'] });
  let buildLog=''; build.stdout.on('data', x=>buildLog+=x); build.stderr.on('data',x=>buildLog+=x);
  const [buildCode] = await once(build,'close');
  await writeFile(join(fixture,'build.log'),buildLog); assert.equal(buildCode,0,buildLog.slice(-4000));
  const portServer=createServer(); portServer.listen(0,'127.0.0.1'); await once(portServer,'listening');
  const port=(portServer.address() as {port:number}).port; await new Promise<void>(r=>portServer.close(()=>r()));
  const origin=`http://127.0.0.1:${port}`, marker=join(fixture,'tool-committed');
  const key=await generateKeyPair('ES256',{extractable:true});
  const env={...process.env, AGENT_OAUTH_SIGNING_JWK:JSON.stringify({...await exportJWK(key.privateKey),kid:'runtime-test'}), TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'), SUPABASE_URL:local.API_URL, SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,
    SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY, APP_ORIGIN:origin, PORT:String(port), HOST:'127.0.0.1',
    // The bundled Workflow runtime defaults to an 860-second inline ownership
    // lease. Accelerate expiration only in this isolated crash-test process;
    // production retains its default lease and never imports this fixture.
    WORKFLOW_INLINE_OWNERSHIP_LEASE_SECONDS:'5',
    RUNTIME_DISPATCH_SECRET:'a'.repeat(64), FMAT_TEST_MARKER:marker, OPENAI_API_KEY:'', NODE_ENV:'development'};
  let child: ChildProcess | undefined, serverLog='';
  async function start(resume=false) {
    child=spawn(process.execPath,[join(root,'node_modules/eve/bin/eve.js'),'dev','--no-ui','--no-default-extensions','--host','127.0.0.1','--port',String(port),...(resume?['--resume']:[])],{cwd:fixture,env,stdio:['ignore','pipe','pipe'],detached:true});
    child.stdout!.on('data',x=>serverLog+=x); child.stderr!.on('data',x=>serverLog+=x);
    for(let n=0;n<300;n++) {
      assert.equal(child.exitCode,null,serverLog.slice(-3000));
      try { if((await fetch(origin+'/eve/v1/health')).ok)return; } catch {}
      await delay(100);
    } throw new Error('Fixture runtime did not start');
  }
  async function stop() {
    if(!child || child.exitCode!==null)return;
    const closed=once(child,'close'); process.kill(-child.pid!,'SIGKILL'); await closed;
  }
  const sql = new LocalSql(); const host=randomUUID(), invitation=randomUUID(), requests=[randomUUID(),randomUUID()];
  let agentClient:string|undefined;
  const tokens=[randomBytes(32).toString('base64url'),randomBytes(32).toString('base64url')];
  const headers=(i=0)=>({ authorization:`Request ${tokens[i]}`, 'x-request-id':requests[i], 'content-type':'application/json' });
  const post=(path:string, body:unknown, i=0)=>fetch(origin+path,{method:'POST',headers:headers(i),body:JSON.stringify(body)});
  async function waitUntil(check:()=>Promise<boolean>, message:string) {
    for(let n=0;n<300;n++){if(await check())return;await delay(100);} throw new Error(message+': '+serverLog.slice(-3500));
  }
  try {
    await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invitation}','${host}@example.test',encode(extensions.digest('${invitation}','sha256'),'hex'),now()+interval '1 day','fixture');
      insert into fmat.hosts(id,email,invitation_id) values('${host}','${host}@example.test','${invitation}');`);
    for(let i=0;i<2;i++) await sql.query(`insert into fmat.requests(id,host_id,details,token_hash,expires_at) values('${requests[i]}','${host}','{}','${createHash('sha256').update(tokens[i]).digest('hex')}',now()+interval '1 day');`);
    await start();
    assert.equal((await fetch(origin+'/api/conversations',{method:'POST'})).status,401);
    const opened=await post('/api/conversations',{audience:'request_shared',requestId:requests[0]}); assert.equal(opened.status,200,await opened.clone().text());
    const scope=(await opened.json()).conversationId as string; assert.ok(scope);
    assert.equal((await fetch(`${origin}/api/conversations/${scope}`,{headers:headers(1)})).status,404);
    assert.equal((await fetch(`${origin}/api/conversations/${scope}/stream`,{headers:headers(1)})).status,404);
    assert.equal((await post(`/api/conversations/${scope}/messages`,{clientId:randomUUID(),text:'foreign input'},1)).status,404);
    for(const audience of ['host_setup','host_private']){
      const input=audience==='host_setup'?{audience}:{audience,requestId:requests[0]};
      assert.equal((await post('/api/conversations',input)).status,404,'request credential cannot open a private host scope');
    }
    assert.equal((await post('/api/conversations',{audience:'request_shared',requestId:requests[0],actor:{kind:'host',id:host}})).status,400);
    assert.equal((await fetch(origin+'/api/conversations',{method:'POST',headers:{...headers(),origin:'https://untrusted.example'},body:JSON.stringify({audience:'request_shared',requestId:requests[0]})})).status,403);
    assert.equal((await fetch(origin+'/api/agent/conversations/read',{method:'POST',headers:headers(),body:'{}'})).status,401,'request token is not an agent access token');
    for(const path of ['/session','/session/test',...['cancel','compact','clear','reset'].map(action=>`/session/test/${action}`)]){
      assert.equal((await post('/eve/v1'+path,{message:'unauthorized control'})).status,401,'request authority never enables raw runtime controls');
    }
    assert.equal(await sql.query(`select count(*) from fmat.runtime_messages where conversation_id='${scope}';`),'0','denied ingress creates no input');
    const message={clientId:randomUUID(),text:'save: a post-commit recovery test'};
    const sent=await post(`/api/conversations/${scope}/messages`,message); assert.equal(sent.status,202,await sent.clone().text());
    const acceptedId=(await sent.json()).messageId as string;
    await waitUntil(async()=>{try{await access(marker);return true;}catch{return false;}},'Tool did not reach commit');
    assert.equal(await sql.query(`select revision from fmat.requests where id='${requests[0]}';`),'1');
    const attemptsBefore=Number(await sql.query(`select attempts from fmat.model_work_attempts where name='conversation:${acceptedId}';`));assert.equal(attemptsBefore,1);
    assert.equal((await post(`/api/conversations/${scope}/messages`,{...message,text:'conflicting retry'})).status,409);
    await stop(); await writeFile(marker+'.release','resume'); await start(true);
    const retry=await post(`/api/conversations/${scope}/messages`,message); assert.equal(retry.status,202,await retry.clone().text());
    await waitUntil(async()=>await sql.query(`select status from fmat.runtime_messages where conversation_id='${scope}';`)==='completed','Runtime failed to recover after kill');
    assert.equal(await sql.query(`select revision from fmat.requests where id='${requests[0]}';`),'1','draft does not change scheduling details');
    assert.equal(await sql.query(`select count(*) from fmat.request_detail_reviews where request_id='${requests[0]}' and status='pending' and proposed_details->>'purpose'='save: a post-commit recovery test';`),'1','interrupted tool creates one review despite regenerated call ID');
    const attemptsAfter=Number(await sql.query(`select attempts from fmat.model_work_attempts where name='conversation:${acceptedId}';`));
    assert.ok(attemptsAfter>attemptsBefore&&attemptsAfter<=8,'recovered provider calls retain prior durable reservations');
    assert.equal((await post(`/api/conversations/${scope}/messages`,message)).status,200);
    assert.equal(Number(await sql.query(`select attempts from fmat.model_work_attempts where name='conversation:${acceptedId}';`)),attemptsAfter,'settled replay consumes no provider allowance');
    const controller=new AbortController();
    const stream=await fetch(`${origin}/api/conversations/${scope}/stream`,{headers:headers(),signal:controller.signal}); assert.equal(stream.status,200);
    const reader=stream.body!.getReader(); let output='';
    while(!output.includes('session.waiting')) { const item=await reader.read();if(item.done)break;output+=new TextDecoder().decode(item.value); }
    controller.abort();
    assert.match(output,/Reply 1:/u); assert.doesNotMatch(output,/p_grant_id|tokenHash|tool-committed/u);
    const cursor=(JSON.parse(output.trim().split('\n').at(-1)!) as {cursor:number}).cursor;
    // Simulate process death after inbox commit and before from().send(): no
    // browser retry occurs. The authenticated sweep must recover this input.
    await sql.query(`select public.fmat_runtime_message('accept',(select id from fmat.conversation_grants where conversation_id='${scope}' limit 1),'${scope}','${JSON.stringify({clientId:randomUUID(),text:'Continue the same request.'})}'::jsonb);
      update fmat.runtime_messages set next_dispatch_at=now()-interval '1 second' where conversation_id='${scope}' and status='pending';`);
    assert.equal((await fetch(origin+'/api/internal/conversations/dispatch',{method:'POST'})).status,401);
    const recovered=await fetch(origin+'/api/internal/conversations/dispatch',{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(64)}});
    assert.equal(recovered.status,200,await recovered.clone().text());
    assert.deepEqual(await recovered.json(),{claimed:1,sent:1});
    await waitUntil(async()=>await sql.query(`select count(*) from fmat.runtime_messages where conversation_id='${scope}' and status='completed';`)==='2','Continuation did not finish');
    const resumedController=new AbortController();
    const resumed=await fetch(`${origin}/api/conversations/${scope}/stream?cursor=${cursor}`,{headers:headers(),signal:resumedController.signal});
    assert.equal(resumed.status,200);
    const resumedReader=resumed.body!.getReader(); let resumedOutput='';
    while(!resumedOutput.includes('session.waiting')) {const item=await resumedReader.read();if(item.done)break;resumedOutput+=new TextDecoder().decode(item.value);}
    resumedController.abort();
    assert.match(resumedOutput,/Reply 2:/u); assert.doesNotMatch(resumedOutput,/Reply 1:/u);
    for(const line of resumedOutput.trim().split('\n')) assert.ok(JSON.parse(line).cursor>cursor);
    const snapshot=await fetch(`${origin}/api/conversations/${scope}`,{headers:headers()}); const view=await snapshot.json();
    assert.equal(view.messages.length,2); assert.equal('sessionId' in view,false); assert.equal('grantId' in view,false);
    agentClient=JSON.parse(await sql.query(`select public.fmat_oauth_register('Runtime history fixture',array['http://127.0.0.1:55777/callback'],'${origin}/mcp');`)).clientId;
    const authorization=JSON.parse(await sql.query(`select public.fmat_oauth_authorization_start('${JSON.stringify({clientId:agentClient,resource:origin+'/mcp',redirectUri:'http://127.0.0.1:55777/callback',scope:'request:read',codeChallenge:'A'.repeat(43),codeChallengeMethod:'S256',state:'runtime-test',browserHash:'a'.repeat(64)})}'::jsonb);`)).authorizationId;
    await sql.query(`select public.fmat_oauth_consent('${authorization}','${'a'.repeat(64)}','${JSON.stringify({kind:'guest',requestId:requests[0],tokenHash:createHash('sha256').update(tokens[0]).digest('hex')})}'::jsonb,'grant','${'b'.repeat(64)}');`);
    const agentGrant=JSON.parse(await sql.query(`select fmat.oauth_grant_projection(g) from fmat.oauth_grants g where authorization_id='${authorization}';`)) as AgentTokenGrant;
    const bearer=await new AgentOAuthTokens(env).issue(agentGrant,async()=>{});
    const mcp=agentMcpHttp(env,new AgentCredentials(env,new Database(env)));
    const historyCall=(target:unknown,cursor?:string)=>mcp(new Request(origin+'/mcp',{method:'POST',headers:{authorization:'Bearer '+bearer,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'fmat_read_conversation',arguments:{input:{target,cursor}}}})}));
    const historyResponse=await historyCall({audience:'request_shared',requestId:requests[0]});assert.equal(historyResponse.status,200);
    const historyJson=await historyResponse.json();assert.equal(historyJson.result.isError,undefined,JSON.stringify(historyJson));
    const history=historyJson.result.structuredContent.result;assert.match(JSON.stringify(history.events),/Reply 1:/);assert.match(JSON.stringify(history.events),/Reply 2:/);
    assert.doesNotMatch(JSON.stringify(history),/runtime_session_id|tokenHash|p_grant_id|action.result/);
    assert.equal((await (await historyCall({audience:'host_private',requestId:requests[0]})).json()).result.isError,true);
    assert.equal((await (await historyCall({audience:'request_shared',requestId:requests[1]},history.nextCursor)).json()).result.isError,true);
    await sql.query(`update fmat.requests set token_revoked_at=now() where id='${requests[0]}';`);
    assert.equal((await fetch(`${origin}/api/conversations/${scope}/stream`,{headers:headers()})).status,404);
    assert.equal((await historyCall({audience:'request_shared',requestId:requests[0]},history.nextCursor)).status,401);
    assert.equal((await fetch(`${origin}/api/conversations/${scope}`,{headers:headers()})).status,404);
    assert.equal((await post(`/api/conversations/${scope}/messages`,message)).status,404,'revoked authority cannot replay an accepted message');
    assert.equal((await post(`/api/conversations/${scope}/messages`,{clientId:randomUUID(),text:'revoked input'})).status,404);
    assert.equal((await post('/api/conversations',{audience:'request_shared',requestId:requests[0]})).status,404);
    assert.equal(await sql.query(`select count(*) from fmat.runtime_messages where conversation_id='${scope}';`),'2','revoked calls create no input or replacement scope');

  } finally {
    await stop(); await writeFile(join(fixture,'server.log'),serverLog);
    if(agentClient)await sql.query(`delete from fmat.oauth_codes where grant_id in(select id from fmat.oauth_grants where client_id='${agentClient}');delete from fmat.oauth_grants where client_id='${agentClient}';delete from fmat.oauth_authorizations where client_id='${agentClient}';delete from fmat.oauth_clients where id='${agentClient}';`);
    await sql.query(`delete from fmat.idempotency where actor_scope in (${tokens.map(t=>`'guest:${createHash('sha256').update(t).digest('hex')}'`).join(',')});
      delete from fmat.audit_events where subject_id in ('${requests[0]}','${requests[1]}');
      delete from fmat.model_work_attempts where name in (select 'conversation:'||id::text from fmat.runtime_messages where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}'));
      delete from fmat.model_budgets where name in ('host:${host}','guest:${requests[0]}','guest:${requests[1]}');
      delete from fmat.runtime_messages where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');
      delete from fmat.conversation_grants where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');
      delete from fmat.conversation_scopes where host_id='${host}';
      delete from fmat.request_history where request_id in ('${requests[0]}','${requests[1]}');
      delete from fmat.requests where host_id='${host}'; delete from fmat.hosts where id='${host}'; delete from fmat.invitations where id='${invitation}';`).finally(()=>sql.close());
  }
});
