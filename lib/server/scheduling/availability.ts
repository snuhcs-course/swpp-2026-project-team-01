import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {availabilityCheckInput,availabilityCheckReceipt} from '../../contracts/availability-evaluation.ts';
import {intervalFeasibilityInput,schedulingInterval} from '../../contracts/interval-feasibility.ts';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {requireCredential,type Credential} from '../identity/credentials.ts';
import {TokenCipher} from '../calendar/encryption.ts';
import {calendarScopes,tokenBundle,type TokenBundle} from '../calendar/google.ts';
import {GoogleCalendarProvider,type CalendarProvider} from '../calendar/catalog.ts';
import {GoogleFreeBusy,bufferedReadWindows,type FreeBusyProvider} from '../calendar/freebusy.ts';
import {evaluateIntervals} from './intervals.ts';

const grant=z.object({principalId:z.uuid(),providerSubject:z.string(),encryptedCredential:z.string(),calendarIds:z.array(z.string()).min(1).max(50)});
const snapshot=z.object({checkId:z.uuid(),basis:z.string().regex(/^[a-f0-9]{64}$/u),revision:z.number().int().positive(),rulesVersion:z.number().int().nonnegative(),
 details:z.object({windows:intervalFeasibilityInput.shape.windows,timezone:intervalFeasibilityInput.shape.requesterTimezone,durationMinutes:intervalFeasibilityInput.shape.durationMinutes}),
 rules:intervalFeasibilityInput.shape.rules.loose(),localBookings:z.array(schedulingInterval),mode:z.enum(['manual','calendar']),host:grant,guest:grant.nullable()});

/** Authorized, time-only stage shared by later candidate and booking work.
 * Private snapshots never leave the server; check() exposes only a receipt. */
export class AvailabilityEvaluation {
 constructor(private readonly database=new Database(),private readonly env=process.env,private readonly provider:CalendarProvider=new GoogleCalendarProvider(env),private readonly freebusy:FreeBusyProvider=new GoogleFreeBusy()){}
 private call(operation:string,credential:Credential,input:unknown){requireCredential(credential);return this.database.rpc('fmat_availability_evaluation',{p_operation:operation,p_credential:credential,p_input:input});}
 async read(credential:Credential,input:unknown){
  const target=availabilityCheckInput.parse(input);
  const state=snapshot.parse(await this.call('start',credential,{...target,checkId:randomUUID()}));
  const context={...target,checkId:state.checkId,basis:state.basis},cipher=new TokenCipher(this.env);
  const windows=state.details.windows;
  const read=async(party:'host'|'guest',selected:z.infer<typeof grant>)=>{
   // Recheck before each external read as well as after it. Network I/O never
   // runs inside a database transaction or grants authority to a stale caller.
   await this.call('check',credential,context);
   let bundle:TokenBundle;
   try{
    const encryptionContext='google:'+party+':'+selected.principalId;
    bundle=tokenBundle.parse(cipher.open(selected.encryptedCredential,encryptionContext));
    const validate=(value:TokenBundle)=>{
     if(value.subject!==selected.providerSubject||calendarScopes[party].filter(s=>s.startsWith('https:')).some(s=>!value.scopes.includes(s))||
       (party==='guest'&&value.scopes.some(s=>![...calendarScopes.guest,'https://www.googleapis.com/auth/userinfo.email'].includes(s))))throw new ApplicationError('RECONNECT_REQUIRED',409);
    };
    validate(bundle);
    if(bundle.expiresAt<=Date.now()+60_000){
     const refreshed=tokenBundle.parse(await this.provider.refresh(bundle,party));validate(refreshed);
     if(refreshed.expiresAt<=Date.now()+30_000)throw new ApplicationError('RECONNECT_REQUIRED',409);
     await this.call('refresh',credential,{...context,party,previousCredential:selected.encryptedCredential,encryptedCredential:cipher.seal(refreshed,encryptionContext)});
     bundle=refreshed;
    }
   }catch(error){
    // A stale authority error must not mark a newer request/connection failed.
    if(error instanceof ApplicationError&&!['RECONNECT_REQUIRED','PROVIDER_UNAVAILABLE'].includes(error.code))throw error;
    await this.call('failure',credential,{...context,party});
    throw error instanceof ApplicationError?error:new ApplicationError('RECONNECT_REQUIRED',409);
   }
   await this.call('check',credential,context);
   try{return await this.freebusy.read(bundle.accessToken,selected.calendarIds,party==='host'?bufferedReadWindows(windows,state.rules.bufferMinutes):windows);}
   catch(error){await this.call('failure',credential,{...context,party});throw error instanceof ApplicationError?error:new ApplicationError('PROVIDER_UNAVAILABLE',503);}
  };
  const hostBusy=await read('host',state.host);
  // An absent selected Calendar is never interpreted as manual availability.
  if(state.mode==='calendar'&&!state.guest)throw new ApplicationError('RECONNECT_REQUIRED',409);
  const requesterBusy=state.mode==='calendar'?await read('guest',state.guest!):[];
  const {timezone,availability,focusBlocks,bufferMinutes}=state.rules;
  const evaluation=evaluateIntervals({now:new Date().toISOString(),requesterTimezone:state.details.timezone,durationMinutes:state.details.durationMinutes,
    windows,requesterAvailability:windows,requesterBusy,hostBusy:[...hostBusy,...state.localBookings],rules:{timezone,availability,focusBlocks,bufferMinutes}});
  const receipt=availabilityCheckReceipt.parse({...await this.call('success',credential,context) as object,complete:false});
  return {receipt,evaluation,context,rulesVersion:state.rulesVersion};
 }
 async check(credential:Credential,input:unknown){return (await this.read(credential,input)).receipt;}
}
