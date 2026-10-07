import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {imessageState,linkStartInput,linkVerifyInput,linkCancelInput,linkUnlinkInput} from '../../contracts/imessage.ts';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {requireCredential,type Credential} from '../identity/credentials.ts';
import {LinkProof,proofHash} from './proof.ts';
import {PhotonTransport} from './transport.ts';

export class HostIMessage {
 constructor(private readonly database=new Database(),private readonly env=process.env,
  private readonly transport:Pick<PhotonTransport,'prepare'>=new PhotonTransport(env)){}
 private project(required=false){
  const value=z.uuid().safeParse(this.env.PHOTON_PROJECT_ID);
  if(!value.success&&required)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  return value.success?value.data:null;
 }
 private call(operation:string,credential:Credential,input:Record<string,unknown>){
  requireCredential(credential);if(credential.kind!=='host')throw new ApplicationError('FORBIDDEN',403);
  return this.database.rpc('fmat_photon_link',{p_operation:operation,p_credential:credential,p_project_id:this.project(),p_input:input});
 }
 async read(credential:Credential,browser?:string){return imessageState.parse(await this.call('read',credential,{browserHash:browser?proofHash(browser):null}));}
 async start(credential:Credential,browser:string,input:unknown){
  const choice=linkStartInput.parse(input),browserHash=proofHash(browser),project=this.project(true)!;
  const replay=await this.call('start_replay',credential,{...choice,browserHash});
  if(replay!==null)return imessageState.parse(replay);
  const state=await this.read(credential,browser);
  if(!state.available)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  // Only an already-authorized host reaches route discovery. Commit rechecks
  // Auth/admission after provider preflight and resolves concurrent retries.
  const route=await this.transport.prepare(choice.phone),proof=new LinkProof(this.env),challengeId=randomUUID(),code=proof.code();
  if(credential.kind!=='host')throw new ApplicationError('FORBIDDEN',403);
  return imessageState.parse(await this.call('start',credential,{...choice,...route,browserHash,challengeId,
   codeHash:proof.hash(challengeId,code),encryptedCode:proof.seal(challengeId,credential.subject,project,code)}));
 }
 async verify(credential:Credential,browser:string,input:unknown){
  const {code,...choice}=linkVerifyInput.parse(input);
  return imessageState.parse(await this.call('verify',credential,{...choice,browserHash:proofHash(browser),codeHash:new LinkProof(this.env).hash(choice.challengeId,code)}));
 }
 async cancel(credential:Credential,browser:string|undefined,input:unknown){return imessageState.parse(await this.call('cancel',credential,{...linkCancelInput.parse(input),browserHash:browser?proofHash(browser):null}));}
 async skip(credential:Credential,browser?:string){return imessageState.parse(await this.call('skip',credential,{browserHash:browser?proofHash(browser):null}));}
 async unlink(credential:Credential,browser:string|undefined,input:unknown){return imessageState.parse(await this.call('unlink',credential,{...linkUnlinkInput.parse(input),browserHash:browser?proofHash(browser):null}));}
}
