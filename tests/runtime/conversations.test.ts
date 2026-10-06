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
    'agent/tools/update_request_details.ts':'tests/runtime/fixture-update-tool.ts',
  })) await writeFile(join(fixture,target), `export { default } from ${JSON.stringify(resolve(source))};\n`);
  const build = spawn(process.execPath,[join(root,'node_modules/eve/bin/eve.js'),'build','--skip-sandbox-prewarm'], { cwd:fixture,stdio:['ignore','pipe','pipe'] });
  let buildLog=''; build.stdout.on('data', x=>buildLog+=x); build.stderr.on('data',x=>buildLog+=x);
  const [buildCode] = await once(build,'close');
  await writeFile(join(fixture,'build.log'),buildLog); assert.equal(buildCode,0,buildLog.slice(-4000));
  const portServer=createServer(); portServer.listen(0,'127.0.0.1'); await once(portServer,'listening');
  const port=(portServer.address() as {port:number}).port; await new Promise<void>(r=>portServer.close(()=>r()));
  const origin=`http://127.0.0.1:${port}`, marker=join(fixture,'tool-committed');
  const env={...process.env, SUPABASE_URL:local.API_URL, SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,
    SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY, APP_ORIGIN:origin, PORT:String(port), HOST:'127.0.0.1',
    // The bundled Workflow runtime defaults to an 860-second inline ownership
    // lease. Accelerate expiration only in this isolated crash-test process;
    // production retains its default lease and never imports this fixture.
    WORKFLOW_INLINE_OWNERSHIP_LEASE_SECONDS:'5',
    FMAT_TEST_MARKER:marker, OPENAI_API_KEY:'', NODE_ENV:'development'};
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
    const message={clientId:randomUUID(),text:'save: a post-commit recovery test'};
    const sent=await post(`/api/conversations/${scope}/messages`,message); assert.equal(sent.status,202,await sent.clone().text());
    await waitUntil(async()=>{try{await access(marker);return true;}catch{return false;}},'Tool did not reach commit');
    assert.equal(await sql.query(`select revision from fmat.requests where id='${requests[0]}';`),'2');
    assert.equal((await post(`/api/conversations/${scope}/messages`,{...message,text:'conflicting retry'})).status,409);
    await stop(); await writeFile(marker+'.release','resume'); await start(true);
    const retry=await post(`/api/conversations/${scope}/messages`,message); assert.equal(retry.status,202,await retry.clone().text());
    await waitUntil(async()=>await sql.query(`select status from fmat.runtime_messages where conversation_id='${scope}';`)==='completed','Runtime failed to recover after kill');
    assert.equal(await sql.query(`select revision from fmat.requests where id='${requests[0]}';`),'2','interrupted tool commits one effect despite regenerated call ID');
    assert.equal((await post(`/api/conversations/${scope}/messages`,message)).status,200);
    const controller=new AbortController();
    const stream=await fetch(`${origin}/api/conversations/${scope}/stream`,{headers:headers(),signal:controller.signal}); assert.equal(stream.status,200);
    const reader=stream.body!.getReader(); let output='';
    while(!output.includes('session.waiting')) { const item=await reader.read();if(item.done)break;output+=new TextDecoder().decode(item.value); }
    controller.abort();
    assert.match(output,/Reply 1:/u); assert.doesNotMatch(output,/p_grant_id|tokenHash|tool-committed/u);
    const cursor=(JSON.parse(output.trim().split('\n').at(-1)!) as {cursor:number}).cursor;
    const next=await post(`/api/conversations/${scope}/messages`,{clientId:randomUUID(),text:'Continue the same request.'});
    assert.equal(next.status,202,await next.clone().text());
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
    await sql.query(`update fmat.requests set token_revoked_at=now() where id='${requests[0]}';`);
    assert.equal((await fetch(`${origin}/api/conversations/${scope}/stream`,{headers:headers()})).status,404);
  } finally {
    await stop(); await writeFile(join(fixture,'server.log'),serverLog);
    await sql.query(`delete from fmat.idempotency where actor_scope in (${tokens.map(t=>`'guest:${createHash('sha256').update(t).digest('hex')}'`).join(',')});
      delete from fmat.audit_events where subject_id in ('${requests[0]}','${requests[1]}');
      delete from fmat.runtime_messages where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');
      delete from fmat.conversation_grants where conversation_id in(select id from fmat.conversation_scopes where host_id='${host}');
      delete from fmat.conversation_scopes where host_id='${host}';
      delete from fmat.request_history where request_id in ('${requests[0]}','${requests[1]}');
      delete from fmat.requests where host_id='${host}'; delete from fmat.hosts where id='${host}'; delete from fmat.invitations where id='${invitation}';`).finally(()=>sql.close());
  }
});
