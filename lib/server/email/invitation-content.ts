import {createHash} from 'node:crypto';
import {z} from 'zod';
import {InvitationCodes} from '../identity/invitations.ts';
import {ApplicationError} from '../errors.ts';
import {preparedEmail} from './cloudflare.ts';
export const invitationDeliveryState=z.strictObject({phase:z.enum(['pending','prepared']),id:z.uuid(),project:z.string(),operator:z.string(),issueKey:z.uuid(),recipient:z.email(),origin:z.string(),accountId:z.string().regex(/^[a-f0-9]{32}$/u),templateVersion:z.literal(1),tokenHash:z.string().regex(/^[a-f0-9]{64}$/u),expiresAt:z.iso.datetime({offset:true}),basis:z.string().regex(/^[a-f0-9]{64}$/u),fingerprint:z.string().regex(/^[a-f0-9]{64}$/u).nullable()});
const escape=(value:string)=>value.replace(/[&<>"']/gu,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Version one is frozen for pending deliveries. Codes exist only in memory. */
export function invitationEmail(input:unknown,env=process.env){
 const state=invitationDeliveryState.parse(input);let origin:URL;
 try{origin=new URL(state.origin);}catch{throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);}
 if(origin.protocol!=='https:'||origin.origin!==state.origin||origin.username||origin.password)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
 const material=new InvitationCodes(env).material({project:state.project,operator:state.operator,email:state.recipient,idempotencyKey:state.issueKey,delivery:'cloudflare'});
 if(material.tokenHash!==state.tokenHash)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
 const setup=origin.origin+'/app',code=material.groupedCode;
 const prepared=preparedEmail.parse({id:state.id,accountId:state.accountId,message:{from:'no-reply@findmeatime.com',to:state.recipient,subject:'Your Find Me a Time invitation',text:`You are invited to host with Find Me a Time.\n\nOpen ${setup}\nSign in with Google using ${state.recipient}, then enter this invitation code:\n${code}\n\nExpires: ${state.expiresAt}\nThis invitation does not approve a meeting or grant Calendar access. Do not forward the code.`,html:`<p>You are invited to host with Find Me a Time.</p><p><a href="${escape(setup)}">Open your host workspace</a></p><p>Sign in with Google using ${escape(state.recipient)}, then enter this invitation code:</p><p><code>${code}</code></p><p>Expires: ${escape(state.expiresAt)}</p><p>This invitation does not approve a meeting or grant Calendar access. Do not forward the code.</p>`}});
 return {prepared,fingerprint:createHash('sha256').update(JSON.stringify(prepared)).digest('hex'),tokenHash:material.tokenHash};
}
