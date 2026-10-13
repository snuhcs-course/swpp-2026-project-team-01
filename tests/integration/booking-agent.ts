import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {exportJWK,generateKeyPair} from 'jose';
import {Database} from '../../lib/server/database/client.ts';
import type {Credential} from '../../lib/server/identity/credentials.ts';
import {BookingReceipt} from '../../lib/server/booking/receipt.ts';
import {AgentOAuthTokens,type AgentTokenGrant} from '../../lib/server/oauth/tokens.ts';
import {AgentCredentials} from '../../lib/server/oauth/credentials.ts';
import {AgentOperations} from '../../lib/server/oauth/operations.ts';
import {agentMcpHttp} from '../../lib/server/mcp/http.ts';
import {LocalSql} from './local-sql.ts';

const quote=(value:unknown)=>"'"+JSON.stringify(value).replaceAll("'","''")+"'";

/** Real consent grants and signed MCP requests around the booking worker fixture.
 * Provider responses and initial contact verification belong to that local fixture. */
export async function bookingAgentProbe(database:Database,env:NodeJS.ProcessEnv,host:Credential){
 const sql=new LocalSql(),client=randomUUID(),origin='http://localhost:3000',resource=origin+'/mcp',binding='a'.repeat(64);
 const pair=await generateKeyPair('ES256',{extractable:true});
 const agentEnv={...env,APP_ORIGIN:origin,AGENT_OAUTH_SIGNING_JWK:JSON.stringify({...await exportJWK(pair.privateKey),kid:'booking-workflow'})};
 const tokens=new AgentOAuthTokens(agentEnv),mcp=agentMcpHttp(agentEnv,new AgentCredentials(agentEnv,database),new AgentOperations(database)),receipt=new BookingReceipt(database);
 const requests=new Map<string,{guest:Credential;access:string}>();
 await sql.query(`insert into fmat.oauth_clients(id,name,redirect_uris,resource) values('${client}','Booking workflow fixture',array['http://127.0.0.1:55779/callback'],'${resource}');`);
 async function grant(credential:Credential){
  const authorization=randomUUID(),scope=credential.kind==='host'?'host:decide host:read':'request:decide request:read';
  await sql.query(`insert into fmat.oauth_authorizations(id,client_id,resource,redirect_uri,scope,code_challenge,state,browser_hash,created_at,expires_at) values('${authorization}','${client}','${resource}','http://127.0.0.1:55779/callback','${scope}','${createHash('sha256').update('A'.repeat(43)).digest('base64url')}','state','${binding}',now(),now()+interval '10 minutes');
   select public.fmat_oauth_consent('${authorization}','${binding}',${quote(credential)}::jsonb,'grant','${createHash('sha256').update(randomUUID()).digest('hex')}');`);
  const projection=JSON.parse(await sql.query(`select fmat.oauth_grant_projection(g) from fmat.oauth_grants g where authorization_id='${authorization}';`)) as AgentTokenGrant;
  return tokens.issue(projection,async()=>{});
 }
 let hostAccess:string;
 async function invoke(access:string,requestId:string,name:string,input:unknown={}){
  return mcp(new Request(resource,{method:'POST',headers:{authorization:'Bearer '+access,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{requestId,input}}})}));
 }
 async function tool(access:string,requestId:string,name:string){
  const response=await invoke(access,requestId,name);assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.result?.isError,undefined,JSON.stringify(body));assert.ok(body.result?.structuredContent);
  assert.doesNotMatch(JSON.stringify(body),/fixture-access|fixture-refresh|encrypted_credential|payload_fingerprint|lease_token/);
  return body.result.structuredContent.result;
 }
 async function counts(requestId:string){return sql.query(`select (select count(*) from fmat.host_approvals where request_id='${requestId}')||':'||(select count(*) from fmat.jobs where kind='booking' and payload->>'requestId'='${requestId}');`);}
 async function close(){
  try{await sql.query(`delete from fmat.oauth_refresh_tokens where grant_id in(select id from fmat.oauth_grants where client_id='${client}');delete from fmat.oauth_codes where grant_id in(select id from fmat.oauth_grants where client_id='${client}');delete from fmat.oauth_grants where client_id='${client}';delete from fmat.oauth_authorizations where client_id='${client}';delete from fmat.oauth_clients where id='${client}';`);}finally{sql.close();}
 }
 try{hostAccess=await grant(host);}catch(error){await close();throw error;}
 return {
  async beforeApproval(requestId:string,guest:Credential){
   const access=await grant(guest);requests.set(requestId,{guest,access});
   assert.equal(await counts(requestId),'0:0');
   for(const [token,path] of [[hostAccess,'/app?request='+requestId+'&audience=host_private'],[access,'/booking/'+requestId]]){
    const review=await tool(token,requestId,'fmat_review_decision');assert.equal(review.requiresHumanConfirmation,true);assert.equal(review.path,path);assert.equal(review.proposalVersion,1);
    const forged=await invoke(token,requestId,'fmat_review_decision',{confirmed:true});assert.equal(forged.status,200);assert.equal((await forged.json()).result.isError,true);
   }
   assert.equal(await counts(requestId),'0:0','Agent review cannot approve or enqueue a booking');
   assert.deepEqual(await tool(access,requestId,'fmat_get_booking_status'),await receipt.read(guest,{requestId}));
   assert.equal((await tool(access,requestId,'fmat_get_booking_status')).receipt,null);
   const wrong=await invoke(access,randomUUID(),'fmat_get_booking_status');assert.equal(wrong.status,200);assert.equal((await wrong.json()).result.isError,true);
  },
  async observe(requestId:string,confirmed:boolean){
   const entry=requests.get(requestId);assert.ok(entry);
   const before=await counts(requestId),browser=await receipt.read(host,{requestId});
   assert.deepEqual(await tool(hostAccess,requestId,'fmat_get_booking_status'),browser);
   if(confirmed){
    assert.equal(browser.status,'booked');assert.ok(browser.receipt);assert.equal(browser.receipt.purpose,'Approved fixture');
    // Closing the request ends the delegated grant, while its browser receipt remains accessible.
    assert.equal((await invoke(entry.access,requestId,'fmat_get_booking_status')).status,401);
    assert.deepEqual((await receipt.read(entry.guest,{requestId})).receipt,browser.receipt);
   }else{
    assert.equal(browser.receipt,null);
    assert.deepEqual(await tool(entry.access,requestId,'fmat_get_booking_status'),await receipt.read(entry.guest,{requestId}));
   }
   assert.equal(await counts(requestId),before,'Status reads cannot create another approval or booking job');
  },
  close,
 };
}
