import {createGrpcClient,IMessageError,type AdvancedIMessage,type Message} from '@photon-ai/advanced-imessage/grpc';
import {z} from 'zod';
import {ApplicationError} from '../errors.ts';
import {requiredEnv,requireMessagingEnvironment} from '../config.ts';
import type {Fetch} from '../database/client.ts';

const tokens=z.discriminatedUnion('type',[
 z.object({type:z.literal('shared'),token:z.string().min(1),expiresIn:z.number().positive()}),
 z.object({type:z.literal('dedicated'),auth:z.record(z.uuid(),z.string().min(1)),numbers:z.record(z.uuid(),z.string().regex(/^\+[1-9]\d{7,14}$/u)),expiresIn:z.number().positive()}),
]);
export type PhotonRoute={line:string;spaceId:string};
export type SendResult={status:'accepted'|'delivered'|'failed'|'uncertain';providerReference:string|null};
export type PhotonClient={messages:Pick<AdvancedIMessage['messages'],'sendText'|'get'>;chats:Pick<AdvancedIMessage['chats'],'shareContactInfo'>;addresses:Pick<AdvancedIMessage['addresses'],'isIMessageAvailable'>;close:AdvancedIMessage['close']};
type Client=PhotonClient;
type Factory=(options:Parameters<typeof createGrpcClient>[0])=>Client;
export class PhotonTransport {
 constructor(private readonly env=process.env,private readonly fetcher:Fetch=fetch,private readonly factory:Factory=createGrpcClient){}
 private async route(line?:string){
  const project=z.uuid().safeParse(this.env.PHOTON_PROJECT_ID);if(!project.success)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  const secret=requiredEnv('PHOTON_PROJECT_SECRET',this.env);
  try{
   const response=await this.fetcher(`https://spectrum.photon.codes/projects/${project.data}/imessage/tokens`,{
    method:'POST',headers:{Authorization:'Basic '+Buffer.from(project.data+':'+secret).toString('base64')},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10_000)});
   if(!response.ok)throw new Error();
   const result=z.object({succeed:z.literal(true),data:tokens}).parse(await response.json()).data;
   if(result.type==='shared'){
    if(line&&line!=='shared')throw new Error();
    return {line:'shared',address:'imessage.spectrum.photon.codes:443',token:result.token};
   }
   const routes=Object.entries(result.auth).flatMap(([id,token])=>result.numbers[id]?[{line:result.numbers[id],address:`${id}.imsg.photon.codes:443`,token}]:[]);
   const chosen=line?routes.find(r=>r.line===line):routes.length===1?routes[0]:undefined;
   if(!chosen)throw new Error();return chosen;
  }catch{throw new ApplicationError('PROVIDER_UNAVAILABLE',503);}
 }
 async prepare(phone:string):Promise<PhotonRoute>{
  requireMessagingEnvironment(this.env);
  if(!/^\+[1-9]\d{7,14}$/u.test(phone))throw new ApplicationError('INVALID_INPUT',400);
  const route=await this.route(this.env.PHOTON_LINE||undefined);
  return {line:route.line,spaceId:'any;-;'+phone};
 }
 private async withClient<T>(line:string,work:(client:Client)=>Promise<T>){
  const route=await this.route(line),client=this.factory({address:route.address,token:route.token,tls:true,timeout:10_000,retry:false,autoIdempotency:false});
  try{return await work(client);}finally{await client.close().catch(()=>{});}
 }
 private result(message:Message,spaceId:string):SendResult {
  if(!message.isFromMe||!message.chatGuids.includes(spaceId)||!message.guid)return {status:'uncertain',providerReference:null};
  return {status:message.sendErrorCode!==0?'failed':message.isDelivered?'delivered':'accepted',providerReference:message.guid};
 }
 async send(route:PhotonRoute,phone:string,text:string,clientMessageId:string,authorize:()=>Promise<void>):Promise<SendResult>{
  requireMessagingEnvironment(this.env);
  if(route.spaceId!=='any;-;'+phone||!/^\+[1-9]\d{7,14}$/u.test(phone)||!z.uuid().safeParse(clientMessageId).success)throw new ApplicationError('INVALID_INPUT',400);
  return this.withClient(route.line,async client=>{
   if(!await client.addresses.isIMessageAvailable(phone))return {status:'failed',providerReference:null};
   // Recheck current application authority after network preflight, immediately
   // before the irreversible provider call. The database lease is already durable.
   await authorize();
   try{
    const message=await client.messages.sendText(route.spaceId,text,{clientMessageId,enableDataDetection:false,enableLinkPreview:false});
    // Only bind a provider identity to the frozen body actually dispatched.
    if(message.content?.text!==text)return {status:'uncertain',providerReference:null};
    return this.result(message,route.spaceId);
   }
   catch(error){
    // A repeated durable ID proves acceptance, not device delivery. Never
    // generate another ID or echo provider errors (which can contain code text).
    if(error instanceof IMessageError&&error.code==='duplicateMessage')return {status:'accepted',providerReference:null};
    return {status:'uncertain',providerReference:null};
   }
  });
 }
 async shareContact(route:PhotonRoute,phone:string,authorizeDispatch:()=>Promise<void>):Promise<{status:'accepted'|'failed'|'uncertain'}>{
  requireMessagingEnvironment(this.env);
  if(route.spaceId!=='any;-;'+phone||!/^\+[1-9]\d{7,14}$/u.test(phone)||!route.line||route.line.length>512)throw new ApplicationError('INVALID_INPUT',400);
  return this.withClient(route.line,async client=>{
   let reachable:boolean;
   try{reachable=await client.addresses.isIMessageAvailable(phone);}
   catch{throw new ApplicationError('PROVIDER_UNAVAILABLE',503);}
   if(!reachable)return {status:'failed'};
   // The caller must durably mark dispatch and recheck current authority here.
   // A lost callback response must not result in a provider call.
   await authorizeDispatch();
   try{await client.chats.shareContactInfo(route.spaceId);return {status:'accepted'};}
   // Native sharing has no idempotency key or reconciliation identity. Even a
   // duplicate-looking provider error cannot prove which card was accepted.
   catch{return {status:'uncertain'};}
  });
 }
 async reconcile(route:PhotonRoute,reference:string|null):Promise<SendResult>{
  requireMessagingEnvironment(this.env);
  if(!reference)return {status:'uncertain',providerReference:null};
  try{return await this.withClient(route.line,async client=>{
   const message=await client.messages.get(reference);
   const result=message.guid===reference?this.result(message,route.spaceId):null;
   // Preserve the persisted identity even when a read is inconclusive. An
   // unrelated provider response cannot replace it or authorize another send.
   return result?.providerReference===reference?result:{status:'uncertain',providerReference:reference};
  });}
  catch{return {status:'uncertain',providerReference:reference};}
 }
}
