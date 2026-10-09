import {z} from 'zod';
import {agentHistoryInput} from '../../contracts/agent-history.ts';
import {TokenCipher} from '../calendar/encryption.ts';
import {ApplicationError} from '../errors.ts';
import type {HistorySession} from '../identity/runtime-history.ts';
import {legacyHistoryPosition,readGenerationHistory} from '../identity/generation-history.ts';
import {AgentConversations} from './conversations.ts';
import {requireAgentCredential,type AgentCredential} from './credentials.ts';
import {AgentOAuthError} from './protocol.ts';
const integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const legacyCursor=z.strictObject({conversationId:z.uuid(),sessionId:z.string(),position:integer,expiresAt:integer});
const logicalCursor=z.strictObject({version:z.literal(2),conversationId:z.uuid(),position:integer,expiresAt:integer,
 anchor:z.strictObject({generation:integer,sessionId:z.string().min(1).max(200).nullable()})});
const cursorData=z.union([logicalCursor,legacyCursor]);
export async function agentHistory(credential:AgentCredential,input:unknown,attach:(id:string)=>HistorySession,signal:AbortSignal,
 access:Pick<AgentConversations,'history'>=new AgentConversations(),env=process.env,now=Date.now){
 requireAgentCredential(credential,now());
 const parsed=agentHistoryInput.safeParse(input);if(!parsed.success)throw new ApplicationError('INVALID_INPUT',400);
 const {target,cursor}=parsed.data;
 const binding=await access.history(credential,target);
 const context='agent-history:'+JSON.stringify([credential.claims.aud,credential.claims.grant_id,target]);
 const cipher=new TokenCipher(env);let position=0;
 if(cursor){
  let saved:z.infer<typeof cursorData>;
  try{saved=cursorData.parse(cipher.open(cursor,context));}catch{throw new ApplicationError('INVALID_INPUT',400);}
  if(!binding||saved.expiresAt<=now()||saved.conversationId!==binding.conversationId)throw new ApplicationError('INVALID_INPUT',400);
  if('version'in saved){
   const anchor=binding.generations[saved.anchor.generation];
   if(!anchor||(saved.anchor.sessionId!==null&&anchor.sessionId!==saved.anchor.sessionId))throw new ApplicationError('INVALID_INPUT',400);
   position=saved.position;
  }else position=legacyHistoryPosition(binding,saved.sessionId,saved.position);
 }
 let authorityFailure:AgentOAuthError|undefined;
 const check=async()=>{
  try{
   requireAgentCredential(credential,now());const current=await access.history(credential,target);
   if(!current||!binding||current.conversationId!==binding.conversationId)throw new ApplicationError('RECONNECT_REQUIRED',409);
   return current;
  }catch(error){
   // The generic reader sanitizes unknown provider exceptions. Preserve only
   // the application's typed OAuth denial from this authority callback.
   if(error instanceof AgentOAuthError)authorityFailure=error;
   throw error;
  }
 };
 if(!binding){
  requireAgentCredential(credential,now());
  if(await access.history(credential,target)!==null)throw new ApplicationError('RECONNECT_REQUIRED',409);
  return {events:[],nextCursor:null,hasMore:false};
 }
 const page=await readGenerationHistory(binding,attach,check,position,signal).catch(error=>{throw authorityFailure??error;});
 const current=binding.generations.at(-1)!;
 return {events:page.events,nextCursor:cipher.seal({version:2,conversationId:binding.conversationId,
  anchor:{generation:current.generation,sessionId:current.sessionId},position:page.nextCursor,expiresAt:now()+15*60_000},context),hasMore:page.hasMore};
}
