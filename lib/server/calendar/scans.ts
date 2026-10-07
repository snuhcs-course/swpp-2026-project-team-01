import {z} from 'zod';
import {analysisInput,analysisDecision,analysisState,analysisSummary,type AnalysisScope} from '../../contracts/calendar-analysis.ts';
import {Database} from '../database/client.ts';
import {requireCredential,type Credential} from '../identity/credentials.ts';
import {ApplicationError} from '../errors.ts';
import {CalendarSelection} from './selection.ts';
import {GoogleCalendarProvider,type CalendarProvider} from './catalog.ts';
import {GoogleEventProvider,analyzeCalendars,scanRange,type EventProvider} from './analysis.ts';
export class CalendarScans{
 private readonly selections:CalendarSelection;
 constructor(private readonly database=new Database(),env=process.env,private readonly provider:CalendarProvider=new GoogleCalendarProvider(env),private readonly events:EventProvider=new GoogleEventProvider()){this.selections=new CalendarSelection(database,env,provider);}
 private call(operation:string,credential:Credential,input:unknown){requireCredential(credential);if(credential.kind!=='host')throw new ApplicationError('FORBIDDEN',403);return this.database.rpc('fmat_calendar_scan',{p_operation:operation,p_credential:credential,p_input:input});}
 async read(credential:Credential){return analysisState.parse(await this.call('read',credential,{}));}
 private async available(credential:Credential,scope:AnalysisScope){const {grant,bundle}=await this.selections.current(credential),calendars=await this.provider.list(bundle.accessToken);if(scope.calendarIds.some(id=>!calendars.some(c=>c.id===id&&c.accessRole!=='freeBusyReader')))throw new ApplicationError('CALENDAR_ACCESS_INVALID',400);return {grant,bundle,calendars};}
 async start(credential:Credential,input:unknown){
  const choice=analysisInput.parse(input),{calendarIds,startDate,endDate,timezone}=choice,scope={calendarIds,startDate,endDate,timezone};scanRange(scope);
  const {grant,bundle,calendars}=await this.available(credential,scope);
  if(grant.generation!==choice.generation||grant.rulesVersion!==choice.rulesVersion)throw new ApplicationError('STALE_REVISION',409);
  const begin=z.object({execute:z.boolean(),id:z.uuid().optional(),state:analysisState}).parse(await this.call('start',credential,{scope,expectedRevision:choice.expectedRevision,rulesVersion:choice.rulesVersion,generation:choice.generation,consented:true,idempotencyKey:choice.idempotencyKey,verifiedCalendars:calendars.map(c=>({id:c.id,accessRole:c.accessRole}))}));
  if(!begin.execute)return begin.state;
  try{
   const values=await this.events.read(bundle.accessToken,scope),summary=analysisSummary.parse(analyzeCalendars(scope,values));
   // Event pages verify access roles; the commit fences authority and selected setup versions.
   return analysisState.parse(await this.call('complete',credential,{scanId:begin.id,summary}));
  }catch(error){await this.call('fail',credential,{scanId:begin.id}).catch(()=>{});throw error;}
 }
 async dismiss(credential:Credential,input:unknown){return analysisState.parse(await this.call('dismiss',credential,analysisDecision.parse(input)));}
 async apply(credential:Credential,input:unknown){
  const choice=analysisDecision.parse(input),current=await this.read(credential);
  if(current.scan?.id!==choice.scanId)throw new ApplicationError('STALE_REVISION',409);
  // A completed retry remains a database-authorized replay. New application rechecks metadata.
  if(current.scan.status==='ready')await this.available(credential,current.scan.scope);
  return analysisState.parse(await this.call('apply',credential,choice));
 }
}
