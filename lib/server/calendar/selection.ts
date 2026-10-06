import {z} from 'zod';
import {calendarSelection,calendarCatalog} from '../../contracts/calendar.ts';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {requireCredential,type Credential} from '../identity/credentials.ts';
import {TokenCipher} from './encryption.ts';
import {tokenBundle} from './google.ts';
import {GoogleCalendarProvider,type CalendarProvider} from './catalog.ts';
const grantSchema=z.object({connectionId:z.uuid(),generation:z.uuid(),principalId:z.uuid(),encryptedCredential:z.string(),rulesVersion:z.number().int(),conflictCalendarIds:z.array(z.string()),bookingCalendarId:z.string().nullable()});
export class CalendarSelection {
  constructor(private readonly database=new Database(),private readonly env=process.env,private readonly provider:CalendarProvider=new GoogleCalendarProvider(env)){}
  private call(operation:string,credential:Credential,input:unknown){requireCredential(credential);if(credential.kind!=='host')throw new ApplicationError('FORBIDDEN',403);return this.database.rpc('fmat_calendar_access',{p_operation:operation,p_credential:credential,p_input:input});}
  private async current(credential:Credential){
    const grant=grantSchema.parse(await this.call('read',credential,{})),cipher=new TokenCipher(this.env),context='google:host:'+grant.principalId;
    let bundle=tokenBundle.parse(cipher.open(grant.encryptedCredential,context));
    if(bundle.expiresAt<=Date.now()+60_000){
      bundle=await this.provider.refresh(bundle);
      const encryptedCredential=cipher.seal(bundle,context);
      await this.call('refresh',credential,{connectionId:grant.connectionId,generation:grant.generation,previousCredential:grant.encryptedCredential,encryptedCredential});
      grant.encryptedCredential=encryptedCredential;
    }
    return {grant,bundle};
  }
  async list(credential:Credential){
    const {grant,bundle}=await this.current(credential),calendars=await this.provider.list(bundle.accessToken);
    await this.call('check',credential,{connectionId:grant.connectionId,generation:grant.generation});
    return calendarCatalog.parse({generation:grant.generation,rulesVersion:grant.rulesVersion,calendars,conflictCalendarIds:grant.conflictCalendarIds,bookingCalendarId:grant.bookingCalendarId});
  }
  async select(credential:Credential,input:unknown){
    const selection=calendarSelection.parse(input),{grant,bundle}=await this.current(credential);
    if(selection.generation!==grant.generation||selection.rulesVersion!==grant.rulesVersion)throw new ApplicationError('STALE_REVISION',409);
    const verifiedCalendars=await this.provider.list(bundle.accessToken);
    const result=await this.call('select',credential,{...selection,connectionId:grant.connectionId,verifiedCalendars:verifiedCalendars.map(c=>({id:c.id,accessRole:c.accessRole}))});
    return z.object({saved:z.literal(true),rulesVersion:z.number().int()}).parse(result);
  }
}
