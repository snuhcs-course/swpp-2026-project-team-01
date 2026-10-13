import test from 'node:test';
import assert from 'node:assert/strict';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {ModelHistory,type ArchiveStream} from './model-history.ts';
const scope='96000000-0000-4000-8000-000000000001',grant='96000000-0000-4000-8000-000000000002';
const auth={authenticator:'fmat-conversation',principalType:'user',principalId:grant,attributes:{conversationId:scope,messageId:'96000000-0000-4000-8000-000000000003'}};
const timeline={conversationId:scope,audience:'host_private',generation:1,generations:[{generation:0,sessionId:'old',terminalTail:204},{generation:1,sessionId:'current',terminalTail:null}]};
const events=Array.from({length:205},(_,i)=>i===204?{type:'session.failed',data:{sessionId:'old'}}:i===1?{type:'action.result',data:{secret:'private-tool-sentinel'}}:{type:'message.completed',data:{message:'text '+i}});
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test'};
const signal=()=>new AbortController().signal;
const code=(code:string)=>(error:unknown)=>error instanceof ApplicationError&&error.code===code;
function fixture(change?:(operation:string,count:number)=>unknown){
 let calls=0,reads=0;const requests:Record<string,unknown>[]=[];
 const database=new Database(env,async(_url,init)=>{
  const body=JSON.parse(String(init?.body));requests.push(body);calls++;
  const custom=change?.(body.p_operation,calls);if(custom instanceof Response)return custom;
  return Response.json(custom??(body.p_operation==='context_read'?{audience:'host_private',requestId:scope,readOnly:false}:timeline));
 });
 const stream:ArchiveStream=async function*(id,options){reads++;assert.equal(id,'old');assert.equal(options.follow,false);for(const event of events.slice(options.startIndex))yield event;};
 return {history:new ModelHistory(database),stream,requests,get reads(){return reads;}};
}
test('model history paginates the whole archive with current fenced authority and safe projection',async()=>{
 const f=fixture(),texts:string[]=[];let cursor=0,more=true;
 while(more){const page=await f.history.read(auth,'current',{cursor},f.stream,signal());
  assert.match(page.notice,/untrusted historical data/);assert.doesNotMatch(JSON.stringify(page),/private-tool-sentinel|sessionId|grantId/);
  texts.push(...page.messages.map(row=>row.text));assert.ok(page.nextCursor>cursor);cursor=page.nextCursor;more=page.hasMore;
 }
 assert.equal(cursor,205);assert.equal(texts.length,203);assert.equal(new Set(texts).size,203);
 assert.equal(texts[0],'text 0');assert.equal(texts.at(-1),'text 203');
 for(const request of f.requests){assert.equal(request.p_grant_id,grant);assert.equal(request.p_conversation_id,scope);if(request.p_operation==='context_read')assert.equal(request.p_session_id,'current');}
});
test('model history rejects caller-selected scope and invalid cursors before I/O',async()=>{
 const f=fixture();
 for(const input of [{cursor:-1},{cursor:0.5},{cursor:Number.MAX_SAFE_INTEGER+1},{cursor:0,sessionId:'other'},{audience:'request_shared'},{conversationId:scope}])await assert.rejects(f.history.read(auth,'current',input,f.stream,signal()),code('INVALID_INPUT'));
 await assert.rejects(f.history.read(null,'current',{},f.stream,signal()),code('UNAUTHORIZED'));
 await assert.rejects(f.history.read(auth,'current',{},f.stream,AbortSignal.abort()),code('PROVIDER_UNAVAILABLE'));
 assert.equal(f.requests.length,0);assert.equal(f.reads,0);
});
test('foreign scope, audience and retired runtime cannot open archive streams',async()=>{
 for(const replacement of [{...timeline,conversationId:grant},{...timeline,audience:'request_shared'},timeline]){
  const f=fixture(operation=>operation==='history'?replacement:undefined);
  await assert.rejects(f.history.read(auth,replacement===timeline?'old':'current',{},f.stream,signal()));assert.equal(f.reads,0);
 }
});
test('revocation and generation movement during reads discard the entire page',async()=>{
 for(const kind of ['revoked','generation','audience']){
  const f=fixture((operation,count)=>{
   if(count<=4)return;
   if(kind==='revoked')return Response.json({message:'UNAUTHORIZED'},{status:400});
   if(operation==='history')return kind==='audience'?{...timeline,audience:'request_shared'}:{...timeline,generations:[timeline.generations[0],{generation:1,sessionId:'replacement',terminalTail:null}]};
  });
  await assert.rejects(f.history.read(auth,'current',{},f.stream,signal()));assert.ok(f.reads>0);
 }
});
test('terminal probe denies changed, missing or extended retired tails without returning text',async()=>{
 for(const records of [[],[{type:'session.failed',data:{sessionId:'foreign'}}],[events.at(-1),{type:'message.completed',data:{message:'late'}}]]){
  const f=fixture();const stream:ArchiveStream=async function*(){yield* records;};
  await assert.rejects(f.history.read(auth,'current',{},stream,signal()),code('PROVIDER_UNAVAILABLE'));
 }
});
test('generation zero returns an empty archive without touching eve',async()=>{
 const f=fixture(operation=>operation==='history'?{...timeline,generation:0,generations:[{generation:0,sessionId:'current',terminalTail:null}]}:undefined);
 const page=await f.history.read(auth,'current',{},f.stream,signal());assert.deepEqual(page.messages,[]);assert.equal(page.hasMore,false);assert.equal(page.archiveEnd,0);assert.equal(f.reads,0);
});
test('cancellation interrupts a non-cooperative archive iterator without leaking its error',async()=>{
 const f=fixture(),controller=new AbortController();let started!:()=>void;const ready=new Promise<void>(r=>{started=r;});
 let released=false;
 const stream:ArchiveStream=()=>({[Symbol.asyncIterator](){return {next(){started();return new Promise(()=>{});},async return(){released=true;return {done:true,value:undefined};}};}});
 const pending=f.history.read(auth,'current',{},stream,controller.signal);await ready;controller.abort();
 await assert.rejects(pending,code('PROVIDER_UNAVAILABLE'));
 assert.equal(released,true,'cancellation also requests iterator cleanup while next() is pending');
});
