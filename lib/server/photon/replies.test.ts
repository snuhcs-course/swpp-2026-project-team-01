import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {dispatchPhotonReplies} from './replies.ts';
import {formatPhotonReply} from './reply-text.ts';
import {ApplicationError} from '../errors.ts';

test('reply worker freezes ID and recipient, reauthorizes after preflight and never resends reconciliation',async()=>{
 const project=randomUUID(),reply=randomUUID(),lease=randomUUID(),phone='+15550100001';
 const item={action:'send',replyId:reply,projectId:project,leaseToken:lease,phone,line:'shared',spaceId:'any;-;'+phone,text:'Private reply',providerReference:null};
 let claims=0,authorizations=0,sends=0;const records:unknown[]=[];
 const db={async rpc(_name:string,input:Record<string,unknown>){
  if(input.p_operation==='claim')return claims++===0?item:{action:'idle'};
  if(input.p_operation==='authorize')authorizations++;
  if(input.p_operation==='finish')records.push(input.p_input);
  return {};
 }};
 const transport={async send(route:unknown,recipient:string,text:string,id:string,authorize:()=>Promise<void>){sends++;assert.deepEqual(route,{line:'shared',spaceId:'any;-;'+phone});assert.equal(recipient,phone);assert.equal(text,'Private reply');assert.equal(id,reply);await authorize();return {status:'uncertain' as const,providerReference:null};},async reconcile(){return {status:'uncertain' as const,providerReference:null};}};
 assert.deepEqual(await dispatchPhotonReplies(db,{PHOTON_PROJECT_ID:project},transport),{claimed:1,suppressed:0,recorded:1});assert.equal(sends,1);assert.equal(authorizations,2);
 assert.deepEqual(records,[{replyId:reply,leaseToken:lease,status:'uncertain',providerReference:null}]);
 claims=0;item.action='reconcile';item.text=null as unknown as string;await dispatchPhotonReplies(db,{PHOTON_PROJECT_ID:project},transport);assert.equal(sends,1);
 claims=0;const revoked={async rpc(name:string,input:Record<string,unknown>){if(input.p_operation==='authorize')throw new ApplicationError('FORBIDDEN',403);return db.rpc(name,input);}};
 await dispatchPhotonReplies(revoked,{PHOTON_PROJECT_ID:project},transport);assert.equal((records.at(-1) as {status:string}).status,'revoked');assert.equal(sends,1);
});

test('reply formatting bounds Unicode without hiding full web continuation',()=>{
 assert.equal(formatPhotonReply(' hello ','https://fixture.invalid'),'hello');
 const result=formatPhotonReply('🙂'.repeat(4100),'https://fixture.invalid');
 assert.ok(Array.from(result).length<=4000);assert.match(result,/Read the full reply: https:\/\/fixture.invalid\/app$/u);assert.ok(!result.includes('\ufffd'));
});

test('reply receipt retries preserve a validated provider reference without repeating the send',async()=>{
 const project=randomUUID(),replyId=randomUUID(),leaseToken=randomUUID(),phone='+15550100001';
 const item={action:'send',replyId,leaseToken,projectId:project,phone,line:'shared',spaceId:'any;-;'+phone,text:'Frozen reply',providerReference:null};
 let claims=0,sends=0;const attempts:unknown[]=[];
 const database={async rpc(_name:string,input:Record<string,unknown>){
  if(input.p_operation==='claim')return claims++===0?item:{action:'idle'};
  if(input.p_operation==='finish'){
   attempts.push(input.p_input);
   if(attempts.length===1)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  }
  return {};
 }};
 const transport={async send(){sends++;return {status:'accepted' as const,providerReference:'validated-reference'};},async reconcile(){assert.fail('A receipt retry cannot issue a provider read');}};
 assert.deepEqual(await dispatchPhotonReplies(database,{PHOTON_PROJECT_ID:project},transport),{claimed:1,suppressed:0,recorded:1});
 assert.equal(sends,1);assert.equal(attempts.length,2);assert.deepEqual(attempts[0],attempts[1]);
 assert.deepEqual(attempts[1],{replyId,leaseToken,status:'accepted',providerReference:'validated-reference'});
});
