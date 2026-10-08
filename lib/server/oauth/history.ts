import {z} from 'zod';
import {agentHistoryInput} from '../../contracts/agent-history.ts';
import {TokenCipher} from '../calendar/encryption.ts';
import {ApplicationError} from '../errors.ts';
import {readRuntimeHistory,type HistorySession} from '../identity/runtime-history.ts';
import {AgentConversations} from './conversations.ts';
import {requireAgentCredential,type AgentCredential} from './credentials.ts';
const cursorData=z.strictObject({conversationId:z.uuid(),sessionId:z.string(),position:z.number().int().nonnegative(),expiresAt:z.number().int()});
export async function agentHistory(credential:AgentCredential,input:unknown,attach:(id:string)=>HistorySession,signal:AbortSignal,
 access:Pick<AgentConversations,'resolve'>=new AgentConversations(),env=process.env,now=Date.now){
 requireAgentCredential(credential,now());
 const parsed=agentHistoryInput.safeParse(input);if(!parsed.success)throw new ApplicationError('INVALID_INPUT',400);
 const {target,cursor}=parsed.data;
 const binding=await access.resolve(credential,target);
 const context='agent-history:'+JSON.stringify([credential.claims.aud,credential.claims.grant_id,target]);
 const cipher=new TokenCipher(env);let position=0;
 if(cursor){
  let saved:z.infer<typeof cursorData>;
  try{saved=cursorData.parse(cipher.open(cursor,context));}catch{throw new ApplicationError('INVALID_INPUT',400);}
  if(saved.expiresAt<=now()||saved.conversationId!==binding.conversationId||saved.sessionId!==binding.sessionId)throw new ApplicationError('INVALID_INPUT',400);
  position=saved.position;
 }
 const check=async()=>{
  requireAgentCredential(credential,now());const current=await access.resolve(credential,target);
  if(current.conversationId!==binding.conversationId||current.sessionId!==binding.sessionId)throw new ApplicationError('RECONNECT_REQUIRED',409);
 };
 if(!binding.sessionId){await check();return {events:[],nextCursor:null,hasMore:false};}
 const page=await readRuntimeHistory(attach(binding.sessionId),check,position,signal);
 return {events:page.events,nextCursor:cipher.seal({...binding,position:page.nextCursor,expiresAt:now()+15*60_000},context),hasMore:page.hasMore};
}
