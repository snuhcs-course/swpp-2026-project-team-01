import {createHash} from 'node:crypto';
import {OAuth2Client,CodeChallengeMethod} from 'google-auth-library';
import {z} from 'zod';
import {requiredEnv} from '../config.ts';
import {googleCallback} from '../calendar/google.ts';
import {ApplicationError} from '../errors.ts';

const opaque=z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const claims=z.object({
 sub:z.string().min(1).max(300),email:z.email().max(254),email_verified:z.literal(true),
 nonce:opaque,exp:z.number().int().positive(),name:z.string().trim().max(200).optional(),
 hd:z.string().min(1).max(253).optional(),
});
export type RequesterGoogleIdentity={subject:string;email:string;name:string|null;contactVerified:boolean};
export interface RequesterIdentityProvider {
 authorization(state:string,verifier:string,nonce:string):string;
 exchange(code:string,verifier:string,nonce:string):Promise<RequesterGoogleIdentity>;
}

// This adapter returns identity claims only. It never creates an Auth session,
// retains provider credentials, or reads Calendar. The caller owns single-use
// browser/request binding and must recheck authority before saving the result.
export class GoogleRequesterIdentity implements RequesterIdentityProvider {
 private readonly client:OAuth2Client;
 private readonly clientId:string;
 constructor(private readonly env=process.env,client?:OAuth2Client){
  this.clientId=requiredEnv('GOOGLE_CLIENT_ID',env);
  this.client=client??new OAuth2Client({clientId:this.clientId,clientSecret:requiredEnv('GOOGLE_CLIENT_SECRET',env),redirectUri:googleCallback(env),transporterOptions:{timeout:10_000,retry:false}});
  // The SDK supplies per-call RETRY_CONFIG, overriding transporter defaults.
  // Apply the one-attempt policy after options are merged, including cert reads.
  this.client.transporter.interceptors.request.add({resolved:async options=>{
   options.retry=false;options.retryConfig={retry:0};options.timeout=10_000;
   options.signal=AbortSignal.timeout(10_000);options.redirect='error';return options;
  }});
 }
 authorization(state:string,verifier:string,nonce:string){
  opaque.parse(state);opaque.parse(verifier);opaque.parse(nonce);
  const url=new URL(this.client.generateAuthUrl({access_type:'online',prompt:'select_account',include_granted_scopes:false,
   scope:['openid','email','profile'],state,code_challenge_method:CodeChallengeMethod.S256,
   code_challenge:createHash('sha256').update(verifier).digest('base64url')}));
  url.searchParams.set('nonce',nonce);return url.href;
 }
 async exchange(code:string,verifier:string,nonce:string):Promise<RequesterGoogleIdentity>{
  try{
   opaque.parse(verifier);opaque.parse(nonce);
   const {tokens}=await this.client.getToken({code:z.string().min(1).max(4096).parse(code),codeVerifier:verifier,redirect_uri:googleCallback(this.env)});
   const idToken=z.string().min(1).max(16_384).parse(tokens.id_token);
   // The SDK checks signature, issuer, audience and token time bounds. Enforce
   // current expiry too: its clock-skew tolerance must not extend our proof.
   const ticket=await this.client.verifyIdToken({idToken,audience:this.clientId});
   const identity=claims.parse(ticket.getPayload());
   if(identity.nonce!==nonce||identity.exp*1000<=Date.now())throw new Error();
   const email=identity.email.toLowerCase();
   // A third-party address can outlive its original Google-account ownership.
   // Prefill it, but require our contact-code flow before trusting that address.
   return {subject:identity.sub,email,name:identity.name||null,
    contactVerified:email.endsWith('@gmail.com')||identity.hd!==undefined};
  }catch{throw new ApplicationError('OAUTH_STATE_INVALID',400);}
 }
}
