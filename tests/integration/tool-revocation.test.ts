import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { LocalSql } from './local-sql.ts';

async function waitForLock(observer: LocalSql, pid: string) {
  assert.match(pid, /^\d+$/u);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await observer.query(`select cardinality(pg_blocking_pids(${pid}))>0;`) === 't') return;
    await delay(30);
  }
  assert.fail('Expected the competing transaction to wait on the authorization lock');
}

for (const winner of ['tool', 'logout', 'expiry'] as const) {
  test(winner === 'expiry' ? 'conversation tool rejects session expiry during a lock wait' : `conversation tool and logout serialize when ${winner} commits first`, async () => {
    const observer = new LocalSql(), tool = new LocalSql(), revoker = new LocalSql();
    const host = randomUUID(), session = randomUUID(), invitation = randomUUID(), request = randomUUID();
    let grant: { grantId: string; conversationId: string } | undefined;
    try {
      await observer.query(`
        insert into auth.users(id,email,email_confirmed_at) values('${host}','${host}@example.test',now());
        insert into auth.sessions(id,user_id) values('${session}','${host}');
        insert into fmat.invitations(id,email,token_hash,expires_at,issued_by)
          values('${invitation}','${host}@example.test',encode(extensions.digest('${invitation}','sha256'),'hex'),now()+interval '1 day','local-test');
        insert into fmat.hosts(id,email,invitation_id) values('${host}','${host}@example.test','${invitation}');
        insert into fmat.requests(id,host_id,details,token_hash,expires_at)
          values('${request}','${host}','{}',repeat('a',64),now()+interval '1 day');
      `);
      grant = JSON.parse(await observer.query(`select public.fmat_conversation_access('open',
        jsonb_build_object('kind','host','subject','${host}','sessionId','${session}','expiresAt',now()+interval '1 hour'),
        jsonb_build_object('audience','host_private','requestId','${request}'));`));
      assert.ok(grant);
      const command = `select public.fmat_conversation_tool('${grant.grantId}','${grant.conversationId}',
        'private_note_save','{"text":"A single committed note","expectedRevision":1,"idempotencyKey":"concurrency-test"}');`;
      const toolPid = await tool.query('select pg_backend_pid();');
      const revokerPid = await revoker.query('select pg_backend_pid();');
      if (winner === 'tool') {
        await tool.query('begin;');
        await tool.query(command);
        const logout = revoker.query(`delete from auth.sessions where id='${session}';`);
        await waitForLock(observer, revokerPid);
        await tool.query('commit;');
        await logout;
        assert.equal(await observer.query(`select count(*) from fmat.request_messages where request_id='${request}';`), '1');
        await assert.rejects(tool.query(command), /UNAUTHORIZED/u, 'replay after logout cannot reuse cached authorization');
      } else {
        if (winner === 'logout') await revoker.query(`begin; delete from auth.sessions where id='${session}';`);
        else await revoker.query(`update auth.sessions set not_after=clock_timestamp()+interval '2 seconds' where id='${session}';
          begin; select id from auth.sessions where id='${session}' for update;`);
        const rejected = assert.rejects(tool.query(command), /UNAUTHORIZED/u);
        await waitForLock(observer, toolPid);
        if (winner === 'expiry') await observer.query('select pg_sleep(2.1);');
        await revoker.query('commit;');
        await rejected;
        assert.equal(await observer.query(`select count(*) from fmat.request_messages where request_id='${request}';`), '0');
      }
    } finally {
      tool.close(); revoker.close();
      // Exact synthetic fixture cleanup, including command/audit artifacts.
      await observer.query(`
        delete from fmat.idempotency where actor_scope='host:${host}';
        delete from fmat.audit_events where actor->>'id'='${host}';
        delete from fmat.conversation_grants where conversation_id in (select id from fmat.conversation_scopes where host_id='${host}');
        delete from fmat.conversation_scopes where host_id='${host}';
        delete from fmat.request_messages where request_id='${request}';
        delete from fmat.request_history where request_id='${request}';
        delete from fmat.requests where id='${request}';
        delete from fmat.hosts where id='${host}';
        delete from fmat.invitations where id='${invitation}';
        delete from auth.users where id='${host}';
      `).finally(() => observer.close());
    }
  });
}
