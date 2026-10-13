import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

type Query=(target:string,sql:string)=>string;
const literal=(value:unknown)=>"'"+String(value).replaceAll("'","''")+"'";
const json=(value:unknown)=>literal(JSON.stringify(value))+'::jsonb';
type Claim={action:string;shareId:string;leaseToken:string;line:string;spaceId:string;phone:string};

// These isolated containers have no network or running cron. Linked identities
// and provider acknowledgement are synthetic; all intent/lease transitions use
// the application RPCs whose stored outcomes must survive export and restore.
export function prepareContactRestore(query:Query,source:string,hostId:string){
 const sessionId=randomUUID(),credential={kind:'host',subject:hostId,sessionId,expiresAt:new Date(Date.now()+3600000).toISOString()};
 query(source,`insert into auth.sessions(id,user_id) values(${literal(sessionId)},${literal(hostId)});`);
 const delivery=(target:string,project:string,operation:string,input:unknown={})=>JSON.parse(query(target,`select public.fmat_photon_contact_delivery(${literal(operation)},${literal(project)},${json(input)});`));
 const request=(target:string,project:string,input:unknown)=>JSON.parse(query(target,`select public.fmat_photon_contact('request',${json(credential)},${literal(project)},${json(input)});`));
 const fixtures=['accepted','dispatching','queued'].map((status,index)=>{
  const project=randomUUID(),linkId=randomUUID(),challenge=randomUUID(),phone='+1555060000'+index,input={linkId,idempotencyKey:randomUUID()};
  query(source,`begin;
   update fmat.photon_links set revoked_at=now() where host_id=${literal(hostId)} and revoked_at is null;
   insert into fmat.photon_receivers(project_id,receiver_id,enabled) values(${literal(project)},${literal(randomUUID())},true);
   insert into fmat.photon_link_challenges(id,host_id,project_id,credential,browser_hash,phone,line,space_id,code_hash,request_key,consumed_at,delivery_status)
    values(${literal(challenge)},${literal(hostId)},${literal(project)},${json(credential)},repeat('a',64),${literal(phone)},'shared',${literal('any;-;'+phone)},repeat('b',64),${literal(randomUUID())},now(),'accepted');
   insert into fmat.photon_links(id,host_id,project_id,phone,line,space_id,challenge_id)
    values(${literal(linkId)},${literal(hostId)},${literal(project)},${literal(phone)},'shared',${literal('any;-;'+phone)},${literal(challenge)});
   commit;`);
  const state=request(source,project,input),claim=delivery(source,project,'claim') as Claim;
  assert.equal(claim.action,'send');assert.equal(claim.shareId,state.id);
  const lease={shareId:claim.shareId,leaseToken:claim.leaseToken};
  if(status!=='queued')assert.equal(delivery(source,project,'dispatch',lease).authorized,true);
  if(status==='accepted')delivery(source,project,'finish',{...lease,status:'accepted'});
  else query(source,`update fmat.photon_contact_shares set lease_until=now()-interval '1 second' where id=${literal(state.id)};`);
  const alias={linkId,idempotencyKey:randomUUID()};
  if(status==='queued')assert.deepEqual(request(source,project,alias),state);
  return {status,project,input,alias,state,claim,lease};
 });
 return (target:string)=>{
  for(const fixture of fixtures){
   const {status,project,state,claim,lease}=fixture;
   assert.equal(query(target,`select status from fmat.photon_contact_shares where id=${literal(state.id)};`),status);
   if(status==='accepted'){
    assert.equal(delivery(target,project,'claim').action,'idle','accepted sharing never becomes dispatchable after restore');
    assert.throws(()=>delivery(target,project,'dispatch',lease),/REVISION_CONFLICT/u);
   }else if(status==='dispatching'){
    assert.equal(delivery(target,project,'claim').action,'uncertain','restored in-flight sharing cannot be dispatched again');
    assert.equal(delivery(target,project,'claim').action,'idle');
    for(const operation of ['dispatch','finish'])assert.throws(()=>delivery(target,project,operation,{...lease,...(operation==='finish'?{status:'accepted'}:{})}),/REVISION_CONFLICT/u);
    assert.equal(query(target,`select status from fmat.photon_contact_shares where id=${literal(state.id)};`),'uncertain');
   }else{
    assert.deepEqual(request(target,project,fixture.input),state,'original retry key survives restore');
    assert.deepEqual(request(target,project,fixture.alias),state,'additional remembered retry key survives restore');
    const next=delivery(target,project,'claim') as Claim;
    assert.equal(next.action,'send');assert.equal(next.shareId,state.id);assert.notEqual(next.leaseToken,claim.leaseToken);
    assert.deepEqual([next.phone,next.line,next.spaceId],[claim.phone,claim.line,claim.spaceId],'recovery preserves the frozen private route');
    assert.equal(query(target,`select attempts from fmat.photon_contact_shares where id=${literal(state.id)};`),'2','restoring does not erase the consumed claim');
    assert.throws(()=>delivery(target,project,'dispatch',lease),/REVISION_CONFLICT/u);
    // Authority is rechecked after recovery/preflight, not inferred from a
    // successfully restored row or a fresh worker lease.
    query(target,`update auth.sessions set not_after=now()-interval '1 second' where id=${literal(sessionId)};`);
    assert.equal(delivery(target,project,'dispatch',{shareId:next.shareId,leaseToken:next.leaseToken}).authorized,false);
    assert.equal(query(target,`select status from fmat.photon_contact_shares where id=${literal(state.id)};`),'revoked');
    assert.equal(delivery(target,project,'claim').action,'idle');
   }
  }
  assert.equal(query(target,`select count(*) from fmat.photon_contact_shares where host_id=${literal(hostId)};`),'3','restored retries cannot add a second intent');
 };
}
