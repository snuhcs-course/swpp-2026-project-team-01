import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { photonWebhook, verifiedPhotonInput, type PhotonReceiver } from './webhook.ts';
import { ApplicationError } from '../errors.ts';

const receiver:PhotonReceiver={projectId:'10000000-0000-4000-8000-000000000001',receiverId:'20000000-0000-4000-8000-000000000001',secret:'synthetic-webhook-secret-'.repeat(3)};
const now=Date.parse('2026-10-07T00:00:00Z');
const env={PHOTON_PROJECT_ID:receiver.projectId,PHOTON_WEBHOOK_ID:receiver.receiverId,IMESSAGE_WEBHOOK_SECRET:receiver.secret};
export function fixture(){const space={id:'any;-;+15550100001',platform:'imessage',type:'dm',phone:'shared'};
  return {event:'messages',space,message:{id:'opaque-message:1',platform:'imessage',direction:'inbound',timestamp:'2026-10-07T00:00:00Z',
    sender:{id:'+15550100001',platform:'imessage'},space:{...space},content:{type:'text',text:'Afternoons, please.'}}};}
function signed(body:unknown=fixture(), options:{timestamp?:string; headers?:Record<string,string>; raw?:string; secret?:string}={}){
  const raw=options.raw??JSON.stringify(body),timestamp=options.timestamp??String(now/1000);
  return new Request('https://release.invalid/api/providers/photon',{method:'POST',body:raw,headers:{
    'content-type':'application/json','x-spectrum-timestamp':timestamp,'x-spectrum-webhook-id':receiver.receiverId,
    'x-spectrum-signature':'v0='+createHmac('sha256',options.secret??receiver.secret).update(`v0:${timestamp}:${raw}`).digest('hex'),...options.headers}});
}
test('Photon verifies original UTF-8 bytes and returns only minimized transport evidence',async()=>{
  const body=fixture();body.message.content.text='오후 ☕';
  const result=await verifiedPhotonInput(signed(body,{raw:JSON.stringify({...body,privateExtra:'do not persist'},null,2)}),receiver,now);
  assert.deepEqual(result,{messageId:'opaque-message:1',senderId:'+15550100001',spaceId:body.space.id,line:'shared',text:'오후 ☕',occurredAt:'2026-10-07T00:00:00.000Z'});
});
test('Photon rejects forged, transferred, malformed and old/future signatures before persistence',async()=>{
  const cases=[signed(undefined,{secret:'wrong'}),signed(undefined,{timestamp:String(now/1000-301)}),signed(undefined,{timestamp:String(now/1000+301)}),
    signed(undefined,{headers:{'x-spectrum-webhook-id':'30000000-0000-4000-8000-000000000001'}}),
    signed(undefined,{headers:{'x-spectrum-signature':'v0='+('a'.repeat(64))+'junk'}}),signed(undefined,{timestamp:'NaN'})];
  for(const req of cases)await assert.rejects(()=>verifiedPhotonInput(req,receiver,now),{code:'UNAUTHORIZED'});
  await assert.rejects(()=>verifiedPhotonInput(signed(undefined,{raw:'{invalid'}),receiver,now),{code:'INVALID_INPUT'});
  await assert.rejects(()=>verifiedPhotonInput(signed(undefined,{headers:{'x-spectrum-event':'another'}}),receiver,now),{code:'INVALID_INPUT'});
});
test('Photon rejects conflicting identities and drops groups, outbound and unsupported content',async()=>{
  for(const field of ['id','phone','type','platform'] as const){const body=fixture();body.message.space[field]='conflict';
    await assert.rejects(()=>verifiedPhotonInput(signed(body),receiver,now),{code:'INVALID_INPUT'});}
  const group=fixture();group.space.type='group';group.message.space.type='group';
  const outbound=fixture();outbound.message.direction='outbound';
  const attachment=fixture();attachment.message.content.type='attachment';
  const blank=fixture();blank.message.content.text='   ';
  for(const body of [group,outbound,attachment,blank,{event:'future'}])assert.equal(await verifiedPhotonInput(signed(body),receiver,now),null);
});
test('Photon bounds body bytes even without content-length and caps normalized text',async()=>{
  await assert.rejects(()=>verifiedPhotonInput(signed(undefined,{raw:'x'.repeat(32769)}),receiver,now),{status:413});
  const body=fixture();body.message.content.text='x'.repeat(4001);
  await assert.rejects(()=>verifiedPhotonInput(signed(body),receiver,now),{code:'INVALID_INPUT'});
});
test('Photon waits for durable commit; retries failed commits and never returns private provider data',async()=>{
  let release!:()=>void,calls=0,settled=false;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const response=photonWebhook(signed(),{env,now,database:{async rpc(name,input){calls++;assert.equal(name,'fmat_photon_ingress');
    assert.equal(input.p_project_id,receiver.projectId);assert.equal(input.p_receiver_id,receiver.receiverId);await gate;return {private:'never in response'};}}}).then(r=>{settled=true;return r;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.equal(settled,false);
  release();assert.equal((await response).status,200);assert.equal(await (await response).text(),'');
  const failed=await photonWebhook(signed(),{env,now,database:{async rpc(){throw new ApplicationError('PROVIDER_UNAVAILABLE',503);}}});
  assert.equal(failed.status,503);assert.ok(!(await failed.text()).includes('+1555'));
  const denied=await photonWebhook(signed(),{env:{},now,database:{async rpc(){assert.fail('missing config must not persist');}}});
  assert.equal(denied.status,503);
});
