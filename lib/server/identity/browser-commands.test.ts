import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {BrowserCommands} from './browser-commands.ts';
import {verifyHostToken,type Credential} from './credentials.ts';
import {Database} from '../database/client.ts';

const env={SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SUPABASE_SECRET_KEY:'sb_secret_fixture'};
const subject=randomUUID(),sessionId=randomUUID();
async function host(){
 const now=Date.now(),payload={sub:subject,session_id:sessionId,iss:env.SUPABASE_URL+'/auth/v1',aud:'authenticated',role:'authenticated',exp:Math.floor(now/1000)+3600};
 const token='header.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.signature';
 return verifyHostToken(token,{env,now,fetcher:async()=>Response.json({id:subject,email:'invited@example.test',email_confirmed_at:new Date(now).toISOString()})});
}
const hostState={email:'invited@example.test',admitted:false,calendarConnected:false,nextAction:'redeem_invitation',profile:null};

test('public waitlist normalizes contact without accepting caller authority or returning private command data',async()=>{
 const calls:Record<string,unknown>[]=[];
 const commands=new BrowserCommands(new Database(env,async(_url,init)=>{calls.push(JSON.parse(String(init?.body)));return Response.json({...hostState,private:'not-public'});}));
 const input={email:'  Requester@Example.com  ',name:'  Requester  ',idempotencyKey:randomUUID()};
 assert.deepEqual(await commands.waitlist(input),{status:'pending'});
 assert.deepEqual(calls,[{p_operation:'waitlist_join',p_credential:null,p_input:{...input,email:'requester@example.com',name:'Requester'}}]);
 for(const claims of [{actor:{kind:'operator'}},{hostId:subject},{admitted:true},{credential:{kind:'host'}}])await assert.rejects(commands.waitlist({...input,...claims}));
 assert.equal(calls.length,1,'Caller authority must be rejected before the database boundary');
});

test('invitation redemption sends only the canonical code hash under independently verified host authority',async()=>{
 const calls:Record<string,any>[]=[];
 const commands=new BrowserCommands(new Database(env,async(_url,init)=>{calls.push(JSON.parse(String(init?.body)));return Response.json(hostState);}));
 const credential=await host(),idempotencyKey=randomUUID();
 for(const code of [' sc2i-ppjq-6xel-6n6z ','SC2IPPJQ6XEL6N6Z'])assert.deepEqual(await commands.redeem(credential,{code,idempotencyKey}),hostState);
 assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);
 assert.deepEqual(calls[0],{p_operation:'invite_redeem',p_credential:credential,p_input:{tokenHash:createHash('sha256').update('SC2IPPJQ6XEL6N6Z').digest('hex'),idempotencyKey}});
 assert.doesNotMatch(JSON.stringify(calls),/SC2I|sc2i|PPJQ|ppjq/);
});

test('copied host authority and malformed or legacy invitation inputs never issue an admission command',async()=>{
 let calls=0;const commands=new BrowserCommands(new Database(env,async()=>{calls++;return Response.json(hostState);}));
 const credential=await host(),input={code:'SC2I-PPJQ-6XEL-6N6Z',idempotencyKey:randomUUID()};
 const forged=JSON.parse(JSON.stringify(credential)) as Credential;
 await assert.rejects(commands.host(forged),{code:'UNAUTHORIZED'});
 await assert.rejects(commands.redeem(forged,input),{code:'UNAUTHORIZED'});
 for(const value of [{...input,code:'1234'},{...input,code:'0123-4567-89AB-CDEF'},{...input,code:'SC2I PPJQ 6XEL 6N6Z'},{token:'legacy-private-token',idempotencyKey:input.idempotencyKey},{...input,actor:{kind:'operator'}},{...input,tokenHash:'f'.repeat(64)}])await assert.rejects(commands.redeem(credential,value));
 assert.equal(calls,0);
});
