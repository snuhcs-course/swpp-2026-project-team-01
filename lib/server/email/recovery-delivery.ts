import {requireMessagingEnvironment} from '../config.ts';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Database} from '../database/client.ts';
import {bookingLease} from '../booking/dispatch.ts';
import {TokenCipher} from '../calendar/encryption.ts';
import {applicationOrigin} from '../config.ts';
import {ApplicationError} from '../errors.ts';
import {CloudflareEmail,preparedEmail} from './cloudflare.ts';
import {requesterRecoveryEmail} from './recovery-content.ts';
const phase=z.object({phase:z.enum(['pending','prepared','dispatch','dispatched','busy','sent','failed','suppressed','uncertain'])});
const pending=z.strictObject({phase:z.enum(['pending','prepared']),id:z.uuid(),requestId:z.uuid(),challengeId:z.uuid(),recipient:z.email(),encryptedProof:z.string(),basis:z.string().regex(/^[a-f0-9]{64}$/u),expiresAt:z.string(),encryptedPrepared:z.string().nullable()});
type Lease=z.infer<typeof bookingLease>;
export class RequesterRecoveryDelivery{
 constructor(private readonly database=new Database(),private readonly env=process.env,private readonly provider=new CloudflareEmail(env)){}
 private call(operation:string,lease:Lease|{workerId:string},input:unknown={}){return this.database.rpc('fmat_requester_recovery_delivery',{p_operation:operation,p_lease:lease,p_input:input});}
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
   let value=await this.call('load',lease);const ended=await finish(value);if(ended)return ended;
   let state=pending.parse(value);const config=this.provider.configuration(),cipher=new TokenCipher(this.env),context='requester-recovery-email:'+state.id;
   if(state.phase==='pending'){
    const {proof}=z.strictObject({proof:z.string().regex(/^[A-Za-z0-9_-]{43}$/u)}).parse(cipher.open(state.encryptedProof,'requester-recovery:'+state.requestId+':'+state.challengeId));
    const prepared=requesterRecoveryEmail({id:state.id,accountId:config.accountId,to:state.recipient,proof,requestId:state.requestId,challengeId:state.challengeId,origin:applicationOrigin(this.env),expiresAt:state.expiresAt});
    value=await this.call('prepare',lease,{basis:state.basis,encryptedPrepared:cipher.seal(prepared,context)});
    const stopped=await finish(value);if(stopped)return stopped;state=pending.parse(value);
   }
   const prepared=preparedEmail.parse(cipher.open(state.encryptedPrepared!,context));
   if(prepared.id!==state.id||prepared.accountId!==config.accountId||prepared.message.to!==state.recipient)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
   value=await this.call('dispatch',lease);const stopped=await finish(value);if(stopped)return stopped;
   const dispatched=z.strictObject({phase:z.literal('dispatch'),id:z.uuid(),encryptedPrepared:z.string()}).parse(value);
   const frozen=preparedEmail.parse(cipher.open(dispatched.encryptedPrepared,'requester-recovery-email:'+dispatched.id));
   const outcome=await this.provider.send(frozen);await this.call('record',lease,outcome);return outcome.outcome;
  }catch(error){
   if(error instanceof ApplicationError&&error.code==='BOOKING_LEASE_LOST')return 'lease_lost';
   try{
    const value=await this.call('load',lease),ended=await finish(value);if(ended)return ended;
    await this.call('retry',lease);return 'retry';
   }catch(cause){return cause instanceof ApplicationError&&cause.code==='BOOKING_LEASE_LOST'?'lease_lost':'retry';}
  }
 }
}
