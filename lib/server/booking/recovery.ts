import {z} from 'zod';
import {Database,supabaseOrigin} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';

export const recoveryInput=z.strictObject({
 project:z.string().regex(/^(?:[a-z]{20}|local)$/),
 operator:z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9@._+-]+$/),
 requestId:z.uuid(),action:z.enum(['retry','reconcile']),idempotencyKey:z.uuid(),
});
const result=z.strictObject({ok:z.literal(true),retired:z.literal(true).optional(),attemptId:z.uuid().optional(),nextAction:z.literal('review_proposal').optional()});

/** Administrative service-key operation, deliberately absent from browser and
 * agent tools. The operator label is audit attribution, not authentication. */
export class BookingRecovery {
 constructor(private readonly database=new Database(),private readonly env=process.env){}
 async run(input:unknown){
  const command=recoveryInput.parse(input),origin=new URL(supabaseOrigin(this.env));
  const target=command.project==='local'?['localhost','127.0.0.1','[::1]'].includes(origin.hostname):origin.hostname===command.project+'.supabase.co';
  if(!target)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  const outcome=result.parse(await this.database.rpc('fmat_command',{
   p_operation:'booking_'+command.action,p_actor:{kind:'operator',id:command.operator},
   p_input:{requestId:command.requestId,idempotencyKey:command.idempotencyKey},
  }));
  // This acknowledges a durable command. Provider success is established only
  // by the worker and confirmed receipt, including after a replayed command.
  return {requestId:command.requestId,action:command.action,idempotencyKey:command.idempotencyKey,...outcome};
 }
}
