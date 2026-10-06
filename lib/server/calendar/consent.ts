import {createHash,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {calendarStatus} from '../../contracts/calendar.ts';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {requireCredential,type Credential} from '../identity/credentials.ts';
import {TokenCipher} from './encryption.ts';
import {GoogleOAuth,googleCallback,type GoogleConsent} from './google.ts';
export const opaque=z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const exchangeView=z.object({exchangeId:z.uuid(),kind:z.enum(['host','guest']),principalId:z.uuid(),returnPath:z.string(),redirectUri:z.string(),encryptedVerifier:z.string()});
export class CalendarConsent {
  constructor(private readonly database=new Database(),private readonly env=process.env,private readonly provider?:GoogleConsent){}
  private call(operation:string,credential:Credential|null,input:unknown){return this.database.rpc('fmat_calendar_consent',{p_operation:operation,p_credential:credential,p_input:input});}
  async status(credential:Credential){requireCredential(credential);return calendarStatus.parse(await this.call('status',credential,{}));}
  async disconnect(credential:Credential){requireCredential(credential);return calendarStatus.parse(await this.call('disconnect',credential,{}));}
  async start(credential:Credential){
    requireCredential(credential);const cipher=new TokenCipher(this.env),google=this.provider??new GoogleOAuth(this.env);
    const state=randomBytes(32).toString('base64url'),binding=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url');
    const url=google.authorization(credential.kind,state,verifier,nonce);
    await this.call('start',credential,{stateHash:hash(state),bindingHash:hash(binding),encryptedVerifier:cipher.seal({verifier,nonce},'oauth:'+hash(state)),redirectUri:googleCallback(this.env)});
    return {state,binding,url};
  }
  async callback(state:string,binding:string,code:string|null,denied:boolean){
    opaque.parse(state);opaque.parse(binding);
    const exchange=exchangeView.parse(await this.call('consume',null,{stateHash:hash(state),bindingHash:hash(binding)}));
    const expectedReturn=exchange.kind==='host'?'/app':'/booking/'+exchange.principalId;
    if(exchange.returnPath!==expectedReturn||exchange.redirectUri!==googleCallback(this.env))throw new ApplicationError('OAUTH_STATE_INVALID',400);
    if(denied||!code)return {returnPath:expectedReturn,result:'denied' as const};
    try{
      const cipher=new TokenCipher(this.env);
      const secret=z.object({verifier:opaque,nonce:opaque}).parse(cipher.open(exchange.encryptedVerifier,'oauth:'+hash(state)));
      const token=await (this.provider??new GoogleOAuth(this.env)).exchange(z.string().min(1).max(4096).parse(code),secret.verifier,secret.nonce,exchange.kind);
      await this.call('save',null,{exchangeId:exchange.exchangeId,providerSubject:token.subject,scopes:token.scopes,encryptedCredential:cipher.seal(token,`google:${exchange.kind}:${exchange.principalId}`)});
      return {returnPath:expectedReturn,result:'connected' as const};
    }catch{return {returnPath:expectedReturn,result:'reconnect' as const};}
  }
}
