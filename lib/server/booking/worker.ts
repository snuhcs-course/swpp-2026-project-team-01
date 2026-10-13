import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {AvailabilityEvaluation} from '../scheduling/availability.ts';
import {BookingDispatch,bookingLease} from './dispatch.ts';
import {GoogleBookingProvider,bookingTransportSnapshot,type BookingAccess} from '../calendar/booking.ts';
import {GoogleCalendarProvider,type CalendarProvider} from '../calendar/catalog.ts';
import {TokenCipher} from '../calendar/encryption.ts';
import {calendarScopes,tokenBundle,type TokenBundle} from '../calendar/google.ts';
const saved=z.object({requestId:z.uuid(),attemptId:z.uuid(),expectedRevision:z.number().int().positive(),phase:z.enum(['prepared','dispatched','uncertain','conflict','confirmed','noncreating','blocked']),payload:z.object({start:z.object({dateTime:z.string()}).loose(),end:z.object({dateTime:z.string()}).loose()}).loose()}).loose();
const grant=z.strictObject({hostId:z.uuid(),connectionId:z.uuid(),providerSubject:z.string().min(1),encryptedCredential:z.string().min(1)});
type Lease=z.infer<typeof bookingLease>;
type Outcome='idle'|'confirmed'|'uncertain'|'conflict'|'noncreating'|'blocked'|'complete'|'retry'|'lease_lost';

/** One bounded job per invocation. A persisted dispatched phase always takes
 * the lookup branch; only a newly committed positive receipt permits insert. */
export class BookingWorker {
 constructor(private readonly database=new Database(),private readonly env=process.env,
  private readonly evaluation=new AvailabilityEvaluation(database,env),private readonly transport:Pick<GoogleBookingProvider,'insert'|'reconcile'>=new GoogleBookingProvider(),
  private readonly calendar:CalendarProvider=new GoogleCalendarProvider(env)){}
 private call(operation:string,lease:Lease|{workerId:string},input:unknown={}){return this.database.rpc('fmat_booking_worker',{p_operation:operation,p_lease:lease,p_input:input});}
 async run():Promise<{claimed:number;outcome:Outcome}>{
  const {job}=z.strictObject({job:bookingLease.nullable()}).parse(await this.call('claim',{workerId:randomUUID()}));
  return job?{claimed:1,outcome:await this.process(job)}:{claimed:0,outcome:'idle'};
 }
 private async access(lease:Lease):Promise<BookingAccess>{
  const current=grant.parse(await this.call('access',lease)),cipher=new TokenCipher(this.env),context='google:host:'+current.hostId;
  const validate=(bundle:TokenBundle)=>{if(bundle.subject!==current.providerSubject||calendarScopes.host.filter(s=>s.startsWith('https:')).some(s=>!bundle.scopes.includes(s)))throw new ApplicationError('RECONNECT_REQUIRED',409);};
  let bundle=tokenBundle.parse(cipher.open(current.encryptedCredential,context));validate(bundle);
  if(bundle.expiresAt<=Date.now()+30_000){
   const previousCredential=current.encryptedCredential;
   bundle=tokenBundle.parse(await this.calendar.refresh(bundle,'host'));validate(bundle);
   if(bundle.expiresAt<=Date.now()+30_000)throw new ApplicationError('RECONNECT_REQUIRED',409);
   current.encryptedCredential=cipher.seal(bundle,context);
   const before=grant.parse(await this.call('access',lease));
   if(before.connectionId!==current.connectionId||before.providerSubject!==current.providerSubject||before.encryptedCredential!==previousCredential)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
   // Compare against the credential originally opened, not a newer refresh.
   await this.call('refresh',lease,{connectionId:current.connectionId,previousCredential,encryptedCredential:current.encryptedCredential});
  }
  const rechecked=grant.parse(await this.call('access',lease));
  if(rechecked.connectionId!==current.connectionId||rechecked.providerSubject!==current.providerSubject||rechecked.encryptedCredential!==current.encryptedCredential)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  return {principalKind:'host',providerSubject:bundle.subject,accessToken:bundle.accessToken,scopes:bundle.scopes};
 }
 async process(input:unknown):Promise<Outcome>{
  const lease=bookingLease.parse(input);
  try{
   const state=saved.parse(await this.call('load',lease));
   if(['confirmed','blocked','noncreating'].includes(state.phase)){await this.call('complete',lease);return 'complete';}
   let snapshot;
   if(state.phase==='prepared'){
    const check=await this.evaluation.readForBooking(lease,{requestId:state.requestId,revision:state.expectedRevision,candidate:{start:state.payload.start.dateTime,end:state.payload.end.dateTime}});
    if(!check.persisted||check.persisted.status!=='checks_passed'){
     await this.call('record',lease,{outcome:'blocked',reason:check.persisted?.status==='conflict'?'checks_conflict':'checks_clarification'});return 'blocked';
    }
    // Refresh before the cutoff; the final access check below fences revocation.
    await this.access(lease);
    const dispatch=await new BookingDispatch(this.database).dispatch(lease,{requestId:state.requestId,revision:state.expectedRevision,checkId:check.context.checkId,basis:check.context.basis,evaluationId:check.persisted.evaluationId});
    if(!dispatch.dispatched){await this.call('retry',lease,{errorCode:'PROVIDER_UNAVAILABLE'});return 'retry';}
    snapshot=dispatch.snapshot;
    const outcome=await this.transport.insert(await this.access(lease),snapshot);
    await this.call('record',lease,outcome);return outcome.outcome;
   }
   // Strip private worker fields before the strict transport boundary.
   snapshot=bookingTransportSnapshot.parse(Object.fromEntries(Object.keys(bookingTransportSnapshot.shape).map(key=>[key,state[key]])));
   const outcome=await this.transport.reconcile(await this.access(lease),snapshot);
   await this.call('record',lease,outcome);return outcome.outcome;
  }catch(error){
   if(error instanceof ApplicationError&&error.code==='BOOKING_LEASE_LOST')return 'lease_lost';
   // The preceding RPC may have committed despite a lost response. Read its
   // phase before choosing recovery; never infer noncreation from an exception.
   try{
    const state=saved.parse(await this.call('load',lease));
    if(['confirmed','blocked','noncreating'].includes(state.phase)){await this.call('complete',lease);return 'complete';}
    const code=error instanceof ApplicationError?error.code:'PROVIDER_UNAVAILABLE';
    if(state.phase==='prepared'&&['NOT_FOUND','FORBIDDEN','HOST_NOT_ADMITTED','STALE_REVISION','RECONNECT_REQUIRED','CONTACT_NOT_VERIFIED','CALENDAR_ACCESS_INVALID'].includes(code)){
     await this.call('record',lease,{outcome:'blocked',reason:code==='STALE_REVISION'?'stale_preconditions':'authority_unavailable'});return 'blocked';
    }
    await this.call('retry',lease,{errorCode:code==='BOOKING_BUSY'?'BOOKING_BUSY':code==='RECONNECT_REQUIRED'?'RECONNECT_REQUIRED':'PROVIDER_UNAVAILABLE'});return 'retry';
   }catch(cause){return cause instanceof ApplicationError&&cause.code==='BOOKING_LEASE_LOST'?'lease_lost':'retry';}
  }
 }
}
