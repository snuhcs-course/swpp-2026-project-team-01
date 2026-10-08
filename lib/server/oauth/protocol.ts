import {createHash,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {applicationOrigin} from '../config.ts';

export class AgentOAuthError extends Error {
 constructor(readonly code:'invalid_request'|'invalid_target'|'invalid_scope'|'unsupported_grant_type'|'invalid_grant'|'invalid_token'|'invalid_client'|'invalid_client_metadata'|'rate_limited',readonly status=400){super(code);}
}
export const agentScopes=['host:read','host:write','host:decide','request:read','request:write','request:decide'] as const;
export type AgentScope=typeof agentScopes[number];
export function oauthResource(env=process.env){return applicationOrigin(env)+'/mcp';}
export function requireResource(value:unknown,env=process.env):string{
 const expected=oauthResource(env);if(value!==expected)throw new AgentOAuthError('invalid_target');return expected;
}
export function parseScopes(value:unknown):AgentScope[]{
 if(typeof value!=='string'||value.length>256||!value||!/^\S+(?: \S+)*$/u.test(value))throw new AgentOAuthError('invalid_scope');
 const items=value.split(' ');
 if(new Set(items).size!==items.length||items.some(item=>!agentScopes.includes(item as AgentScope))
  ||items.some(item=>item.startsWith('host:'))&&items.some(item=>item.startsWith('request:')))throw new AgentOAuthError('invalid_scope');
 return items.sort() as AgentScope[];
}
export function validateRedirect(value:unknown):string{
 if(typeof value!=='string'||!value||value.length>2048||!/^https?:\/\//u.test(value)||/[\u0000-\u0020\u007f\\]/u.test(value)||value.includes('#'))throw new AgentOAuthError('invalid_request');
 try{
  const url=new URL(value);
  if(url.protocol==='http:'&&!/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?(?:[/?]|$)/u.test(value))throw Error();
  if(url.username||url.password||!url.hostname||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw Error();
 }catch{throw new AgentOAuthError('invalid_request');}
 return value; // Never normalize away an exact registered-callback mismatch.
}
const pkceVerifier=/^[A-Za-z0-9._~-]{43,128}$/u;
const challenge=/^[A-Za-z0-9_-]{43}$/u;
function validChallenge(value:string){return challenge.test(value)&&Buffer.from(value,'base64url').toString('base64url')===value;}
export function pkceChallenge(verifier:string):string{
 if(!pkceVerifier.test(verifier))throw new AgentOAuthError('invalid_request');
 return createHash('sha256').update(verifier).digest('base64url');
}
export function verifyPkce(verifier:string,expected:string):boolean{
 if(!pkceVerifier.test(verifier)||!validChallenge(expected))return false;
 return timingSafeEqual(Buffer.from(pkceChallenge(verifier)),Buffer.from(expected));
}
/** Raw form/query decoder: URLSearchParams silently repairs malformed escapes. */
export function decodeOAuthForm(raw:string):Record<string,string>{
 if(Buffer.byteLength(raw)>16_384)throw new AgentOAuthError('invalid_request');
 const entries=raw.split('&');if(entries.length>32)throw new AgentOAuthError('invalid_request');
 const output:Record<string,string>=Object.create(null);
 for(const entry of entries){
  if(!entry)continue;const at=entry.indexOf('=');if(at<1)throw new AgentOAuthError('invalid_request');
  let key:string,value:string;
  try{key=decodeURIComponent(entry.slice(0,at).replaceAll('+',' '));value=decodeURIComponent(entry.slice(at+1).replaceAll('+',' '));}catch{throw new AgentOAuthError('invalid_request');}
  if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(key)||Object.hasOwn(output,key)||/[\u0000-\u001f\u007f]/u.test(value))throw new AgentOAuthError('invalid_request');
  output[key]=value;
 }
 return output;
}
const authorization=z.object({client_id:z.uuid(),redirect_uri:z.string(),response_type:z.literal('code'),state:z.string().min(1).max(1024),code_challenge:z.string().refine(validChallenge),code_challenge_method:z.literal('S256')});
const codeRequest=z.object({grant_type:z.literal('authorization_code'),client_id:z.uuid(),code:z.string().regex(/^[A-Za-z0-9_-]{43}$/u),redirect_uri:z.string(),code_verifier:z.string().regex(pkceVerifier)});
const refreshRequest=z.object({grant_type:z.literal('refresh_token'),client_id:z.uuid(),refresh_token:z.string().regex(/^[A-Za-z0-9_-]{43}$/u)});
export function parseAuthorizationQuery(raw:string,env=process.env){
 const form=decodeOAuthForm(raw),resource=requireResource(form.resource,env),scopes=parseScopes(form.scope),parsed=authorization.safeParse(form);
 if(!parsed.success)throw new AgentOAuthError('invalid_request');
 return {...parsed.data,redirect_uri:validateRedirect(parsed.data.redirect_uri),resource,scope:scopes.join(' ')};
}
export function parseTokenBody(raw:string,env=process.env){
 const form=decodeOAuthForm(raw),resource=requireResource(form.resource,env);
 // Public clients do not authenticate by secret; do not silently accept a
 // malformed confidential-client request as an unauthenticated public one.
 if(['client_secret','client_assertion','client_assertion_type'].some(key=>Object.hasOwn(form,key)))throw new AgentOAuthError('invalid_request');
 if(form.grant_type==='authorization_code'){
  const parsed=codeRequest.safeParse(form);if(!parsed.success)throw new AgentOAuthError('invalid_request');
  return {...parsed.data,redirect_uri:validateRedirect(parsed.data.redirect_uri),resource};
 }
 if(form.grant_type==='refresh_token'){
  const parsed=refreshRequest.safeParse(form);if(!parsed.success)throw new AgentOAuthError('invalid_request');
  return {...parsed.data,resource,...(form.scope===undefined?{}:{scope:parseScopes(form.scope).join(' ')})};
 }
 throw new AgentOAuthError('unsupported_grant_type');
}

export function parseRevocationBody(raw:string,env=process.env){
 const form=decodeOAuthForm(raw),resource=requireResource(form.resource,env);
 if(['client_secret','client_assertion','client_assertion_type'].some(key=>Object.hasOwn(form,key)))throw new AgentOAuthError('invalid_request');
 const parsed=z.object({client_id:z.uuid(),token:z.string().min(1).max(8192)}).safeParse(form);
 if(!parsed.success)throw new AgentOAuthError('invalid_request');
 // Hints are optional optimizations. Unknown credentials return the same neutral
 // result; possession of a refresh credential is the only revocation proof.
 return {...parsed.data,resource};
}
