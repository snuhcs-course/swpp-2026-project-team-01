import {z} from 'zod';
import {publicProfile} from '../../contracts/intake.ts';
import {TokenCipher} from '../calendar/encryption.ts';
import {tokenBundle} from '../calendar/google.ts';
import type {CalendarProvider} from '../calendar/catalog.ts';
import {ApplicationError} from '../errors.ts';

// Private, server-read provider context. Never accept this from a client or
// return it through a tool: it includes an encrypted host credential.
export const intakeReadinessContext=z.object({profile:publicProfile,grant:z.object({
 principalId:z.uuid(),connectionId:z.uuid(),generation:z.uuid(),encryptedCredential:z.string(),
 rulesVersion:z.number().int(),conflictCalendarIds:z.array(z.string()).min(1),bookingCalendarId:z.string().min(1),
})});
export type IntakeReadinessVersion=Readonly<{connectionId:string;generation:string;rulesVersion:number}>;
export interface IntakeReadinessAuthority {
 // Callbacks retain their caller's authority (public handle or consented intake).
 // Each transaction must recheck it, including after provider I/O.
 refresh(input:IntakeReadinessVersion&{previousCredential:string;encryptedCredential:string}):Promise<unknown>;
 check(input:IntakeReadinessVersion):Promise<unknown>;
}

/** Provider evidence only; creation must still recheck these versions and its
 * current authority atomically with the new request. A prior successful check
 * cannot authorize a later write. */
export async function checkIntakeReadiness(input:unknown,authority:IntakeReadinessAuthority,
 provider:CalendarProvider,env=process.env,now=Date.now){
 const {profile,grant}=intakeReadinessContext.parse(input);
 const cipher=new TokenCipher(env),context='google:host:'+grant.principalId;
 let bundle=tokenBundle.parse(cipher.open(grant.encryptedCredential,context));
 const version:IntakeReadinessVersion=Object.freeze({connectionId:grant.connectionId,generation:grant.generation,rulesVersion:grant.rulesVersion});
 if(bundle.expiresAt<=now()+60_000){
  bundle=await provider.refresh(bundle);
  await authority.refresh({...version,previousCredential:grant.encryptedCredential,encryptedCredential:cipher.seal(bundle,context)});
 }
 const calendars=await provider.list(bundle.accessToken);
 if(!calendars.some(c=>c.id===grant.bookingCalendarId&&['owner','writer','writerWithoutPrivateAccess'].includes(c.accessRole))||
  !grant.conflictCalendarIds.every(id=>calendars.some(c=>c.id===id)))throw new ApplicationError('NOT_FOUND',404);
 await authority.check(version);
 return {profile,version};
}
