import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {Webhook} from 'svix';
import {verifiedAgentMailReceipt} from '../../lib/server/agentmail/webhook.ts';
const key=Buffer.alloc(32,7),receiver={secret:'whsec_'+key.toString('base64'),inboxId:'controlled@agentmail.to'};
const fixture=()=>({type:'event',event_type:'message.received',event_id:'event-1',message:{inbox_id:receiver.inboxId,thread_id:'thread-1',message_id:'<message-1@example.test>',timestamp:'2026-10-08T00:00:00Z',from:'Display <sender@example.test>',text:'Private text',html:'<b>Private</b>',headers:{'Authentication-Results':'attacker supplied'},attachments:[{filename:'private.txt'}]},thread:{inbox_id:receiver.inboxId,thread_id:'thread-1',senders:['private@example.test']}});
function signed(body:unknown=fixture(),options:{raw?:string;timestamp?:number;id?:string;key?:Buffer;signature?:string;headers?:Record<string,string>}={}){
 const raw=options.raw??JSON.stringify(body),id=options.id??'msg_delivery_1',timestamp=String(options.timestamp??Math.floor(Date.now()/1000));
 const signature='v1,'+createHmac('sha256',options.key??key).update(`${id}.${timestamp}.${raw}`).digest('base64');
 return new Request('https://release.invalid/api/providers/agentmail',{method:'POST',body:raw,headers:{'content-type':'application/json','svix-id':id,'svix-timestamp':timestamp,'svix-signature':options.signature??signature,...options.headers}});
}
test('AgentMail verifies original Unicode bytes using Svix 2.7 and projects only transport locators',async()=>{
 const body=fixture();body.message.text='오후 ☕';const raw=JSON.stringify(body,null,2);
 assert.deepEqual(await verifiedAgentMailReceipt(signed(body,{raw}),receiver),{deliveryId:'msg_delivery_1',eventId:'event-1',inboxId:receiver.inboxId,threadId:'thread-1',messageId:'<message-1@example.test>',occurredAt:body.message.timestamp,payloadHash:createHash('sha256').update(raw).digest('hex')});
 const {text,html,...message}=body.message;assert.ok(await verifiedAgentMailReceipt(signed({...body,message}),receiver),'Omitted bodies remain locators for a later bounded message read');
});
test('AgentMail rejects forged, stale, future, swapped or changed-body deliveries and accepts a valid rotation signature',async()=>{
 const now=Math.floor(Date.now()/1000),good=signed(),sig=good.headers.get('svix-signature')!;
 for(const request of [signed(undefined,{key:Buffer.alloc(32,8)}),signed(undefined,{timestamp:now-301}),signed(undefined,{timestamp:now+601}),signed(undefined,{headers:{'svix-id':'swapped'}}),signed(undefined,{raw:JSON.stringify(fixture())+' ',signature:sig}),signed(undefined,{headers:{'svix-timestamp':'1junk'}})])await assert.rejects(()=>verifiedAgentMailReceipt(request,receiver),{code:'UNAUTHORIZED'});
 assert.ok(await verifiedAgentMailReceipt(signed(undefined,{signature:'v1,invalid '+sig,timestamp:Number(good.headers.get('svix-timestamp'))}),receiver));
});
test('Transport signature never makes spam, blocked, unauthenticated or other events dispatchable',async()=>{
 for(const event_type of ['message.received.spam','message.received.blocked','message.received.unauthenticated','message.sent','calendar.event.created'])assert.equal(await verifiedAgentMailReceipt(signed({...fixture(),event_type}),receiver),null);
});
test('AgentMail fences the intended inbox, conflicting route copies and malformed payloads',async()=>{
 const body=fixture();body.message.inbox_id='other@agentmail.to';await assert.rejects(()=>verifiedAgentMailReceipt(signed(body),receiver),{status:403});
 const conflict=fixture();conflict.thread.thread_id='another';await assert.rejects(()=>verifiedAgentMailReceipt(signed(conflict),receiver),{code:'INVALID_INPUT'});
 await assert.rejects(()=>verifiedAgentMailReceipt(signed(undefined,{raw:'{broken'}),receiver),{code:'INVALID_INPUT'});
 await assert.rejects(()=>verifiedAgentMailReceipt(signed({...fixture(),message:{...fixture().message,message_id:'bad\nidentity'}}),receiver),{code:'INVALID_INPUT'});
 await assert.rejects(()=>verifiedAgentMailReceipt(signed(),{...receiver,secret:''}),{status:503});
});
test('Receipt identity is stable on retries while changed signed content changes the digest',async()=>{
 const first=await verifiedAgentMailReceipt(signed(),receiver),retry=await verifiedAgentMailReceipt(signed(undefined,{timestamp:Math.floor(Date.now()/1000)-10}),receiver);assert.deepEqual(first,retry);
 const changed=fixture();changed.message.text='Changed';const next=await verifiedAgentMailReceipt(signed(changed),receiver);assert.equal(next?.eventId,first?.eventId);assert.notEqual(next?.payloadHash,first?.payloadHash);
 // Durable duplicate/conflict rejection is verified in the real ingress integration.
});
test('AgentMail bounds payload bytes, media types and stalled reads before any persistence',async()=>{
 await assert.rejects(()=>verifiedAgentMailReceipt(signed(undefined,{raw:'x'.repeat(1048577)}),receiver),{status:413});
 await assert.rejects(()=>verifiedAgentMailReceipt(signed(undefined,{headers:{'content-type':'text/plain'}}),receiver),{status:400});
 let canceled=false;const request=new Request('https://release.invalid/',{method:'POST',headers:signed().headers,body:new ReadableStream({cancel(){canceled=true;}}),duplex:'half'} as RequestInit);
 await assert.rejects(()=>verifiedAgentMailReceipt(request,receiver),{status:408});assert.equal(canceled,true);
});

test('AgentMail rejects signed invalid UTF-8 and respects a caller-aborted read',async()=>{
 const bytes=Buffer.from([0xff,0xfe]),id='delivery-utf8',timestamp=String(Math.floor(Date.now()/1000));
 const signature='v1,'+createHmac('sha256',key).update(`${id}.${timestamp}.`).update(bytes).digest('base64');
 const invalid=new Request('https://release.invalid/',{method:'POST',body:bytes,headers:{'content-type':'application/json','svix-id':id,'svix-timestamp':timestamp,'svix-signature':signature}});
 await assert.rejects(()=>verifiedAgentMailReceipt(invalid,receiver),{status:400});
 const controller=new AbortController();let canceled=false;
 const stalled=new Request('https://release.invalid/',{method:'POST',headers:signed().headers,body:new ReadableStream({cancel(){canceled=true;}}),signal:controller.signal,duplex:'half'} as RequestInit);
 const result=verifiedAgentMailReceipt(stalled,receiver);controller.abort();await assert.rejects(()=>result,{status:400});assert.equal(canceled,true);
});

test('AgentMail cancels a body when the caller already aborted before verification',async()=>{
 const controller=new AbortController();controller.abort();let cancelled=false;
 const request=new Request('https://release.invalid/',{method:'POST',headers:signed().headers,
  body:new ReadableStream({cancel(){cancelled=true;}}),signal:controller.signal,duplex:'half'} as RequestInit);
 await assert.rejects(verifiedAgentMailReceipt(request,receiver),{code:'INVALID_INPUT'});
 assert.equal(cancelled,true);
});


test('published independent Svix vector verifies exact bytes without granting application ingress',async t=>{
 t.mock.timers.enable({apis:['Date'],now:1731705121000});
 // Fixed vector retained from the original probe, not signed by this fixture.
 const secret='whsec_plJ3nmyCDGBKInavdOK15jsl';
 const body='{"event_type":"ping","data":{"success":true}}';
 const headers={'svix-id':'msg_loFOjxBNrRLzqYUf','svix-timestamp':'1731705121','svix-signature':'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0='};
 assert.doesNotThrow(()=>new Webhook(secret).verify(body,headers));
 const request=(raw=body)=>new Request('https://release.invalid/',{method:'POST',headers:{...headers,'content-type':'application/json'},body:raw});
 const configured={secret,inboxId:receiver.inboxId};
 // Valid transport signature; the historical ping lacks the required event ID.
 await assert.rejects(verifiedAgentMailReceipt(request(),configured),{code:'INVALID_INPUT'});
 await assert.rejects(verifiedAgentMailReceipt(request(body+' '),configured),{code:'UNAUTHORIZED'});
 t.mock.timers.setTime(1731705431000);
 await assert.rejects(verifiedAgentMailReceipt(request(),configured),{code:'UNAUTHORIZED'});
});
