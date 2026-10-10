import {randomUUID} from 'node:crypto';
import {SignJWT,importJWK,jwtVerify,type JWK} from 'jose';
import {z} from 'zod';
import {applicationOrigin,requiredEnv} from '../config.ts';
import {ApplicationError} from '../errors.ts';
import {AgentOAuthError,oauthResource,parseScopes} from './protocol.ts';

const coordinate=z.string().regex(/^[A-Za-z0-9_-]{43}$/u).refine(value=>Buffer.from(value,'base64url').toString('base64url')===value);
const kid=z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u);
const publicKeySchema=z.strictObject({kty:z.literal('EC'),crv:z.literal('P-256'),x:coordinate,y:coordinate,kid,alg:z.literal('ES256').optional(),use:z.literal('sig').optional()});
const privateKeySchema=publicKeySchema.extend({d:coordinate});
const keyHeader=z.strictObject({alg:z.literal('ES256'),typ:z.literal('at+jwt'),kid});
const actorKind=z.enum(['host','guest','intake']);
export const agentTokenGrant=z.strictObject({grantId:z.uuid(),clientId:z.uuid(),actorKind,actorId:z.uuid(),scope:z.string(),grantExpiresAt:z.number().int().positive()});
const grantInput=agentTokenGrant;
export type AgentTokenGrant=z.infer<typeof grantInput>;
const claimsSchema=z.strictObject({iss:z.string(),aud:z.string(),sub:z.uuid(),client_id:z.uuid(),grant_id:z.uuid(),actor_kind:actorKind,scope:z.string(),iat:z.number().int().nonnegative(),exp:z.number().int().positive(),jti:z.uuid()});
export type AgentAccessClaims=Readonly<z.infer<typeof claimsSchema>>;
type KeyMaterial={active:z.infer<typeof privateKeySchema>;publicKeys:z.infer<typeof publicKeySchema>[];signer:CryptoKey|Uint8Array;verifiers:Map<string,CryptoKey|Uint8Array>};
function publicPart(key:z.infer<typeof privateKeySchema>|z.infer<typeof publicKeySchema>){return {kty:key.kty,crv:key.crv,x:key.x,y:key.y,kid:key.kid,alg:'ES256' as const,use:'sig' as const};}
function checkedScope(scope:string,kind:z.infer<typeof actorKind>){
 const parsed=parseScopes(scope),prefix=kind==='host'?'host:':'request:';
 if(parsed.some(s=>!s.startsWith(prefix))||kind==='guest'&&parsed.includes('request:intake'))throw new AgentOAuthError('invalid_scope');
 return parsed.join(' ');
}
/** Cryptographic boundary only. Callers must supply current durable authority;
 * returned claims are not an application Credential and cannot bypass SQL. */
export class AgentOAuthTokens {
 private material?:Promise<KeyMaterial>;
 constructor(private readonly env=process.env,private readonly now=Date.now){}
 private keys():Promise<KeyMaterial>{
  if(!this.material)this.material=this.loadKeys();return this.material;
 }
 private async loadKeys():Promise<KeyMaterial>{
  try{
   const raw=requiredEnv('AGENT_OAUTH_SIGNING_JWK',this.env),retired=this.env.AGENT_OAUTH_RETIRED_JWKS??'[]';
   if(raw.length>4096||retired.length>12288)throw Error();
   const active=privateKeySchema.parse(JSON.parse(raw)),previous=z.array(publicKeySchema).max(3).parse(JSON.parse(retired));
   const publicKeys=[publicPart(active),...previous.map(publicPart)];
   if(new Set(publicKeys.map(k=>k.kid)).size!==publicKeys.length)throw Error();
   const signer=await importJWK(active,'ES256'),verifiers=new Map<string,CryptoKey|Uint8Array>();
   for(const key of publicKeys)verifiers.set(key.kid,await importJWK(key,'ES256'));
   // Import can accept an inconsistent public/private pair; prove it before
   // using the configuration to issue unusable tokens.
   const probe=await new SignJWT({}).setProtectedHeader({alg:'ES256'}).sign(signer);
   await jwtVerify(probe,verifiers.get(active.kid)!,{algorithms:['ES256']});
   return {active,publicKeys,signer,verifiers};
  }catch{throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);}
 }
 async jwks():Promise<{keys:JWK[]}>{const material=await this.keys();return {keys:material.publicKeys.map(k=>({...k}))};}
 async issue(input:AgentTokenGrant,authorize:()=>Promise<void>):Promise<string>{
  const parsed=grantInput.safeParse(input);if(!parsed.success)throw new AgentOAuthError('invalid_grant');
  const grant=parsed.data,scope=checkedScope(grant.scope,grant.actorKind),material=await this.keys();
  await authorize();
  const issued=Math.floor(this.now()/1000),expires=Math.min(issued+300,grant.grantExpiresAt);
  if(expires<=issued)throw new AgentOAuthError('invalid_grant');
  const token=await new SignJWT({client_id:grant.clientId,grant_id:grant.grantId,actor_kind:grant.actorKind,scope})
   .setProtectedHeader({alg:'ES256',typ:'at+jwt',kid:material.active.kid}).setIssuer(applicationOrigin(this.env)).setAudience(oauthResource(this.env))
   .setSubject(grant.actorId).setIssuedAt(issued).setExpirationTime(expires).setJti(randomUUID()).sign(material.signer);
  await authorize();if(Math.floor(this.now()/1000)>=expires)throw new AgentOAuthError('invalid_grant');
  return token;
 }
 async verify(token:string,authorize:(claims:AgentAccessClaims)=>Promise<void>):Promise<AgentAccessClaims>{
  if(token.length>8192||!/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/u.test(token))throw new AgentOAuthError('invalid_token',401);
  const material=await this.keys();let claims:AgentAccessClaims;
  try{
   const result=await jwtVerify(token,header=>{
    const parsed=keyHeader.safeParse(header);if(!parsed.success)throw Error();const key=material.verifiers.get(parsed.data.kid);if(!key)throw Error();return key;
   },{algorithms:['ES256'],typ:'at+jwt',issuer:applicationOrigin(this.env),audience:oauthResource(this.env),currentDate:new Date(this.now()),clockTolerance:0,requiredClaims:['iss','aud','sub','iat','exp','jti','client_id','grant_id','actor_kind','scope']});
   const value=claimsSchema.parse(result.payload),now=Math.floor(this.now()/1000);
   if(value.aud!==oauthResource(this.env)||value.iat>now||value.exp<=now||value.exp<=value.iat||value.exp-value.iat>300||checkedScope(value.scope,value.actor_kind)!==value.scope)throw Error();
   claims=Object.freeze(value);
  }catch{throw new AgentOAuthError('invalid_token',401);}
  await authorize(claims);
  if(claims.exp<=Math.floor(this.now()/1000))throw new AgentOAuthError('invalid_token',401);
  return claims;
 }
}
