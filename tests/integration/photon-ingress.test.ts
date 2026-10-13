import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHmac} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {Database} from '../../lib/server/database/client.ts';
import {photonWebhook} from '../../lib/server/photon/webhook.ts';
import {LocalSql} from './local-sql.ts';

test('signed Photon receipt survives concurrent replay, lost commit acknowledgement and receiver fencing',{timeout:30_000},async()=>{
  const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
  const project=randomUUID(),receiver=randomUUID(),secret=randomUUID()+randomUUID();
  const env={SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,PHOTON_PROJECT_ID:project,PHOTON_WEBHOOK_ID:receiver,IMESSAGE_WEBHOOK_SECRET:secret};
  const sql=new LocalSql(),holder=new LocalSql(),database=new Database(env);
  const space={id:'any;-;+15550100001',platform:'imessage',type:'dm',phone:'shared'};
  function request(id:string){const timestamp=String(Math.floor(Date.now()/1000));
    const body=JSON.stringify({event:'messages',space,message:{id,platform:'imessage',direction:'inbound',timestamp:'2026-10-07T00:00:00Z',
      sender:{id:'+15550100001',platform:'imessage'},space,content:{type:'text',text:'Synthetic preference'}}});
    return new Request('https://fixture.invalid/api/providers/photon',{method:'POST',body,headers:{'content-type':'application/json',
      'x-spectrum-webhook-id':receiver,'x-spectrum-timestamp':timestamp,'x-spectrum-signature':'v0='+createHmac('sha256',secret).update(`v0:${timestamp}:${body}`).digest('hex')}});
  }
  const counts=()=>sql.query(`select count(*) from fmat.photon_inbox where project_id='${project}';`);
  try{
    await sql.query(`insert into fmat.photon_receivers(project_id,receiver_id,enabled) values('${project}','${receiver}',true);`);
    const duplicate=await Promise.all(Array.from({length:8},()=>photonWebhook(request('concurrent'),{env,database})));
    assert.deepEqual(duplicate.map(r=>r.status),Array(8).fill(200));assert.equal(await counts(),'1');
    const lost=new Database(env,async(...args)=>{const result=await fetch(...args);assert.equal(result.status,200);await result.text();throw new Error('Synthetic response loss after commit');});
    assert.equal((await photonWebhook(request('lost-response'),{env,database:lost})).status,503);
    assert.equal(await counts(),'2');
    assert.equal((await photonWebhook(request('lost-response'),{env,database})).status,200);
    assert.equal(await counts(),'2');
    assert.equal(await sql.query(`select count(*) from fmat.jobs j join fmat.photon_inbox i on j.payload->>'inboxId'=i.id::text where i.project_id='${project}' and j.kind='photon_ingress';`),'2');
    // Observe a real lock wait. Disabling the receiver wins before the waiting
    // request can read the registry or commit a new inbox/job pair.
    const pid=await holder.query(`begin;select pg_backend_pid();update fmat.photon_receivers set enabled=false where project_id='${project}';`);
    const blocked=photonWebhook(request('fenced'),{env,database});
    let waiting=false;
    for(let n=0;n<100;n++){
      waiting=await sql.query(`select exists(select 1 from pg_stat_activity a where ${Number(pid)}=any(pg_blocking_pids(a.pid)));`)==='t';
      if(waiting)break;await delay(20);
    }
    assert.equal(waiting,true,'request blocked on receiver registry');await holder.query('commit;');
    assert.equal((await blocked).status,503);assert.equal(await counts(),'2');
    assert.equal((await photonWebhook(request('concurrent'),{env,database})).status,503,'revocation also fences old replay');
  }finally{
    await holder.query('rollback;');
    await sql.query(`delete from fmat.queue_publications p using fmat.jobs j,fmat.photon_inbox i where p.job_id=j.id and j.payload->>'inboxId'=i.id::text and i.project_id='${project}';
      delete from pgmq.q_fmat_jobs q using fmat.jobs j,fmat.photon_inbox i where q.message->>'jobId'=j.id::text and j.payload->>'inboxId'=i.id::text and i.project_id='${project}';
      delete from fmat.jobs j using fmat.photon_inbox i where j.payload->>'inboxId'=i.id::text and i.project_id='${project}';
      delete from fmat.photon_inbox where project_id='${project}';delete from fmat.photon_receivers where project_id='${project}';`);
    sql.close();holder.close();
  }
});
