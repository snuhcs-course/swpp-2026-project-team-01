import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {handoffProof,handoffState,handoffStartInput,imessageState} from '../../contracts/imessage.ts';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {requireCredential,type Credential} from '../identity/credentials.ts';
import {LinkProof,proofHash} from './proof.ts';

export class PhotonBrowserHandoff {
 constructor(private readonly database:Pick<Database,'rpc'>=new Database(),private readonly env=process.env){}
 private call(operation:string,browser:string,input:unknown,credential:Credential|null=null,extra:Record<string,unknown>={}){
  const project=z.uuid().safeParse(this.env.PHOTON_PROJECT_ID);
  if(!project.success)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  const {handoffId,token}=handoffProof.parse(input);
  return this.database.rpc('fmat_photon_handoff_browser',{p_operation:operation,p_project_id:project.data,p_credential:credential,
   p_input:{handoffId,tokenHash:proofHash(token),browserHash:proofHash(browser),...extra}});
 }
 async exchange(browser:string,input:unknown){return handoffState.parse(await this.call('exchange',browser,input));}
 async read(browser:string,input:unknown){return handoffState.parse(await this.call('read',browser,input));}
 async start(credential:Credential,browser:string,entry:unknown,input:unknown){
  requireCredential(credential);if(credential.kind!=='host')throw new ApplicationError('FORBIDDEN',403);
  const choice=handoffStartInput.parse(input),proof=new LinkProof(this.env),challengeId=randomUUID(),code=proof.code();
  return imessageState.parse(await this.call('start',browser,entry,credential,{...choice,challengeId,
   codeHash:proof.hash(challengeId,code),encryptedCode:proof.seal(challengeId,credential.subject,z.uuid().parse(this.env.PHOTON_PROJECT_ID),code)}));
 }
}
