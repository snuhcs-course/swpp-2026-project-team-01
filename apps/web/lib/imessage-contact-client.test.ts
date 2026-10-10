import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {contactCall} from './imessage-contact-client.ts';
import {IMessageRequestError} from './imessage-client.ts';

test('contact client binds private reads and exact request identity to the current link',async()=>{
 const original=globalThis.fetch,linkId=randomUUID(),idempotencyKey=randomUUID();
 const state={id:randomUUID(),linkId,requestedAt:new Date().toISOString(),status:'queued'};
 const calls:{url:string;init:RequestInit|undefined}[]=[];
 try{
  globalThis.fetch=async(url,init)=>{calls.push({url:String(url),init});return Response.json(init?.method==='POST'?state:null);};
  assert.equal(await contactCall(linkId),null);assert.deepEqual(await contactCall(linkId,idempotencyKey),state);
  assert.equal(calls[0].url,'/api/browser/imessage/contact/read?linkId='+linkId);assert.equal(calls[0].init?.body,undefined);
  assert.equal(calls[1].url,'/api/browser/imessage/contact/request');assert.deepEqual(JSON.parse(String(calls[1].init?.body)),{linkId,idempotencyKey});
  for(const {init} of calls){assert.equal(init?.cache,'no-store');assert.ok(init?.signal);}
 }finally{globalThis.fetch=original;}
});

test('contact client rejects another link, unexpected private fields and ambiguous mutation replies',async()=>{
 const original=globalThis.fetch,linkId=randomUUID(),state={id:randomUUID(),linkId,requestedAt:new Date().toISOString(),status:'accepted'};
 try{
  for(const value of [{...state,linkId:randomUUID()},{...state,phone:'+15550100001'},{...state,status:'delivered'}]){
   globalThis.fetch=async()=>Response.json(value);await assert.rejects(contactCall(linkId),IMessageRequestError);
  }
  globalThis.fetch=async()=>Response.json(null);await assert.rejects(contactCall(linkId,randomUUID()),IMessageRequestError);
  globalThis.fetch=async()=>{throw new Error('private network detail');};await assert.rejects(contactCall(linkId),error=>error instanceof IMessageRequestError&&!error.message.includes('private network detail'));
  globalThis.fetch=async()=>new Response('private provider detail',{status:502});await assert.rejects(contactCall(linkId),error=>error instanceof IMessageRequestError&&!error.message.includes('private provider detail'));
  globalThis.fetch=async()=>Response.json({ok:false,error:{code:'UNAUTHORIZED',message:'Sign in again.',correlationId:randomUUID()}},{status:401});
  await assert.rejects(contactCall(linkId),error=>error instanceof IMessageRequestError&&error.code==='UNAUTHORIZED');
 }finally{globalThis.fetch=original;}
});
