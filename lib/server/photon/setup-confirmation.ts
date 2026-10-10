import {z} from 'zod';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {TokenCipher} from '../calendar/encryption.ts';
import {calendarScopes,tokenBundle,type TokenBundle} from '../calendar/google.ts';
import {GoogleCalendarProvider,type CalendarProvider} from '../calendar/catalog.ts';
import {formatPrivateSetupReview} from './setup-review.ts';

const receipt=z.object({confirmed:z.literal(true),reviewId:z.uuid(),revision:z.number().int().nonnegative(),rulesVersion:z.number().int().positive(),savedAt:z.iso.datetime({offset:true})}).strict();
const confirmed=z.object({status:z.literal('confirmed'),receipt}).strict();
const checking=z.object({status:z.literal('checking'),checkId:z.uuid(),hostId:z.uuid(),providerSubject:z.string().min(1),encryptedCredential:z.string().min(1)}).strict();

/** Internal signed-inbox adapter. Never expose inbox IDs as browser credentials
 * or register these methods as model/MCP tools. SQL derives current authority
 * from the frozen provider receipt, including its literal human command. */
export class PrivateSetupConfirmation {
 constructor(private readonly database=new Database(),private readonly env=process.env,private readonly provider:CalendarProvider=new GoogleCalendarProvider(env)){}
 private call(operation:string,inboxId:string,input:unknown){
  return this.database.rpc('fmat_photon_setup',{p_operation:operation,p_inbox_id:z.uuid().parse(inboxId),p_input:input});
 }
 async review(inboxId:string){
  const snapshot=z.object({reviewId:z.uuid(),expiresAt:z.string(),settings:z.unknown(),text:z.string().nullable()}).parse(await this.call('review',inboxId,{}));
  if(snapshot.text!==null)return {kind:'review' as const,text:snapshot.text};
  const formatted=formatPrivateSetupReview({reviewId:snapshot.reviewId,expiresAt:snapshot.expiresAt,settings:snapshot.settings});
  if(formatted.kind==='review'){
   const published=z.object({text:z.string()}).parse(await this.call('publish',inboxId,{reviewId:snapshot.reviewId,text:formatted.text}));
   return {kind:'review' as const,text:published.text};
  }
  return formatted;
 }
 async confirm(inboxId:string,reviewId:string){
  const start=z.discriminatedUnion('status',[confirmed,checking]).parse(await this.call('begin_confirmation',inboxId,{reviewId:z.uuid().parse(reviewId)}));
  // Lost-response recovery must succeed before decrypting credentials or any
  // provider request, even if a newer draft or Calendar grant now exists.
  if(start.status==='confirmed')return start.receipt;
  const cipher=new TokenCipher(this.env),context='google:host:'+start.hostId;
  const validate=(value:unknown):TokenBundle=>{
   const bundle=tokenBundle.parse(value);
   if(bundle.subject!==start.providerSubject||calendarScopes.host.filter(s=>s.startsWith('https:')).some(scope=>!bundle.scopes.includes(scope)))throw new ApplicationError('RECONNECT_REQUIRED',409);
   return bundle;
  };
  let bundle=validate(cipher.open(start.encryptedCredential,context));
  const signal=AbortSignal.timeout(25_000);
  if(bundle.expiresAt<=Date.now()+60_000){
   bundle=validate(await this.provider.refresh(bundle,'host',signal));
   if(bundle.expiresAt<=Date.now()+30_000)throw new ApplicationError('RECONNECT_REQUIRED',409);
   const refreshed=z.union([confirmed,z.object({status:z.literal('refreshed')}).strict()]).parse(await this.call('refresh',inboxId,{checkId:start.checkId,previousCredential:start.encryptedCredential,encryptedCredential:cipher.seal(bundle,context)}));
   if(refreshed.status==='confirmed')return refreshed.receipt;
  }
  const calendars=await this.provider.list(bundle.accessToken,signal);
  const result=confirmed.parse(await this.call('finish_confirmation',inboxId,{checkId:start.checkId,verifiedCalendars:calendars.map(c=>({id:c.id,accessRole:c.accessRole}))}));
  return result.receipt;
 }
}
