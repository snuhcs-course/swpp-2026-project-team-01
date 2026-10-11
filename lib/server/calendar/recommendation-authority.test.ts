import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {CalendarSelection} from './selection.ts';
import {TokenCipher} from './encryption.ts';
import {ApplicationError} from '../errors.ts';
import type {Database} from '../database/client.ts';
import {verifyHostToken} from '../identity/credentials.ts';
test('recommendation fences stale and revoked hosts and never saves choices',async()=>{
 const id=randomUUID(),env={TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64')},calls:string[]=[];
 const grant={connectionId:randomUUID(),generation:randomUUID(),principalId:id,rulesVersion:1,conflictCalendarIds:[],bookingCalendarId:null,encryptedCredential:new TokenCipher(env).seal({accessToken:'private',refreshToken:'refresh',subject:'google',expiresAt:Date.now()+3600000,scopes:['https://www.googleapis.com/auth/calendar.readonly']},'google:host:'+id)};
 let revoked=false;
 const database={rpc:async(_name:string,args:Record<string,unknown>)=>{calls.push(String(args.p_operation));if(revoked)throw new ApplicationError('UNAUTHORIZED',401);return args.p_operation==='read'?grant:{current:true};}} as unknown as Database;
 const claims={sub:id,session_id:randomUUID(),iss:'http://localhost:54321/auth/v1',aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600};
 const credential=await verifyHostToken('e30.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.sig',{env:{SUPABASE_URL:'http://localhost:54321',SUPABASE_PUBLISHABLE_KEY:'fixture'},fetcher:async()=>Response.json({id,email:'fixture@example.test',email_confirmed_at:new Date().toISOString()})});
 const service=new CalendarSelection(database,env,{refresh:async()=>{throw new Error('Unexpected refresh');},list:async()=>[]},{recommend:async()=>{revoked=true;return {start:new Date().toISOString(),end:new Date().toISOString(),conflictCalendarIds:[],bookingCalendarId:null,evidence:[]};}});
 // Use the host credential contract accepted by the application boundary.
 await assert.rejects(service.recommend(credential,{generation:grant.generation,rulesVersion:0}),{code:'STALE_REVISION'});
 await assert.rejects(service.recommend(credential,{generation:grant.generation,rulesVersion:1}),{code:'UNAUTHORIZED'});
 assert.deepEqual(calls,['read','read','check']);
});
