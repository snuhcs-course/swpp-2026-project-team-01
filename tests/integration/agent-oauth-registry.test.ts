import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout} from 'node:timers/promises';
import {LocalSql} from './local-sql.ts';

const quote=(value: string)=>`'${value.replaceAll("'","''")}'`;
const resource='https://release.findmeatime.com/mcp';
const start=(clientId: string)=>`select public.fmat_oauth_authorization_start(${quote(JSON.stringify({clientId,resource,redirectUri:'https://client.example/cb',scope:'request:read',codeChallenge:'A'.repeat(43),codeChallengeMethod:'S256',state:'opaque',browserHash:'a'.repeat(64)}))}::jsonb);`;
const json=(value: string)=>JSON.parse(value) as Record<string,string>;
async function blocked(observer: LocalSql,name: string) {
  for(let i=0;i<60;i++) {
    if(await observer.query(`select exists(select 1 from pg_stat_activity where application_name=${quote(name)} and wait_event_type='Lock');`)==='t')return;
    await setTimeout(50);
  }
  throw new Error('Expected database lock wait was not observed');
}

test('OAuth registry serializes ceilings, commits denials and rechecks wall time after locks',async()=>{
  const admin=new LocalSql(),locker=new LocalSql(),waiter=new LocalSql();
  const peers=Array.from({length:24},()=>new LocalSql());
  const prefix=`oauth-registry-${randomUUID()}`;
  let saved='[]';
  try {
    saved=await admin.query('select coalesce(jsonb_agg(to_jsonb(b)),\'[]\') from fmat.oauth_budgets b;');
    await admin.query('delete from fmat.oauth_budgets;');
    const registration=`select public.fmat_oauth_register(${quote(prefix)},array['https://client.example/cb'],${quote(resource)});`;
    const client=json(await admin.query(registration)).clientId;
    assert.ok(client);
    const attempts=await Promise.all(peers.map(p=>p.query(start(client)).then(json)));
    assert.equal(attempts.filter(a=>a.authorizationId).length,20);
    assert.equal(attempts.filter(a=>a.error==='rate_limited').length,4);
    assert.equal(await admin.query(`select authorization_count from fmat.oauth_clients where id=${quote(client)};`),'20');
    assert.equal(await admin.query("select used from fmat.oauth_budgets where name='authorization';"),'24');

    await admin.query("update fmat.oauth_budgets set used=28,window_started_at=clock_timestamp() where name='registration';");
    const registrations=await Promise.all(peers.slice(0,8).map(p=>p.query(registration).then(json)));
    assert.equal(registrations.filter(a=>a.clientId).length,2);
    assert.equal(registrations.filter(a=>a.error==='rate_limited').length,6);
    assert.equal(await admin.query("select used from fmat.oauth_budgets where name='registration';"),'30');

    await admin.query("update fmat.oauth_budgets set used=598,window_started_at=clock_timestamp() where name='authorization';");
    const invalid=await Promise.all(peers.slice(0,8).map(p=>p.query("select public.fmat_oauth_authorization_start('null');").then(json)));
    assert.equal(invalid.filter(a=>a.error==='invalid_request').length,2);
    assert.equal(invalid.filter(a=>a.error==='rate_limited').length,6);
    assert.equal(await admin.query("select used from fmat.oauth_budgets where name='authorization';"),'600');

    const name=`oauth-wait-${randomUUID()}`;
    await waiter.query(`set application_name=${quote(name)};`);
    // The waiting transaction begins before the budget window expires. A
    // transaction-time check would wrongly retain the exhausted old window.
    await admin.query("update fmat.oauth_budgets set window_started_at=clock_timestamp()-interval '59.5 seconds' where name='authorization';");
    await locker.query("begin;select 1 from fmat.oauth_budgets where name='authorization' for update;");
    let pending=waiter.query("select public.fmat_oauth_authorization_start('null');");
    await blocked(admin,name);await locker.query('select pg_sleep(0.7);commit;');
    assert.equal(json(await pending).error,'invalid_request');
    assert.equal(await admin.query("select used from fmat.oauth_budgets where name='authorization';"),'1');

    const authorization=attempts.find(a=>a.authorizationId)!.authorizationId;
    await admin.query(`update fmat.oauth_authorizations set created_at=clock_timestamp()-interval '9 minutes',expires_at=clock_timestamp()+interval '0.5 seconds' where id=${quote(authorization)};`);
    await locker.query(`begin;select 1 from fmat.oauth_clients where id=${quote(client)} for update;`);
    pending=waiter.query(`select public.fmat_oauth_authorization_read(${quote(authorization)},repeat('a',64));`);
    await blocked(admin,name);await locker.query('select pg_sleep(0.7);commit;');
    assert.equal(json(await pending).error,'invalid_request','expiry is checked after waiting for client lock');

    const active=attempts.filter(a=>a.authorizationId)[1].authorizationId;
    await locker.query(`begin;update fmat.oauth_clients set disabled_at=clock_timestamp() where id=${quote(client)};`);
    pending=waiter.query(`select public.fmat_oauth_authorization_read(${quote(active)},repeat('a',64));`);
    await blocked(admin,name);await locker.query('commit;');
    assert.equal(json(await pending).error,'invalid_request','committed client disablement wins blocked readback');
  } finally {
    await locker.query('rollback;').catch(()=>{});
    await admin.query(`delete from fmat.oauth_authorizations where client_id in(select id from fmat.oauth_clients where name=${quote(prefix)});delete from fmat.oauth_clients where name=${quote(prefix)};delete from fmat.oauth_budgets;insert into fmat.oauth_budgets select * from jsonb_populate_recordset(null::fmat.oauth_budgets,${quote(saved)}::jsonb);`);
    for(const sql of [admin,locker,waiter,...peers])sql.close();
  }
});
