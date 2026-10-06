import {OAuth2Client,CodeChallengeMethod} from 'google-auth-library';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {applicationOrigin,requiredEnv} from '../config.ts';
import {ApplicationError} from '../errors.ts';

export const calendarScopes={host:['openid','email','https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar.events'],guest:['openid','email','https://www.googleapis.com/auth/calendar.freebusy']} as const;
export const tokenBundle=z.object({accessToken:z.string().min(1),refreshToken:z.string().min(1),expiresAt:z.number().finite().positive(),subject:z.string().min(1).max(300),scopes:z.array(z.string())});
export type TokenBundle=z.infer<typeof tokenBundle>;
export interface GoogleConsent {
  authorization(kind:'host'|'guest',state:string,verifier:string,nonce:string):string;
  exchange(code:string,verifier:string,nonce:string,kind:'host'|'guest'):Promise<TokenBundle>;
}
export function googleCallback(env=process.env){return applicationOrigin(env)+'/connections/google/callback';}
export class GoogleOAuth implements GoogleConsent {
  private readonly client:OAuth2Client;
  private readonly clientId:string;
  constructor(private readonly env=process.env){
    this.clientId=requiredEnv('GOOGLE_CLIENT_ID',env);
    this.client=new OAuth2Client({clientId:this.clientId,clientSecret:requiredEnv('GOOGLE_CLIENT_SECRET',env),redirectUri:googleCallback(env),transporterOptions:{timeout:10_000,retry:false}});
  }
  authorization(kind:'host'|'guest',state:string,verifier:string,nonce:string){
    const url=new URL(this.client.generateAuthUrl({access_type:'offline',prompt:'consent',include_granted_scopes:false,scope:[...calendarScopes[kind]],state,code_challenge_method:CodeChallengeMethod.S256,code_challenge:createHash('sha256').update(verifier).digest('base64url')}));
    url.searchParams.set('nonce',nonce);return url.href;
  }
  async exchange(code:string,verifier:string,nonce:string,kind:'host'|'guest'):Promise<TokenBundle>{
    try{
      const {tokens}=await this.client.getToken({code,codeVerifier:verifier,redirect_uri:googleCallback(this.env)});
      if(!tokens.id_token)throw new Error();
      const ticket=await this.client.verifyIdToken({idToken:tokens.id_token,audience:this.clientId});
      const identity=z.object({sub:z.string().min(1).max(300),email:z.email(),email_verified:z.literal(true),nonce:z.literal(nonce)}).parse(ticket.getPayload());
      const scopes=(tokens.scope??'').split(' ').filter(Boolean);
      const bundle=tokenBundle.parse({accessToken:tokens.access_token,refreshToken:tokens.refresh_token,expiresAt:tokens.expiry_date,subject:identity.sub,scopes});
      if(bundle.expiresAt<=Date.now()||calendarScopes[kind].filter(s=>s.startsWith('https:')).some(s=>!scopes.includes(s)))throw new Error();
      if(kind==='guest'&&scopes.some(s=>![...calendarScopes.guest,'https://www.googleapis.com/auth/userinfo.email'].includes(s)))throw new Error();
      return bundle;
    }catch{throw new ApplicationError('RECONNECT_REQUIRED',409);}
  }
}
