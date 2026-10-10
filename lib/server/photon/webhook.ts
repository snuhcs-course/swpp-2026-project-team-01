import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Database } from '../database/client.ts';
import { ApplicationError, publicError } from '../errors.ts';

const opaque = z.string().min(1).max(512).refine(value => !/[\u0000-\u001f\u007f]/u.test(value));
const platform = z.enum(['imessage', 'iMessage']);
const space = z.object({ id: opaque, platform, type: z.enum(['dm', 'group']), phone: opaque });
const envelope = z.object({
  event: z.literal('messages'), space,
  message: z.object({
    id: opaque, platform, direction: z.enum(['inbound', 'outbound']), timestamp: z.iso.datetime({offset:true}),
    sender: z.object({id: opaque, platform}), space,
    content: z.object({type:z.string(), text:z.string().max(4000).optional()}),
  }),
});
export type PhotonInput = Readonly<{
  messageId:string; senderId:string; spaceId:string; line:string; text:string; occurredAt:string;
}>;
export type PhotonReceiver = Readonly<{projectId:string; receiverId:string; secret:string}>;
const config = z.object({projectId:z.uuid(), receiverId:z.uuid(), secret:z.string().min(32).max(512)});
export function photonReceiver(env=process.env):PhotonReceiver {
  const result=config.safeParse({projectId:env.PHOTON_PROJECT_ID,receiverId:env.PHOTON_WEBHOOK_ID,secret:env.IMESSAGE_WEBHOOK_SECRET});
  if(!result.success)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  // Receiver credentials cannot confer database or internal worker authority.
  const secret=result.data.secret.trim();
  if(['SUPABASE_SECRET_KEY','RUNTIME_DISPATCH_SECRET'].some(name=>env[name]?.trim()===secret)) {
    throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  }
  return result.data;
}

// Verify the original bytes, before JSON parsing. Header IDs are not signed by
// Spectrum: compare the receiver ID to configuration and dedupe by project/message.
export async function verifiedPhotonInput(request:Request, receiver:PhotonReceiver, now=Date.now()):Promise<PhotonInput|null> {
  const timestamp=request.headers.get('x-spectrum-timestamp')??'', signature=request.headers.get('x-spectrum-signature')??'';
  if(request.headers.get('x-spectrum-webhook-id')!==receiver.receiverId || !/^\d{10}$/u.test(timestamp) ||
    Math.abs(Math.floor(now/1000)-Number(timestamp))>300 || !/^v0=[a-fA-F0-9]{64}$/u.test(signature)) {
    throw new ApplicationError('UNAUTHORIZED',401);
  }
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new ApplicationError('INVALID_INPUT',400);
  const contentLength=request.headers.get('content-length');
  if(contentLength!==null&&(!/^\d+$/u.test(contentLength)||Number(contentLength)>32_768))throw new ApplicationError('INVALID_INPUT',413);
  const reader=request.body?.getReader();
  if(!reader)throw new ApplicationError('INVALID_INPUT',400);
  const chunks:Uint8Array[]=[];let length=0,timedOut=false;
  const cancel=()=>{void reader.cancel().catch(()=>{});};
  const timer=setTimeout(()=>{timedOut=true;cancel();},5000);
  request.signal.addEventListener('abort',cancel,{once:true});
  try {
    if(request.signal.aborted){cancel();throw new ApplicationError('INVALID_INPUT',400);}
    for(;;){const {done,value}=await reader.read();
      if(timedOut)throw new ApplicationError('INVALID_INPUT',408);
      if(request.signal.aborted)throw new ApplicationError('INVALID_INPUT',400);
      if(done)break;length+=value.byteLength;
      if(length>32_768){cancel();throw new ApplicationError('INVALID_INPUT',413);}chunks.push(value);}
  } catch(error){if(error instanceof ApplicationError)throw error;throw new ApplicationError('INVALID_INPUT',400);}
  finally{clearTimeout(timer);request.signal.removeEventListener('abort',cancel);reader.releaseLock();}
  const raw=Buffer.concat(chunks), expected=createHmac('sha256',receiver.secret).update(`v0:${timestamp}:`).update(raw).digest();
  if(!timingSafeEqual(expected,Buffer.from(signature.slice(3),'hex')))throw new ApplicationError('UNAUTHORIZED',401);
  let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw new ApplicationError('INVALID_INPUT',400);}
  const event=z.object({event:z.string()}).safeParse(value);
  if(!event.success || (request.headers.has('x-spectrum-event')&&request.headers.get('x-spectrum-event')!==event.data.event))throw new ApplicationError('INVALID_INPUT',400);
  if(event.data.event!=='messages')return null;
  const parsed=envelope.safeParse(value);
  if(!parsed.success)throw new ApplicationError('INVALID_INPUT',400);
  const {space:route,message}=parsed.data;
  // Both copies must agree. Never infer DM identity from a GUID substring or
  // display name, and never flatten group messages into private conversations.
  if(route.id!==message.space.id || route.phone!==message.space.phone || route.type!==message.space.type ||
    route.platform!==message.platform || route.platform!==message.space.platform || route.platform!==message.sender.platform) {
    throw new ApplicationError('INVALID_INPUT',400);
  }
  if(route.type!=='dm'||message.direction!=='inbound'||message.content.type!=='text')return null;
  if(!message.content.text?.trim())return null;
  return {messageId:message.id,senderId:message.sender.id,spaceId:route.id,line:route.phone,
    text:message.content.text,occurredAt:new Date(message.timestamp).toISOString()};
}

export async function photonWebhook(request:Request, options:{
  env?:NodeJS.ProcessEnv; database?:Pick<Database,'rpc'>; now?:number;
}={}):Promise<Response> {
  const headers={'cache-control':'no-store','x-content-type-options':'nosniff'};
  try {
    const receiver=photonReceiver(options.env), input=await verifiedPhotonInput(request,receiver,options.now);
    if(!input)return new Response(null,{status:204,headers});
    // Do not acknowledge in a background task. A failed or lost commit must be
    // retried with the same provider ID; only a committed inbox gets HTTP 200.
    await (options.database??new Database()).rpc('fmat_photon_ingress',{
      p_project_id:receiver.projectId,p_receiver_id:receiver.receiverId,p_input:input,
    });
    return new Response(null,{status:200,headers});
  } catch(error){const safe=publicError(error);return Response.json(safe.body,{status:safe.status,headers});}
}
