import {z} from 'zod';
import {preparedEmail,type PreparedEmail} from './cloudflare.ts';
import {applicationOrigin} from '../config.ts';
import {recoveryRedeem} from '../../contracts/requester-recovery.ts';
const escape=(text:string)=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export function requesterRecoveryEmail(input:{id:string;accountId:string;to:string;requestId:string;challengeId:string;proof:string;origin:string;expiresAt:string}):PreparedEmail{
 const {requestId,challengeId,proof}=recoveryRedeem.parse({requestId:input.requestId,challengeId:input.challengeId,proof:input.proof});
 const origin=applicationOrigin({NODE_ENV:'production',APP_ORIGIN:input.origin}),expires=z.iso.datetime({offset:true}).parse(input.expiresAt);
 const url=origin+'/booking/'+requestId+'#recover='+challengeId+'.'+proof;
 const expiry=new Date(expires).toISOString().replace('T',' ').replace(/\.\d{3}Z$/u,' UTC');
 const text=['Recover your meeting request','Open this link, then choose Restore request access:',url,'Expires: '+expiry,'Restoring access replaces the previous private request link. It does not sign you in, agree to a proposal or approve a meeting.','Keep this link private. If you did not request it, ignore this email. Your current access stays unchanged until the link is redeemed.'].join('\n\n');
 const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:24px;font-family:Arial,sans-serif;color:#18251c;background:#f8faf8"><main style="max-width:600px;margin:auto;padding:24px;background:#fff;border-radius:16px"><p>Find Me a Time</p><h1>Recover your meeting request</h1><p>Open the link, then choose <strong>Restore request access</strong>.</p><p><a href="'+escape(url)+'">Open request recovery</a></p><p>Expires: '+expiry+'</p><p>Restoring access replaces the previous private request link. It does not sign you in, agree to a proposal or approve a meeting.</p><p>Keep this link private. If you did not request it, ignore this email. Your current access stays unchanged until the link is redeemed.</p></main></body></html>';
 return preparedEmail.parse({id:input.id,accountId:input.accountId,message:{from:'no-reply@findmeatime.com',to:input.to,subject:'Recover your meeting request',html,text}});
}
