import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {RequesterEmailLinking} from './linking.ts';
export const emailLease=z.strictObject({workerId:z.string().min(1).max(200),jobId:z.uuid(),leaseToken:z.uuid()});
type Lease=z.infer<typeof emailLease>;
/** One receipt per invocation. Provider I/O is outside SQL; prepare and dispatch each recheck the lease. */
export class RequesterEmailWorker{
 constructor(private readonly db=new Database(),private readonly env=process.env,private readonly linking:Pick<RequesterEmailLinking,'prepare'>=new RequesterEmailLinking(db,env)){}
 private call(operation:string,lease:Lease|{workerId:string},input:unknown={}){
  const inbox=z.email().safeParse(this.env.AGENTMAIL_INBOX_ID),receiver=z.uuid().safeParse(this.env.AGENTMAIL_RECEIVER_ID);
  if(!inbox.success||!receiver.success)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  return this.db.rpc('fmat_requester_email_worker',{p_operation:operation,p_inbox_id:inbox.data,p_receiver_id:receiver.data,p_lease:lease,p_input:input});
 }
 async run(){const {job}=z.strictObject({job:emailLease.nullable()}).parse(await this.call('claim',{workerId:randomUUID()}));return job?{claimed:1,outcome:await this.process(job)}:{claimed:0,outcome:'idle'};}
 async process(input:unknown):Promise<string>{
  const lease=emailLease.parse(input);
  try{
   const saved=z.strictObject({receiptId:z.uuid(),prepared:z.boolean()}).parse(await this.call('read',lease));
   if(!saved.prepared){
    const evidence=await this.linking.prepare(saved.receiptId);
    const prepared=z.strictObject({outcome:z.enum(['prepared','linked','rejected'])}).parse(await this.call('prepare',lease,evidence));
    if(prepared.outcome!=='prepared')return prepared.outcome;
   }
   const result=await this.call('dispatch',lease);return this.outcome(result);
  }catch(error){
   if(error instanceof ApplicationError&&error.code==='BOOKING_LEASE_LOST')return 'lease_lost';
   const reject=error instanceof ApplicationError&&['UNAUTHORIZED','FORBIDDEN','NOT_FOUND','INVALID_INPUT','CHALLENGE_INVALID','IDEMPOTENCY_CONFLICT','EMAIL_LINK_CONFLICT'].includes(error.code);
   try{return this.outcome(await this.call(reject?'reject':'retry',lease));}
   catch(cause){return cause instanceof ApplicationError&&cause.code==='BOOKING_LEASE_LOST'?'lease_lost':'retry';}
  }
 }
 private outcome(value:unknown){
  const parsed=z.object({outcome:z.enum(['linked','accepted','rejected','limited']).optional()}).parse(value);return parsed.outcome??'retry';
 }
}
