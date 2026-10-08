import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {emailLinkTarget,emailLinkStart,emailLinkRevoke,emailLinkState} from '../../contracts/requester-email.ts';
import {Database} from '../database/client.ts';
import {requireCredential,type Credential} from '../identity/credentials.ts';
import {TokenCipher} from '../calendar/encryption.ts';
import {ApplicationError} from '../errors.ts';
import {AgentMailMessages} from './messages.ts';
import {agentMailRawMessage} from './raw-message.ts';
import {verifyAgentMailAuthor} from './author.ts';
const privateState=emailLinkState.omit({linkingText:true}).extend({encryptedProof:z.string().nullable()});
const receiptSchema=z.strictObject({inboxId:z.string(),messageId:z.string(),threadId:z.string(),occurredAt:z.string()});
const proofSchema=z.strictObject({token:z.string().regex(/^[A-Za-z0-9_-]{43}$/u)});
const authorization=z.strictObject({requestId:z.uuid(),linkId:z.uuid(),receiptId:z.uuid()});
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export class RequesterEmailLinking{
 constructor(private readonly db=new Database(),private readonly env:NodeJS.ProcessEnv=process.env,private readonly providers={messages:new AgentMailMessages(env),raw:(input:{inboxId:string;messageId:string})=>agentMailRawMessage(input,{env}),author:verifyAgentMailAuthor}){}
 private config(){return {p_inbox_id:this.env.AGENTMAIL_INBOX_ID??null,p_receiver_id:z.uuid().safeParse(this.env.AGENTMAIL_RECEIVER_ID).success?this.env.AGENTMAIL_RECEIVER_ID!:null};}
 private guest(value:Credential){requireCredential(value);if(value.kind!=='guest')throw new ApplicationError('FORBIDDEN',403);return value;}
 private view(value:unknown){
  const {encryptedProof,...state}=privateState.parse(value);let linkingText:string|null=null;
  if(state.status==='pending'&&encryptedProof&&state.linkId){const proof=proofSchema.parse(new TokenCipher(this.env).open(encryptedProof,`requester-email-link:${state.requestId}:${state.linkId}`));linkingText=`FMAT-LINK ${state.linkId}.${proof.token}`;}
  return emailLinkState.parse({...state,linkingText});
 }
 async read(credential:Credential,input:unknown){return this.view(await this.db.rpc('fmat_requester_email_link',{p_operation:'read',p_credential:this.guest(credential),...this.config(),p_input:emailLinkTarget.parse(input)}));}
 async start(credential:Credential,input:unknown){
  this.guest(credential);const parsed=emailLinkStart.parse(input),config=this.config();
  if(!config.p_receiver_id||!z.email().safeParse(config.p_inbox_id).success)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  const linkId=randomUUID(),token=randomBytes(32).toString('base64url'),encryptedProof=new TokenCipher(this.env).seal({token},`requester-email-link:${parsed.requestId}:${linkId}`);
  return this.view(await this.db.rpc('fmat_requester_email_link',{p_operation:'start',p_credential:credential,...config,p_input:{...parsed,linkId,proofHash:hash(token),encryptedProof}}));
 }
 async revoke(credential:Credential,input:unknown){return this.view(await this.db.rpc('fmat_requester_email_link',{p_operation:'revoke',p_credential:this.guest(credential),p_receiver_id:null,p_inbox_id:null,p_input:emailLinkRevoke.parse(input)}));}
 private async evidence(receiptId:string){
  z.uuid().parse(receiptId);const config=this.config();
  const receipt=receiptSchema.parse(await this.db.rpc('fmat_requester_email_receipt',{p_operation:'read',...config,p_input:{receiptId}}));
  const message=await this.providers.messages.get(receipt),raw=await this.providers.raw(receipt);
  const author=await this.providers.author(raw,{senderClaim:message.senderClaim,messageId:receipt.messageId});
  if(message.content.status!=='available')throw new ApplicationError('INVALID_INPUT',400);
  return {config,text:message.content.text,proof:{receiptId,authorEmail:author.sender,rawHash:author.rawHash,signatureId:author.signatureId}};
 }
 async bind(receiptId:string){
  const {config,text,proof}=await this.evidence(receiptId);
  const command=/^FMAT-LINK ([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/u.exec(text.trim());
  if(!command||!z.uuid().safeParse(command[1]).success)throw new ApplicationError('INVALID_INPUT',400);
  return z.strictObject({status:z.literal('linked'),linkId:z.uuid()}).parse(await this.db.rpc('fmat_requester_email_receipt',{p_operation:'bind',...config,p_input:{...proof,linkId:command[1],proofHash:hash(command[2])}}));
 }
 /** Trusted worker only. References are not guest credentials; downstream commands must recheck the link. */
 async authorize(receiptId:string){
  const {config,text,proof}=await this.evidence(receiptId);
  if(/FMAT-LINK\s+[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}/iu.test(text))throw new ApplicationError('INVALID_INPUT',400);
  const current=authorization.parse(await this.db.rpc('fmat_requester_email_receipt',{p_operation:'authorize',...config,p_input:proof}));
  return {...current,text};
 }
}
