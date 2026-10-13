import {z} from 'zod';
import {availabilityState,manualAvailability,requesterCatalog,requesterSelection,interval} from '../../contracts/availability.ts';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {requireCredential,type Credential} from '../identity/credentials.ts';
import {TokenCipher} from './encryption.ts';
import {calendarScopes,tokenBundle} from './google.ts';
import {GoogleCalendarProvider,type CalendarProvider} from './catalog.ts';
import {GoogleFreeBusy,type FreeBusyProvider} from './freebusy.ts';
const grantSchema=z.object({connectionId:z.uuid(),generation:z.uuid(),principalId:z.uuid(),encryptedCredential:z.string(),revision:z.number().int(),selectedCalendarIds:z.array(z.string()),windows:z.array(interval)});
export class RequesterAvailability {
  constructor(private readonly database=new Database(),private readonly env=process.env,private readonly provider:CalendarProvider=new GoogleCalendarProvider(env),private readonly freebusy:FreeBusyProvider=new GoogleFreeBusy()){}
  private call(operation:string,credential:Credential,input:unknown){requireCredential(credential);if(credential.kind!=='guest')throw new ApplicationError('FORBIDDEN',403);return this.database.rpc('fmat_requester_availability',{p_operation:operation,p_credential:credential,p_input:input});}
  private context(grant:z.infer<typeof grantSchema>){return {connectionId:grant.connectionId,generation:grant.generation,revision:grant.revision};}
  async status(credential:Credential){return availabilityState.parse(await this.call('status',credential,{}));}
  private async current(credential:Credential,markFailure=false){
    const grant=grantSchema.parse(await this.call('read',credential,{})),cipher=new TokenCipher(this.env),context='google:guest:'+grant.principalId;
    try {
    let bundle=tokenBundle.parse(cipher.open(grant.encryptedCredential,context));
    if(calendarScopes.guest.filter(s=>s.startsWith('https:')).some(s=>!bundle.scopes.includes(s))||bundle.scopes.some(s=>![...calendarScopes.guest,'https://www.googleapis.com/auth/userinfo.email'].includes(s)))throw new ApplicationError('RECONNECT_REQUIRED',409);
    if(bundle.expiresAt<=Date.now()+60_000){
      bundle=await this.provider.refresh(bundle,'guest');const encryptedCredential=cipher.seal(bundle,context);
      await this.call('refresh',credential,{...this.context(grant),previousCredential:grant.encryptedCredential,encryptedCredential});
    }
    return {grant,bundle};
    }catch(error){if(markFailure)await this.call('read_failure',credential,this.context(grant)).catch(()=>{});throw error;}
  }
  async list(credential:Credential){
    const {grant,bundle}=await this.current(credential),calendars=await this.provider.list(bundle.accessToken);
    await this.call('check',credential,this.context(grant));
    return requesterCatalog.parse({generation:grant.generation,revision:grant.revision,calendars,selectedCalendarIds:grant.selectedCalendarIds});
  }
  async select(credential:Credential,input:unknown){
    const selection=requesterSelection.parse(input),{grant,bundle}=await this.current(credential);
    if(selection.generation!==grant.generation||selection.revision!==grant.revision)throw new ApplicationError('STALE_REVISION',409);
    const calendars=await this.provider.list(bundle.accessToken);
    return z.object({saved:z.literal(true),revision:z.number().int()}).parse(await this.call('select',credential,{...selection,connectionId:grant.connectionId,verifiedCalendarIds:calendars.map(c=>c.id)}));
  }
  async manual(credential:Credential,input:unknown){return z.object({saved:z.literal(true),revision:z.number().int()}).parse(await this.call('manual',credential,manualAvailability.parse(input)));}
  // Private server result for the evaluator. Do not expose raw busy intervals to the host/model.
  async read(credential:Credential){
    const {grant,bundle}=await this.current(credential,true);
    if(!grant.selectedCalendarIds.length||!grant.windows.length)throw new ApplicationError('INVALID_INPUT',400);
    let busy;
    try{busy=await this.freebusy.read(bundle.accessToken,grant.selectedCalendarIds,grant.windows);}
    catch(error){await this.call('read_failure',credential,this.context(grant)).catch(()=>{});throw error;}
    await this.call('read_success',credential,this.context(grant));
    return {revision:grant.revision,generation:grant.generation,busy,checkedAt:new Date().toISOString()};
  }
  async check(credential:Credential){const result=await this.read(credential);return {checked:true as const,revision:result.revision,checkedAt:result.checkedAt};}
}
