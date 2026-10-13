import {applicationOrigin} from '../config.ts';
import {ApplicationError,publicError} from '../errors.ts';
import {type HistorySession} from '../identity/runtime-history.ts';
import {AgentCredentials} from './credentials.ts';
import {AgentConversations} from './conversations.ts';
import {agentHistory} from './history.ts';
import {oauthJson,readOAuthBody} from './http.ts';
import {AgentOAuthError} from './protocol.ts';
export function agentHistoryHttp(env=process.env,credentials=new AgentCredentials(env),access=new AgentConversations()){
 return async(request:Request,attach:(id:string)=>HistorySession)=>{
  try{
   if(request.method!=='POST')return oauthJson({error:'method_not_allowed'},405);
   if(new URL(request.url).search)throw new ApplicationError('INVALID_INPUT',400);
   const origin=request.headers.get('origin');if(origin!==null&&origin!==applicationOrigin(env))throw new ApplicationError('FORBIDDEN',403);
   const auth=request.headers.get('authorization')??'';
   if(auth.length>8192||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(auth))throw new AgentOAuthError('invalid_token',401);
   const credential=await credentials.verify(auth.slice(7));
   let input:unknown;try{input=JSON.parse(await readOAuthBody(request,'json'));}catch(e){if(e instanceof AgentOAuthError)throw e;throw new ApplicationError('INVALID_INPUT',400);}
   return oauthJson(await agentHistory(credential,input,attach,request.signal,access,env));
  }catch(error){
   if(error instanceof AgentOAuthError)return oauthJson({error:error.code},error.status);
   const safe=publicError(error);return oauthJson(safe.body,safe.status);
  }
 };
}
