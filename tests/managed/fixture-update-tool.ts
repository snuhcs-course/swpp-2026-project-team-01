import {defineTool} from 'eve/tools';
import {z} from 'zod';
import {requestExtractionInput} from '../../lib/contracts/conversation-tools.ts';
import {ConversationTools} from '../../lib/server/identity/tool-execution.ts';
import {Conversations} from '../../lib/server/identity/conversations.ts';

// Never mount this in the product agent. The dedicated preview fixture uses a
// synthetic Auth user's metadata as a durable one-shot fault marker. No provider
// credentials or real participant records are read by the marker operation.
export default defineTool({
 description:'Isolated managed runtime post-commit crash probe.',inputSchema:requestExtractionInput,
 async execute(input,ctx){
  const host=z.uuid().parse(process.env.FMAT_MANAGED_PROBE_HOST_ID),request=z.uuid().parse(process.env.FMAT_MANAGED_PROBE_REQUEST_ID);
  const auth=ctx.session.auth.current;
  if(process.env.VERCEL_ENV!=='preview'||!auth?.principalId||typeof auth.attributes?.conversationId!=='string')throw new Error('Managed preview fixture required');
  const grant=await new Conversations().checkExecution(auth.principalId,auth.attributes.conversationId);
  if(grant.requestId!==request||grant.audience!=='request_shared'||grant.actorKind!=='guest')throw new Error('Synthetic request required');
  const result=await new ConversationTools().proposeRequestExtraction(auth,{sessionId:ctx.session.id,callId:ctx.callId},input);
  const url=new URL('/auth/v1/admin/users/'+host,process.env.SUPABASE_URL);
  const key=process.env.SUPABASE_SECRET_KEY;if(!key)throw new Error('Missing fixture authority');
  const headers={apikey:key,authorization:'Bearer '+key,'content-type':'application/json'};
  const response=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(10_000)});
  if(!response.ok)throw new Error('Fixture marker read failed');
  const user=await response.json();
  if(user.id!==host||user.email!==`managed-runtime-${host}@example.test`)throw new Error('Synthetic marker identity mismatch');
  if(user.app_metadata?.fmat_managed_probe_committed!==true){
   const saved=await fetch(url,{method:'PUT',headers,body:JSON.stringify({app_metadata:{...user.app_metadata,fmat_managed_probe_committed:true}}),redirect:'error',signal:AbortSignal.timeout(10_000)});
   if(!saved.ok)throw new Error('Fixture marker save failed');
   console.info('FMAT_MANAGED_PROBE_POST_COMMIT_EXIT');
   process.kill(process.pid,'SIGKILL');
   await new Promise<never>(()=>{});
  }
  console.info('FMAT_MANAGED_PROBE_REPLAY_RETURN');
  return result;
 },
});
