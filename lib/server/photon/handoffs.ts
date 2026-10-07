import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {applicationOrigin} from '../config.ts';
import {TokenCipher} from '../calendar/encryption.ts';
import {browserProof,proofHash} from './proof.ts';
import {PhotonTransport,type SendResult} from './transport.ts';
import {phoneNumber} from '../../contracts/imessage.ts';

const secret=z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
export const handoffProof=z.strictObject({handoffId:z.uuid(),token:secret});
const resolved=z.object({handoffId:z.uuid(),phone:phoneNumber,line:z.string().min(1),spaceId:z.string().min(1),expiresAt:z.string()}).strict();
const intent=z.object({action:z.enum(['send','reconcile']),handoffId:z.uuid(),projectId:z.uuid(),phone:phoneNumber,line:z.string().min(1),spaceId:z.string().min(1),encryptedToken:z.string().nullable(),providerReference:z.string().nullable(),leaseToken:z.uuid()}).strict();
const claim=z.union([z.object({action:z.enum(['idle','suppressed'])}).strict(),intent]);
const prepared=z.object({outcome:z.enum(['idle','handoff','limited','revoked'])}).strict();

export class PhotonHandoffs {
 constructor(private readonly database:Pick<Database,'rpc'>=new Database(),private readonly env=process.env,
  private readonly transport:Pick<PhotonTransport,'send'|'reconcile'>=new PhotonTransport(env)){}
 private project(){const project=z.uuid().safeParse(this.env.PHOTON_PROJECT_ID);if(!project.success)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);return project.data;}
 private call(operation:string,input:unknown){return this.database.rpc('fmat_photon_handoff',{p_operation:operation,p_project_id:this.project(),p_input:input});}
 private context(id:string){return `photon:handoff:${this.project()}:${id}`;}
 async prepare(){
  const counts={handoff:0,limited:0,revoked:0},cipher=new TokenCipher(this.env);
  for(let n=0;n<5;n++){
   const id=randomUUID(),token=browserProof();
   const result=prepared.parse(await this.call('prepare',{handoffId:id,tokenHash:proofHash(token),encryptedToken:cipher.seal({token},this.context(id))}));
   if(result.outcome==='idle')break;counts[result.outcome]++;
  }
  return counts;
 }
 // This returns server-only route metadata, never account or setup records.
 // A browser adapter must bind its own proof and require fresh host/OTP proof.
 async resolve(input:unknown){const {handoffId,token}=handoffProof.parse(input);return resolved.parse(await this.call('resolve',{handoffId,tokenHash:proofHash(token)}));}
 async dispatch(){
  const claimed:z.infer<typeof intent>[]=[];let suppressed=0;
  for(let n=0;n<5;n++){
   const value=claim.parse(await this.call('claim',{}));if(value.action==='idle')break;
   if(value.action==='suppressed'){suppressed++;continue;}if('handoffId' in value)claimed.push(value);
  }
  const results=await Promise.allSettled(claimed.map(async item=>{
   const lease={handoffId:item.handoffId,leaseToken:item.leaseToken};
   let result:SendResult|{status:'revoked';providerReference:string|null}={status:'uncertain',providerReference:item.providerReference};
   try{
    if(item.projectId!==this.project()||item.spaceId!=='any;-;'+item.phone)throw new ApplicationError('FORBIDDEN',403);
    await this.call('authorize',lease);
    if(item.action==='send'){
     if(!item.encryptedToken)throw new ApplicationError('FORBIDDEN',403);
     const {token}=z.object({token:secret}).parse(new TokenCipher(this.env).open(item.encryptedToken,this.context(item.handoffId)));
     const url=applicationOrigin(this.env)+'/app#imessage='+item.handoffId+'.'+token;
     result=await this.transport.send({line:item.line,spaceId:item.spaceId},item.phone,
      `Continue setting up Find Me a Time: ${url}\nThis private link expires 15 minutes after your message. Sign in with your invited email, then verify a fresh code here to link your number. Do not forward the link or code.`,
      item.handoffId,async()=>{await this.call('authorize',lease);});
    }else result=await this.transport.reconcile({line:item.line,spaceId:item.spaceId},item.providerReference);
   }catch(error){if(error instanceof ApplicationError&&[401,403,404].includes(error.status))result={status:'revoked',providerReference:item.providerReference};}
   await this.call('finish',{...lease,...result});
  }));
  return {claimed:claimed.length,suppressed,recorded:results.filter(r=>r.status==='fulfilled').length};
 }
}
