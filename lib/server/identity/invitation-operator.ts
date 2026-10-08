import {z} from 'zod';
import {Database,supabaseOrigin} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {applicationOrigin,requiredEnv} from '../config.ts';
import {CloudflareEmail} from '../email/cloudflare.ts';
import {InvitationCodes,invitationIssueInput,invitationStatusInput,invitationRevokeInput} from './invitations.ts';
const result=z.strictObject({invitationId:z.uuid(),email:z.email(),expiresAt:z.iso.datetime({offset:true}),status:z.enum(['active','revoked','expired','redeemed']),revoked:z.boolean(),delivery:z.enum(['manual','cloudflare']),deliveryStatus:z.enum(['manual','pending','prepared','dispatched','sent','failed','suppressed','uncertain'])});
const recovery=z.strictObject({invitationId:z.uuid(),project:z.string(),operator:z.string(),email:z.email(),idempotencyKey:z.uuid(),delivery:z.enum(['manual','cloudflare']),origin:z.string(),tokenHash:z.string().regex(/^[a-f0-9]{64}$/u),expiresAt:z.iso.datetime({offset:true})});
const loopback=(url:URL)=>['localhost','127.0.0.1','[::1]'].includes(url.hostname);
/** Credential shape is an early rejection check, never proof of authority.
 * The database validates the actual server credential on every RPC. */
export function invitationOperatorConfiguration(project:string,env=process.env){
 const url=new URL(supabaseOrigin(env));
 if(project==='local'?!loopback(url):url.origin!==`https://${project}.supabase.co`)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
 const key=requiredEnv('SUPABASE_SECRET_KEY',env);
 if(/^sb_secret_[A-Za-z0-9_-]{20,}$/u.test(key))return;
 try{
  if(key.length>16384||!(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(key)))throw Error();
  const claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString('utf8'));
  if(claims.role!=='service_role'||(project!=='local'&&claims.ref!==project))throw Error();
 }catch{throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);}
}
const parse=<T>(schema:z.ZodType<T>,input:unknown):T=>{const value=schema.safeParse(input);if(!value.success)throw new ApplicationError('INVALID_INPUT',400);return value.data;};
const publicStatus=(value:unknown)=>{const {email:_,...status}=result.parse(value);return status;};
export class InvitationOperator{
 constructor(private readonly database=new Database(),private readonly env=process.env){}
 private call(operation:string,operator:string,input:unknown){return this.database.rpc('fmat_invitation_operator',{p_operation:operation,p_operator:operator,p_input:input});}
 async issue(input:unknown){
  const command=parse(invitationIssueInput,input);invitationOperatorConfiguration(command.project,this.env);
  const material=new InvitationCodes(this.env).material(command),origin=applicationOrigin(this.env),url=new URL(origin);
  if(command.project==='local'?!loopback(url):url.protocol!=='https:')throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  const accountId=command.delivery==='cloudflare'?new CloudflareEmail(this.env).configuration().accountId:null;
  const {operator,...values}=command;
  const status=publicStatus(await this.call('issue',operator,{...values,origin,accountId,tokenHash:material.tokenHash}));
  return {project:command.project,idempotencyKey:command.idempotencyKey,...status};
 }
 async status(input:unknown){const {operator,...target}=parse(invitationStatusInput,input);invitationOperatorConfiguration(target.project,this.env);return {project:target.project,...publicStatus(await this.call('status',operator,target))};}
 async revoke(input:unknown){const {operator,...target}=parse(invitationRevokeInput,input);invitationOperatorConfiguration(target.project,this.env);return {project:target.project,idempotencyKey:target.idempotencyKey,...publicStatus(await this.call('revoke',operator,target))};}
 /** Private result: only the exclusive artifact writer may expose this value. */
 async recover(input:unknown){
  const {operator,...target}=parse(invitationStatusInput,input);invitationOperatorConfiguration(target.project,this.env);
  const value=recovery.parse(await this.call('recover',operator,target));
  if(value.project!==target.project||value.invitationId!==target.invitationId)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  const material=new InvitationCodes(this.env).material({project:value.project,operator:value.operator,email:value.email,idempotencyKey:value.idempotencyKey,delivery:value.delivery});
  const origin=applicationOrigin({...this.env,APP_ORIGIN:value.origin});
  if(material.tokenHash!==value.tokenHash)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  if(Date.parse(value.expiresAt)<=Date.now())throw new ApplicationError('INVITATION_INVALID',400);
  return {version:1,invitationId:value.invitationId,recipient:value.email,expiresAt:value.expiresAt,setupUrl:origin+'/app',code:material.groupedCode};
 }
}
