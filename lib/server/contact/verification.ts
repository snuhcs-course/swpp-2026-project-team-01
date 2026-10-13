import {createHmac,randomInt,randomUUID} from 'node:crypto';
import {contactTarget,contactStart,contactConfirm,contactState,contactResult} from '../../contracts/contact-verification.ts';
import {Database} from '../database/client.ts';
import {requireCredential,type Credential} from '../identity/credentials.ts';
import {TokenCipher} from '../calendar/encryption.ts';
import {ApplicationError} from '../errors.ts';
import {requiredEnv} from '../config.ts';

export class ContactVerification{
 constructor(private readonly database=new Database(),private readonly env=process.env){}
 private credential(value:Credential){requireCredential(value);if(value.kind!=='guest')throw new ApplicationError('FORBIDDEN',403);return value;}
 private hash(requestId:string,challengeId:string,code:string){
  // Validate the existing key encoding before using a separate HMAC domain.
  new TokenCipher(this.env);
  const key=createHmac('sha256',Buffer.from(requiredEnv('TOKEN_ENCRYPTION_KEY',this.env),'base64')).update('contact-verification-code-hash:v1').digest();
  return createHmac('sha256',key).update(requestId+':'+challengeId+':'+code).digest('hex');
 }
 async read(credential:Credential,input:unknown){return contactState.parse(await this.database.rpc('fmat_contact_verification',{p_operation:'read',p_credential:this.credential(credential),p_input:contactTarget.parse(input)}));}
 async start(credential:Credential,input:unknown){
  this.credential(credential);const parsed=contactStart.parse(input),challengeId=randomUUID(),code=String(randomInt(1_000_000)).padStart(6,'0');
  const encryptedCode=new TokenCipher(this.env).seal({code},'contact-verification:'+parsed.requestId+':'+challengeId);
  return contactResult.parse(await this.database.rpc('fmat_contact_verification',{p_operation:'start',p_credential:credential,p_input:{...parsed,challengeId,codeHash:this.hash(parsed.requestId,challengeId,code),encryptedCode}}));
 }
 async confirm(credential:Credential,input:unknown){
  this.credential(credential);const {code,...parsed}=contactConfirm.parse(input);
  return contactResult.parse(await this.database.rpc('fmat_contact_verification',{p_operation:'confirm',p_credential:credential,p_input:{...parsed,codeHash:this.hash(parsed.requestId,parsed.challengeId,code)}}));
 }
}
