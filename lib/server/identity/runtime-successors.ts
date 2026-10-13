import {z} from 'zod';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import type {RuntimeAuth} from './runtime-messages.ts';

const generation=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const successorBootstrap=z.strictObject({generation,creationKey:z.uuid(),messageId:z.uuid(),context:z.array(z.string()).length(1)})
 .refine(value=>value.context.reduce((bytes,text)=>bytes+Buffer.byteLength(text,'utf8'),0)<=16_384);
export type SuccessorBootstrap=z.infer<typeof successorBootstrap>;
const result=z.strictObject({generation,messageId:z.uuid(),creationKey:z.uuid(),leaseToken:z.uuid(),leaseExpiresAt:z.iso.datetime({offset:true}),
 state:z.enum(['prepared','creating','bound']),sessionId:z.string().min(1).max(200).nullable(),dispatch:z.boolean()})
 .refine(value=>(value.state==='bound')===(value.sessionId!==null)&&(!value.dispatch||value.state==='creating'));
export class RuntimeSuccessors{
 constructor(private readonly database=new Database()){}
 private async operation(operation:'claim'|'start'|'bind',auth:RuntimeAuth,input:Record<string,unknown>){
  const parsed=result.safeParse(await this.database.rpc('fmat_runtime_successor',{
   p_operation:operation,p_grant_id:auth.principalId,p_conversation_id:auth.attributes.conversationId,
   p_input:{...input,messageId:auth.attributes.messageId},
  }));
  if(!parsed.success||parsed.data.generation!==input.generation||parsed.data.messageId!==auth.attributes.messageId
   ||(operation!=='start'&&parsed.data.dispatch))throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  return parsed.data;
 }
 claim(auth:RuntimeAuth,generation:number){return this.operation('claim',auth,{generation});}
 start(auth:RuntimeAuth,generation:number,leaseToken:string){return this.operation('start',auth,{generation,leaseToken});}
 async bind(auth:RuntimeAuth,sessionId:string,bootstrap:SuccessorBootstrap){
  if(bootstrap.messageId!==auth.attributes.messageId)throw new ApplicationError('FORBIDDEN',403);
  // Binding is an exact idempotent write to one known runtime. A lost database
  // acknowledgment can be retried once without authorizing another creation.
  // Never apply this retry rule to start: its one-time send permission differs.
  for(let attempt=0;attempt<2;attempt++){
   try{
    const bound=await this.operation('bind',auth,{generation:bootstrap.generation,creationKey:bootstrap.creationKey,sessionId});
    if(bound.state!=='bound'||bound.sessionId!==sessionId||bound.creationKey!==bootstrap.creationKey)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
    return;
   }catch(error){if(attempt!==0||!(error instanceof ApplicationError)||error.code!=='PROVIDER_UNAVAILABLE')throw error;}
  }
 }
}
