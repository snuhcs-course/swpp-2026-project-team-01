import test from 'node:test';
import assert from 'node:assert/strict';
import {Database,type Fetch} from '../../lib/server/database/client.ts';
import {ApplicationError,publicError} from '../../lib/server/errors.ts';
const env={SUPABASE_URL:'https://database.example.test',SUPABASE_SECRET_KEY:'sb_secret_'+'x'.repeat(32),OPERATIONAL_REJECTIONS_ENABLED:'true'};
const denied=(expected:string)=>(error:unknown)=>error instanceof ApplicationError&&error.code===expected;

test('recognized SQL rejections emit only a fixed category and preserve safe mapped errors',async()=>{
 for(const [message,code,category] of [['UNAUTHORIZED','UNAUTHORIZED','authorization_denied'],['FORBIDDEN','FORBIDDEN','authorization_denied'],['HOST_NOT_ADMITTED','HOST_NOT_ADMITTED','authorization_denied'],['REVISION_CONFLICT','STALE_REVISION','stale_action'],['PROPOSAL_STALE','STALE_REVISION','stale_action'],['FEASIBILITY_STALE','STALE_REVISION','stale_action']]){
  const calls:{url:string;body:unknown}[]=[];
  const db=new Database(env,async(url,init)=>{
   calls.push({url:String(url),body:JSON.parse(String(init?.body))});
   if(calls.length===1)return Response.json({message,details:'PRIVATE_SQL_CONTENT'},{status:400});
   assert.equal(new Headers(init?.headers).get('authorization'),null);assert.equal(init?.redirect,'error');
   return Response.json({message:'PRIVATE_RECORDER_FAILURE'},{status:500});
  });
  await assert.rejects(db.rpc('fmat_scheduling',{privateToken:'PRIVATE_INPUT'}),error=>{assert.ok(denied(code)(error));assert.ok(!JSON.stringify(publicError(error)).includes('PRIVATE'));return true;});
  assert.equal(calls.length,2);assert.deepEqual(calls[1],{url:env.SUPABASE_URL+'/rest/v1/rpc/fmat_rejection_record',body:{p_category:category}});
 }
});
test('returned OAuth rejections are observed without changing the committed error object',async()=>{
 for(const error of ['invalid_grant','invalid_scope','invalid_token','invalid_client']){
  const original={error,privateDetail:'PRIVATE_OAUTH_CONTENT'},calls:unknown[]=[];
  const db=new Database(env,async(_url,init)=>{calls.push(JSON.parse(String(init?.body)));return calls.length===1?Response.json(original):Response.json(null);});
  assert.deepEqual(await db.rpc('fmat_oauth_code_exchange',{}),original);
  assert.deepEqual(calls,[{},{p_category:'authorization_denied'}]);
 }
});
test('disabled, successful, unknown and diagnostic requests never generate observations',async()=>{
 for(const flag of [undefined,'false','TRUE','1','']){
  let calls=0;const db=new Database({...env,OPERATIONAL_REJECTIONS_ENABLED:flag},async()=>{calls++;return Response.json({message:'FORBIDDEN'},{status:403});});
  await assert.rejects(db.rpc('fmat_command',{}),denied('FORBIDDEN'));assert.equal(calls,1);
 }
 for(const [name,response] of [
  ['fmat_command',()=>Response.json({ok:true})],['fmat_command',()=>Response.json({error:'invalid_grant'})],
  ['fmat_oauth_refresh',()=>Response.json({error:'invalid_request'})],
  ['fmat_command',()=>Response.json({message:'PRIVATE_ERROR'},{status:500})],
  ['fmat_command',()=>Response.json({message:'NOT_FOUND'},{status:404})],
  ...['fmat_operational_snapshot','fmat_rejection_snapshot','fmat_rejection_record'].map(name=>[name,()=>Response.json({message:'FORBIDDEN'},{status:403})]),
 ] as [Parameters<Database['rpc']>[0],()=>Response][]){
  let calls=0;const db=new Database(env,async()=>{calls++;return response();});
  await db.rpc(name,{}).catch(()=>{});assert.equal(calls,1,name+' has no telemetry recursion or inference');
 }
});
test('collection failure and a non-cooperative transport cannot extend its independent deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let calls=0,aborted=false,settled=false;
 const fetcher:Fetch=async(_url,init)=>{
  calls++;if(calls===1)return Response.json({message:'FORBIDDEN'},{status:403});
  init?.signal?.addEventListener('abort',()=>{aborted=true;});return new Promise(()=>{});
 };
 const db=new Database(env,fetcher),result=assert.rejects(db.rpc('fmat_command',{}),denied('FORBIDDEN')).then(()=>{settled=true;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);
 t.mock.timers.tick(249);await Promise.resolve();assert.equal(settled,false);
 t.mock.timers.tick(1);await result;assert.equal(aborted,true);assert.equal(calls,2);
 let failed=0;const broken=new Database(env,async()=>{failed++;if(failed===1)return Response.json({message:'REVISION_CONFLICT'},{status:409});throw Error('PRIVATE_TRANSPORT_FAILURE');});
 await assert.rejects(broken.rpc('fmat_command',{}),denied('STALE_REVISION'));assert.equal(failed,2);
});
