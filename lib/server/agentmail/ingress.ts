import {z} from 'zod';
import {Database} from '../database/client.ts';
import {requiredEnv} from '../config.ts';
import {ApplicationError,publicError} from '../errors.ts';
import {verifiedAgentMailReceipt} from './webhook.ts';
export async function agentmailWebhook(request:Request,options:{env?:NodeJS.ProcessEnv;database?:Pick<Database,'rpc'>}={}):Promise<Response>{
 const headers={'cache-control':'no-store','x-content-type-options':'nosniff'};
 try{
  const env=options.env??process.env,inboxId=requiredEnv('AGENTMAIL_INBOX_ID',env),secret=requiredEnv('AGENTMAIL_WEBHOOK_SECRET',env),receiver=requiredEnv('AGENTMAIL_RECEIVER_ID',env);
  if(!z.uuid().safeParse(receiver).success)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  const receipt=await verifiedAgentMailReceipt(request,{inboxId,secret});
  await (options.database??new Database(env)).rpc('fmat_agentmail_ingress',{p_receiver_id:receiver,p_inbox_id:inboxId,p_input:receipt});
  return new Response(null,{status:receipt?200:204,headers});
 }catch(error){const safe=publicError(error);return Response.json(safe.body,{status:safe.status,headers});}
}
