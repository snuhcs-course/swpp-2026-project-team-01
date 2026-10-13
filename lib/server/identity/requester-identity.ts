import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {intakeProof,publicHandle} from '../../contracts/intake.ts';
import {identityStart,identityApply,identityCallback,requesterIdentityState} from '../../contracts/requester-identity.ts';
import {Database} from '../database/client.ts';
import {TokenCipher} from '../calendar/encryption.ts';
import {requireCredential,type Credential} from './credentials.ts';
import {GoogleRequesterIdentity,type RequesterIdentityProvider} from './google-requester.ts';
import {ApplicationError} from '../errors.ts';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export type IdentityAuthority={kind:'intake';handle:string;token:string}|Credential;
export class RequesterIdentity {
 constructor(private readonly db:Pick<Database,'rpc'>=new Database(),private readonly env=process.env,private readonly provider?:RequesterIdentityProvider){}
 private authority(value:IdentityAuthority){
  if(value.kind==='intake')return {kind:'intake',handle:publicHandle.parse(value.handle),tokenHash:hash(intakeProof.parse(value.token))};
  requireCredential(value);if(value.kind!=='guest')throw new ApplicationError('FORBIDDEN',403);return value;
 }
 private call(operation:string,authority:IdentityAuthority|null,input:unknown){return this.db.rpc('fmat_requester_identity',{p_operation:operation,p_authority:authority?this.authority(authority):null,p_input:input});}
 async read(authority:IdentityAuthority){return requesterIdentityState.parse(await this.call('read',authority,{}));}
 async skip(authority:IdentityAuthority){await this.call('skip',authority,{});return {skipped:true};}
 async start(authority:IdentityAuthority,input:unknown){
  const data=identityStart.parse(input);this.authority(authority);
  if(authority.kind==='guest'&&!data.revision)throw new ApplicationError('INVALID_INPUT',400);
  const state=randomBytes(32).toString('base64url'),binding=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url');
  const url=(this.provider??new GoogleRequesterIdentity(this.env)).authorization(state,verifier,nonce);
  await this.call('start',authority,{...data,flowId:randomUUID(),stateHash:hash(state),bindingHash:hash(binding),encryptedVerifier:new TokenCipher(this.env).seal({verifier,nonce},'requester-identity:'+hash(state))});
  return {url,state,binding};
 }
 async lookup(state:string,binding:string){return z.discriminatedUnion('kind',[
  z.object({kind:z.literal('intake'),target:publicHandle}),z.object({kind:z.literal('guest'),target:z.uuid()}),
 ]).parse(await this.call('lookup',null,{stateHash:hash(intakeProof.parse(state)),bindingHash:hash(intakeProof.parse(binding))}));}
 async callback(authority:IdentityAuthority,input:unknown){
  const data=identityCallback.parse(input);
  const consumed=z.object({flowId:z.uuid(),returnPath:z.string(),encryptedVerifier:z.string()}).parse(await this.call('consume',authority,{stateHash:hash(data.state),bindingHash:hash(data.binding)}));
  const expected=authority.kind==='intake'?'/'+authority.handle:authority.kind==='guest'?'/booking/'+authority.requestId:null;
  if(!expected||expected!==consumed.returnPath)throw new ApplicationError('OAUTH_STATE_INVALID',400);
  if(data.denied||!data.code)return {returnPath:expected,result:'denied' as const};
  try{
   const secret=z.object({verifier:intakeProof,nonce:intakeProof}).parse(new TokenCipher(this.env).open(consumed.encryptedVerifier,'requester-identity:'+hash(data.state)));
   const identity=await (this.provider??new GoogleRequesterIdentity(this.env)).exchange(data.code,secret.verifier,secret.nonce);
   const args={flowId:consumed.flowId,identity};
   // Retry only the idempotent database save; never re-exchange a used code.
   try{await this.call('save',authority,args);}catch(error){if(!(error instanceof ApplicationError)||error.code!=='PROVIDER_UNAVAILABLE')throw error;await this.call('save',authority,args);}
   return {returnPath:expected,result:'verified' as const};
  }catch{return {returnPath:expected,result:'retry' as const};}
 }
 async apply(authority:IdentityAuthority,input:unknown){return z.object({verified:z.literal(true),revision:z.number().int()}).parse(await this.call('apply',authority,identityApply.parse(input)));}
}
