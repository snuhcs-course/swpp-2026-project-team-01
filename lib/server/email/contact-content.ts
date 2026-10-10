import {z} from 'zod';
import {preparedEmail,type PreparedEmail} from './cloudflare.ts';
export function contactVerificationEmail(input:{id:string;accountId:string;to:string;code:string;expiresAt:string}):PreparedEmail{
 const code=z.string().regex(/^\d{6}$/u).parse(input.code),expires=new Date(input.expiresAt);
 if(!Number.isFinite(expires.getTime()))throw new Error('INVALID_CONTACT_EMAIL');
 const expiry=expires.toISOString().replace('T',' ').replace(/\.\d{3}Z$/u,' UTC');
 const text=['Verify your meeting contact email','Your verification code: '+code,'Enter this code on your open Find Me a Time booking page.','Expires: '+expiry,'This code verifies your contact email only. It does not sign you in or approve a meeting.','If you did not request this code, you can ignore this email.'].join('\n\n');
 const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:24px;font-family:Arial,sans-serif;color:#18251c;background:#f8faf8"><main style="max-width:600px;margin:auto;padding:24px;background:#fff;border-radius:16px"><p>Find Me a Time</p><h1>Verify your meeting contact email</h1><p style="font-size:32px;letter-spacing:4px;font-weight:bold">'+code+'</p><p>Enter this code on your open Find Me a Time booking page.</p><p>Expires: '+expiry+'</p><p>This code verifies your contact email only. It does not sign you in or approve a meeting.</p><p>If you did not request this code, you can ignore this email.</p></main></body></html>';
 return preparedEmail.parse({id:input.id,accountId:input.accountId,message:{from:'no-reply@findmeatime.com',to:input.to,subject:'Verify your meeting contact email',html,text}});
}
