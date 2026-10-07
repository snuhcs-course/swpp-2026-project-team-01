import {createHash} from 'node:crypto';
import {z} from 'zod';
import {publicHandle,publicProfile,intakeDetails,intakeProof,intakeContinuation} from '../../contracts/intake.ts';
import {Database} from '../database/client.ts';
import {TokenCipher} from '../calendar/encryption.ts';
import {tokenBundle} from '../calendar/google.ts';
import {GoogleCalendarProvider,type CalendarProvider} from '../calendar/catalog.ts';
import {ApplicationError} from '../errors.ts';
const contextSchema=z.object({profile:publicProfile,grant:z.object({principalId:z.uuid(),connectionId:z.uuid(),generation:z.uuid(),encryptedCredential:z.string(),rulesVersion:z.number().int(),conflictCalendarIds:z.array(z.string()).min(1),bookingCalendarId:z.string().min(1)})});

export class PublicIntake {
 constructor(private readonly database:Pick<Database,'rpc'>=new Database(),private readonly env=process.env,private readonly provider:CalendarProvider=new GoogleCalendarProvider(env)){}
 private call(operation:string,handle:string,token:string|null,input:Record<string,unknown>={}){
  return this.database.rpc('fmat_public_intake',{p_operation:operation,p_token_hash:token===null?null:createHash('sha256').update(intakeProof.parse(token)).digest('hex'),p_input:{...input,handle:publicHandle.parse(handle)}});
 }
 private async current(handle:string){
  const {profile,grant}=contextSchema.parse(await this.call('context',handle,null)),cipher=new TokenCipher(this.env),context='google:host:'+grant.principalId;
  let bundle=tokenBundle.parse(cipher.open(grant.encryptedCredential,context));
  const version={connectionId:grant.connectionId,generation:grant.generation,rulesVersion:grant.rulesVersion};
  if(bundle.expiresAt<=Date.now()+60_000){
   bundle=await this.provider.refresh(bundle);
   await this.call('refresh',handle,null,{...version,previousCredential:grant.encryptedCredential,encryptedCredential:cipher.seal(bundle,context)});
  }
  const calendars=await this.provider.list(bundle.accessToken);
  if(!calendars.some(c=>c.id===grant.bookingCalendarId&&['owner','writer','writerWithoutPrivateAccess'].includes(c.accessRole))||
   !grant.conflictCalendarIds.every(id=>calendars.some(c=>c.id===id)))throw new ApplicationError('NOT_FOUND',404);
  await this.call('check',handle,null,version);
  return {profile,version};
 }
 async profile(handle:string){return (await this.current(handle)).profile;}
 async resume(handle:string,token:string){return intakeContinuation.nullable().parse(await this.call('resume',handle,token));}
 async create(handle:string,token:string,input:unknown){
  const details=intakeDetails.parse(input);
  // Replay a committed request without requiring Google to be available again.
  const replay=intakeContinuation.nullable().parse(await this.call('replay',handle,token,{details}));
  if(replay)return replay;
  const {version}=await this.current(handle);
  return intakeContinuation.parse(await this.call('create',handle,token,{...version,details}));
 }
}
