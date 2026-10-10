import {requireMessagingEnvironment} from '../config.ts';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Database} from '../database/client.ts';
import {bookingLease} from '../booking/dispatch.ts';
import {ApplicationError} from '../errors.ts';
import {CloudflareEmail} from './cloudflare.ts';
import {invitationDeliveryState,invitationEmail} from './invitation-content.ts';
const phase=z.object({phase:z.enum(['pending','prepared','dispatch','dispatched','busy','sent','failed','suppressed','uncertain'])});
type Lease=z.infer<typeof bookingLease>;
export class InvitationDelivery{
 constructor(private readonly database=new Database(),private readonly env=process.env,private readonly provider=new CloudflareEmail(env)){}
 private call(operation:string,lease:Lease|{workerId:string},input:unknown={}){return this.database.rpc('fmat_invitation_delivery',{p_operation:operation,p_lease:lease,p_input:input});}
 async run(){
  requireMessagingEnvironment(this.env);
  this.provider.configuration();
  const {job}=z.strictObject({job:bookingLease.nullable()}).parse(await this.call('claim',{workerId:randomUUID()}));
  return job?{claimed:1,outcome:await this.process(job)}:{claimed:0,outcome:'idle'};
 }
 async process(input:unknown):Promise<string>{
  requireMessagingEnvironment(this.env);
  const lease=bookingLease.parse(input);
  const finish=async(value:unknown)=>{
   const {phase:status}=phase.parse(value);
   if(status==='busy')return 'retry';
   if(['sent','failed','suppressed','uncertain'].includes(status)){try{await this.call('complete',lease);}catch(error){if(!(error instanceof ApplicationError&&error.code==='BOOKING_LEASE_LOST'))throw error;}return status;}
   if(status==='dispatched'){await this.call('record',lease,{outcome:'uncertain',reason:'prior_dispatch_uncertain'});return 'uncertain';}
   return null;
  };
  try{
   let value=await this.call('load',lease);const stopped=await finish(value);if(stopped)return stopped;
   let state=invitationDeliveryState.parse(value);const config=this.provider.configuration();
   if(config.accountId!==state.accountId)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
   const content=invitationEmail(state,this.env);
   if(state.phase==='pending'){
    value=await this.call('prepare',lease,{basis:state.basis,tokenHash:content.tokenHash,fingerprint:content.fingerprint});
    const ended=await finish(value);if(ended)return ended;state=invitationDeliveryState.parse(value);
   }
   if(state.fingerprint!==content.fingerprint)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
   value=await this.call('dispatch',lease);const ended=await finish(value);if(ended)return ended;
   const dispatched=z.strictObject({phase:z.literal('dispatch'),fingerprint:z.string()}).parse(value);
   if(dispatched.fingerprint!==content.fingerprint)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
   const outcome=await this.provider.send(content.prepared);await this.call('record',lease,outcome);return outcome.outcome;
  }catch(error){
   if(error instanceof ApplicationError&&error.code==='BOOKING_LEASE_LOST')return 'lease_lost';
   try{const value=await this.call('load',lease),ended=await finish(value);if(ended)return ended;await this.call('retry',lease);return 'retry';}
   catch(cause){return cause instanceof ApplicationError&&cause.code==='BOOKING_LEASE_LOST'?'lease_lost':'retry';}
  }
 }
}
