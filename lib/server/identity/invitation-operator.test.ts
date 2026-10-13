import {randomUUID} from 'node:crypto';
import {ApplicationError} from '../errors.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Database} from '../database/client.ts';
import {InvitationOperator,invitationOperatorConfiguration} from './invitation-operator.ts';
import {InvitationCodes} from './invitations.ts';
const project='abcdefghijklmnopqrst',key='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const env={SUPABASE_URL:`https://${project}.supabase.co`,SUPABASE_SECRET_KEY:'sb_secret_'+'x'.repeat(32),APP_ORIGIN:'https://fixture.example',INVITATION_CODE_KEY:Buffer.alloc(32,27).toString('base64'),CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_EMAIL_FROM:'no-reply@findmeatime.com',CLOUDFLARE_EMAIL_API_TOKEN:'synthetic'};
const command={project,operator:'issuer',email:'host@example.test',idempotencyKey:key};
const status={invitationId:id,email:command.email,expiresAt:'2030-01-01T00:00:00+00:00',status:'active',revoked:false,delivery:'cloudflare',deliveryStatus:'pending'};
test('operator authority checks reject public credentials and cross-project endpoints before RPC',async()=>{
 for(const secret of ['', 'sb_publishable_'+'x'.repeat(32), 'anonymous','e30.'+Buffer.from(JSON.stringify({role:'authenticated',ref:project})).toString('base64url')+'.signature'])assert.throws(()=>invitationOperatorConfiguration(project,{...env,SUPABASE_SECRET_KEY:secret}));
 assert.throws(()=>invitationOperatorConfiguration('local',env));assert.throws(()=>invitationOperatorConfiguration(project,{...env,SUPABASE_URL:'https://otherprojectabcdefgh.supabase.co'}));
 let calls=0;const db=new Database(env,async()=>{calls++;return Response.json(status);});
 for(const patch of [{INVITATION_CODE_KEY:''},{CLOUDFLARE_EMAIL_API_TOKEN:''},{APP_ORIGIN:'http://fixture.example'},{SUPABASE_SECRET_KEY:'sb_publishable_x'}])await assert.rejects(new InvitationOperator(db,{...env,...patch}).issue(command));
 assert.equal(calls,0);
});
test('remote issuance defaults to frozen Cloudflare intent, while status/revocation need no code or provider secret',async()=>{
 const calls:{p_operation:string;p_input:Record<string,unknown>}[]=[];const db=new Database(env,async(_url,init)=>{calls.push(JSON.parse(String(init?.body)));return Response.json(status);});
 const result=await new InvitationOperator(db,env).issue(command);assert.equal(result.delivery,'cloudflare');assert.equal('email'in result,false);assert.equal(result.idempotencyKey,key);
 assert.equal(calls[0].p_input.origin,env.APP_ORIGIN);assert.equal(calls[0].p_input.accountId,env.CLOUDFLARE_ACCOUNT_ID);assert.equal(calls[0].p_input.tokenHash,new InvitationCodes(env).material(command).tokenHash);assert.equal('code'in calls[0].p_input,false);
 const readOnly=new InvitationOperator(db,{SUPABASE_URL:env.SUPABASE_URL,SUPABASE_SECRET_KEY:env.SUPABASE_SECRET_KEY});
 await readOnly.status({project,operator:'auditor',invitationId:id});await readOnly.revoke({project,operator:'auditor',invitationId:id,idempotencyKey:key});assert.deepEqual(calls.map(c=>c.p_operation),['issue','status','revoke']);
});
test('manual recovery derives original issuer material without changing delivery mode or issuing again',async()=>{
 const original=new InvitationCodes(env).material(command);let calls=0;
 const db=new Database(env,async(_url,init)=>{calls++;assert.equal(JSON.parse(String(init?.body)).p_operation,'recover');return Response.json({invitationId:id,...command,delivery:'cloudflare',origin:env.APP_ORIGIN,tokenHash:original.tokenHash,expiresAt:status.expiresAt});});
 const target={project,operator:'recovering-operator',invitationId:id};const value=await new InvitationOperator(db,env).recover(target);assert.equal(value.code,original.groupedCode);assert.equal(value.setupUrl,env.APP_ORIGIN+'/app');assert.equal(value.recipient,command.email);
 await assert.rejects(new InvitationOperator(db,{...env,INVITATION_CODE_KEY:Buffer.alloc(32,28).toString('base64')}).recover(target));assert.equal(calls,2);
});

test('remote invitation configuration fails before issuance, including preview and malformed sender credentials',async()=>{
 let calls=0;const db={async rpc(){calls++;throw Error('must not issue');}} as unknown as Database;
 for(const patch of [
  {CLOUDFLARE_ACCOUNT_ID:''},{CLOUDFLARE_ACCOUNT_ID:'not-an-account'},
  {CLOUDFLARE_EMAIL_API_TOKEN:''},{CLOUDFLARE_EMAIL_API_TOKEN:'secret\ninjection'},
  {CLOUDFLARE_EMAIL_FROM:'no-reply@mail.findmeatime.com'},
  {VERCEL_ENV:'preview'},{INVITATION_CODE_KEY:''},
  {SUPABASE_SECRET_KEY:'sb_publishable_'+'x'.repeat(32)},
 ]){
  await assert.rejects(new InvitationOperator(db,{...env,...patch}).issue(command),error=>error instanceof ApplicationError&&error.code==='CONFIGURATION_UNAVAILABLE');
  assert.equal(calls,0);
 }
});

test('invitation issuance sends only normalized frozen context and code hash to SQL and propagates rejection without another effect',async()=>{
 const input={...command,email:" Host@Example.test "},material=new InvitationCodes(env).material(input),invitationId=randomUUID();
 let reject=false;const calls:{name:string;input:unknown}[]=[];
 const db={async rpc(name:string,value:unknown){calls.push({name,input:value});if(reject)throw new ApplicationError('IDEMPOTENCY_CONFLICT',409);return {invitationId,email:'host@example.test',expiresAt:'2026-10-17T00:00:00Z',status:'active',revoked:false,delivery:'cloudflare',deliveryStatus:'pending'};}} as Database;
 const service=new InvitationOperator(db,env),result=await service.issue(input);
 assert.deepEqual(calls,[{name:'fmat_invitation_operator',input:{p_operation:'issue',p_operator:input.operator,p_input:{project,email:'host@example.test',idempotencyKey:input.idempotencyKey,delivery:'cloudflare',origin:env.APP_ORIGIN,accountId:env.CLOUDFLARE_ACCOUNT_ID,tokenHash:material.tokenHash}}}]);
 assert.equal(result.deliveryStatus,'pending');assert.equal('email' in result,false);
 for(const secret of [material.code,material.groupedCode,env.INVITATION_CODE_KEY,env.CLOUDFLARE_EMAIL_API_TOKEN,env.SUPABASE_SECRET_KEY])assert.equal(JSON.stringify({calls,result}).includes(secret),false);
 reject=true;await assert.rejects(service.issue(input),error=>error instanceof ApplicationError&&error.code==='IDEMPOTENCY_CONFLICT');assert.equal(calls.length,2);
});

test('explicit remote manual issuance requires no Cloudflare credentials and persists no provider account',async()=>{
 const calls:Record<string,any>[]=[];
 const db=new Database(env,async(_url,init)=>{calls.push(JSON.parse(String(init?.body)));return Response.json({...status,delivery:'manual',deliveryStatus:'manual'});});
 const manualEnv={...env,CLOUDFLARE_ACCOUNT_ID:'',CLOUDFLARE_EMAIL_API_TOKEN:'',CLOUDFLARE_EMAIL_FROM:''};
 const result=await new InvitationOperator(db,manualEnv).issue({...command,delivery:'manual'});
 assert.equal(result.deliveryStatus,'manual');assert.equal(calls.length,1);
 assert.equal(calls[0].p_operation,'issue');assert.equal(calls[0].p_input.delivery,'manual');assert.equal(calls[0].p_input.accountId,null);
});
