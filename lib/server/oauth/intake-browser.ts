import {z} from 'zod';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {AgentOAuthError,oauthResource} from './protocol.ts';
import {oauthSecretHash} from './service.ts';
import {agentIntakeProof} from './intake-proof.ts';
import {agentIntakeBrowserView} from '../../contracts/agent-oauth.ts';
const privateState=agentIntakeBrowserView.extend({intakeId:z.uuid(),tokenExpiresAt:z.iso.datetime({offset:true}).nullable()})
 .refine(v=>v.state==='pending'?v.requestId===null&&v.tokenExpiresAt===null:v.requestId!==null&&v.tokenExpiresAt!==null);

/** Server-only browser adapter. The proof returned by claim must go straight
 * into an HttpOnly cookie; never serialize it as a browser or tool result. */
export class AgentIntakeBrowser {
 constructor(private readonly database:Pick<Database,'rpc'>=new Database(),private readonly env=process.env,private readonly now=Date.now){}
 private async read(id:string,secret:string,proof:string|null=null){
  if(!z.uuid().safeParse(id).success||!/^[A-Za-z0-9_-]{43}$/u.test(secret))throw new AgentOAuthError('invalid_request');
  const raw=await this.database.rpc('fmat_oauth_intake_handoff',{
   p_id:id,p_browser_hash:oauthSecretHash(secret),p_resource:oauthResource(this.env),p_proof_hash:proof===null?null:oauthSecretHash(proof),
  });
  if(raw&&typeof raw==='object'&&'error'in raw)throw new AgentOAuthError('invalid_grant');
  const parsed=privateState.safeParse(raw);if(!parsed.success)throw new ApplicationError('PROVIDER_UNAVAILABLE',503);
  if(Date.parse(parsed.data.expiresAt)<=this.now())throw new AgentOAuthError('invalid_grant');
  return parsed.data;
 }
 async state(id:string,secret:string){
  const {intakeId:_,tokenExpiresAt:__,...view}=await this.read(id,secret);return agentIntakeBrowserView.parse(view);
 }
 async claim(id:string,secret:string){
  const before=await this.read(id,secret);
  if(before.state!=='bound'||!before.requestId||!before.tokenExpiresAt)throw new AgentOAuthError('invalid_grant');
  const proof=agentIntakeProof(before.intakeId,before.requestId,this.env);
  const after=await this.read(id,secret,proof);
  if(after.intakeId!==before.intakeId||after.requestId!==before.requestId||after.state!=='bound'||after.tokenExpiresAt!==before.tokenExpiresAt)
   throw new AgentOAuthError('invalid_grant');
  return {requestId:before.requestId,proof,tokenExpiresAt:before.tokenExpiresAt};
 }
}
