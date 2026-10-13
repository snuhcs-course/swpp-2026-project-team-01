import {createHash,createHmac} from 'node:crypto';
import {z} from 'zod';
import {supabaseOrigin} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';

const operatorTarget={project:z.string().regex(/^(?:[a-z]{20}|local)$/u),operator:z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9@._+-]+$/u)};
export const invitationIssueInput=z.strictObject({...operatorTarget,email:z.string().trim().toLowerCase().pipe(z.email().max(254)),idempotencyKey:z.uuid(),delivery:z.enum(['cloudflare','manual']).optional()}).transform(input=>({...input,delivery:input.delivery??(input.project==='local'?'manual' as const:'cloudflare' as const)})).refine(input=>input.project!=='local'||input.delivery==='manual');
export const invitationStatusInput=z.strictObject({...operatorTarget,invitationId:z.uuid()});
export const invitationRevokeInput=invitationStatusInput.extend({idempotencyKey:z.uuid()});
export type InvitationIssueInput=z.infer<typeof invitationIssueInput>;

/** Internal deterministic material, not an issuance or authorization operation.
 * Only its hash and input context may enter durable server state. The operator
 * label is attribution; the eventual service RPC must verify real authority. */
export class InvitationCodes{
 constructor(private readonly env=process.env){}
 material(input:unknown){
  const parsed=invitationIssueInput.safeParse(input);if(!parsed.success)throw new ApplicationError('INVALID_INPUT',400);
  const command=parsed.data,origin=new URL(supabaseOrigin(this.env));
  if(command.project==='local'?!['localhost','127.0.0.1','[::1]'].includes(origin.hostname):origin.origin!=='https://'+command.project+'.supabase.co')throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  const encoded=this.env.INVITATION_CODE_KEY;
  if(!encoded||!/^[A-Za-z0-9+/]{43}=$/u.test(encoded))throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  const key=Buffer.from(encoded,'base64');
  if(key.length!==32||key.toString('base64')!==encoded)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  const bytes=createHmac('sha256',key).update(JSON.stringify(['fmat-invitation-code-v1',command.project,command.operator,command.email,command.idempotencyKey,command.delivery])).digest().subarray(0,10);
  // Ten bytes are exactly sixteen Base32 characters; no padding or lost bits.
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,value=0,code='';
  for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){bits-=5;code+=alphabet[(value>>>bits)&31];}value&=(1<<bits)-1;}
  return {command,code,groupedCode:code.match(/.{4}/gu)!.join('-'),tokenHash:createHash('sha256').update(code).digest('hex')};
 }
}
