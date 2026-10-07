import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {BookingReceipt} from '../../lib/server/booking/receipt.ts';
import {Database} from '../../lib/server/database/client.ts';
import {guestCredential,type Credential} from '../../lib/server/identity/credentials.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
import {LocalSql} from './local-sql.ts';
export async function verifyBookingReceipt(db:Database,requestId:string,host:Credential,otherHost:Credential,guest:Credential){
 const sql=new LocalSql(),service=new BookingReceipt(db),target={requestId};
 const denied=(code:string)=>(error:unknown)=>error instanceof ApplicationError&&error.code===code;
 try{
  const initial=await service.read(guest,target);assert.equal(initial.status,'booked');assert.equal(initial.closed,true);assert.equal(initial.receipt?.title,'Meeting: Approved fixture');assert.equal(initial.receipt?.purpose,'Approved fixture');assert.equal(initial.receipt?.location,'https://meet.example.test/approved');assert.equal(initial.receipt?.participants.length,2);assert.equal(initial.emailStatus,'pending');
  assert.deepEqual((await service.read(host,target)).receipt,initial.receipt);
  await assert.rejects(service.read(otherHost,target),denied('NOT_FOUND'));await assert.rejects(service.read(guestCredential(requestId,randomBytes(32).toString('base64url')),target),denied('NOT_FOUND'));
  await assert.rejects(service.read(guest,{requestId:randomUUID()}),denied('NOT_FOUND'));await assert.rejects(service.read({...guest},target),denied('UNAUTHORIZED'));await assert.rejects(service.read(guest,{...target,audience:'host'}));
  // Receipt comes from the frozen confirmed attempt/proposal, not editable data.
  const details=await sql.query(`select details::text from fmat.requests where id='${requestId}';`);
  await sql.query(`update fmat.requests set private_notes='private receipt sentinel',private_diagnostics='[{"secret":"private diagnostic sentinel"}]',details=jsonb_set(details,'{purpose}','"changed request purpose"') where id='${requestId}';update fmat.outbox set status=case when audience='host' then 'failed' else 'uncertain' end where payload->>'requestId'='${requestId}';`);
  const changed=await service.read(guest,target);assert.deepEqual(changed.receipt,initial.receipt);assert.equal(changed.emailStatus,'uncertain');assert.equal((await service.read(host,target)).emailStatus,'failed');assert.doesNotMatch(JSON.stringify(changed),/private|diagnostic|token|fingerprint|calendarId|connection|changed request/u);
  await sql.query(`update fmat.requests set details='${details.replaceAll("'","''")}',token_revoked_at=clock_timestamp() where id='${requestId}';`);
  assert.deepEqual((await service.read(guest,target)).receipt,initial.receipt,'Closure revocation preserves only unexpired receipt access');
  const hash=await sql.query(`select token_hash from fmat.requests where id='${requestId}';`);await sql.query(`update fmat.requests set token_hash=repeat('9',64) where id='${requestId}';`);await assert.rejects(service.read(guest,target),denied('NOT_FOUND'));await sql.query(`update fmat.requests set token_hash='${hash}' where id='${requestId}';`);
  const expiry=await sql.query(`select token_expires_at::text from fmat.requests where id='${requestId}';`);
  await sql.query(`update fmat.requests set token_expires_at=clock_timestamp()+interval '1 second' where id='${requestId}';`);
  const lock=new LocalSql();try{
   await lock.query(`begin;select id from fmat.requests where id='${requestId}' for update;`);
   const pending=assert.rejects(service.read(guest,target),denied('NOT_FOUND'));await new Promise(resolve=>setTimeout(resolve,1100));await lock.query('rollback;');await pending;
  }finally{lock.close();}
  await sql.query(`update fmat.requests set token_expires_at='${expiry}' where id='${requestId}';`);
  if(host.kind!=='host')throw new Error('Host fixture required');
  await sql.query(`update fmat.hosts set revoked_at=clock_timestamp() where id='${host.subject}';`);await assert.rejects(service.read(host,target),denied('HOST_NOT_ADMITTED'));await sql.query(`update fmat.hosts set revoked_at=null where id='${host.subject}';`);
  // Without matching persisted provider evidence no confirmed receipt is exposed.
  const event=await sql.query(`select event::text from fmat.requests where id='${requestId}';`);await sql.query(`update fmat.requests set event='{"id":"wrong"}' where id='${requestId}';`);assert.equal((await service.read(guest,target)).receipt,null);await sql.query(`update fmat.requests set event='${event.replaceAll("'","''")}' where id='${requestId}';`);
  assert.equal(await sql.query(`select has_function_privilege('anon','public.fmat_booking_receipt(jsonb,jsonb)','EXECUTE')||','||has_function_privilege('authenticated','public.fmat_booking_receipt(jsonb,jsonb)','EXECUTE')||','||has_function_privilege('service_role','fmat.confirmed_booking_receipt(uuid)','EXECUTE');`),'false,false,false');
 }finally{sql.close();}
}
