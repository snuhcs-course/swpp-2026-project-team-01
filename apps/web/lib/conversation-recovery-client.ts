import {conversationRecoveryInput,conversationRecoveryStatus,type ConversationRecoveryInput,type ConversationRecoveryStatus} from '../../../lib/contracts/conversation-recovery.ts';
import {conversationJson} from './conversation-transport.ts';

type Storage=Pick<globalThis.Storage,'getItem'|'setItem'|'removeItem'>;
export type RecoveryView={status:ConversationRecoveryStatus|null;retry:boolean;busy:boolean;error:string};
type Transport=(path:string,signal:AbortSignal,body?:unknown)=>Promise<unknown>;
export const recoveryStorageKey=(scope:string)=>'fmat:conversation-recovery:v1:'+scope;

/** Stored intent is not authority. Every read and action still uses current
 * HttpOnly credentials. Never persist transcript, draft, grant or runtime IDs. */
export class ConversationRecoveryClient {
 private intent:ConversationRecoveryInput|null=null;
 private view:RecoveryView={status:null,retry:false,busy:false,error:''};
 private readonly lifetime=new AbortController();
 constructor(private readonly scope:string,private readonly query:string,private readonly storage:()=>Storage,
  private readonly changed:(view:RecoveryView)=>void,private readonly denied:()=>void,
  private readonly transport:Transport=conversationJson){
  try{
   const raw=storage().getItem(recoveryStorageKey(scope));
   if(raw&&raw.length<=256){const parsed=conversationRecoveryInput.safeParse(JSON.parse(raw));if(parsed.success)this.intent=parsed.data;}
  }catch{/* Storage can be unavailable; in-memory exact retries still work. */}
  this.view.retry=!!this.intent;
 }
 private publish(patch:Partial<RecoveryView>){if(this.lifetime.signal.aborted)return;this.view={...this.view,...patch,retry:!!this.intent};this.changed(this.view);}
 private save(intent:ConversationRecoveryInput|null){
  this.intent=intent;
  try{if(intent)this.storage().setItem(recoveryStorageKey(this.scope),JSON.stringify(intent));else this.storage().removeItem(recoveryStorageKey(this.scope));}catch{}
 }
 private accept(value:unknown){
  const status=conversationRecoveryStatus.parse(value);
  if(status.conversationId!==this.scope)throw new Error('Unexpected conversation');
  if(this.view.status&&status.generation<this.view.status.generation)throw new Error('Outdated recovery status');
  // A current authoritative successor resolves a lost acknowledgment. A later
  // failure requires a separate explicit action with its newly observed version.
  if(this.intent&&status.generation>this.intent.expectedGeneration)this.save(null);
  this.publish({status,error:''});
 }
 async inspect(){return this.request(false);}
 async recover(){return this.request(true);}
 private async request(recover:boolean){
  if(this.lifetime.signal.aborted||this.view.busy)return;
  if(recover&&!this.intent){
   if(this.view.status?.state!=='recovery_required')return;
   const input=conversationRecoveryInput.safeParse({expectedGeneration:this.view.status.generation,idempotencyKey:crypto.randomUUID()});
   if(!input.success){this.publish({error:'Recovery is unavailable for this conversation. Your saved discussion and meeting controls remain available.'});return;}
   this.save(input.data);
  }
  this.publish({busy:true,error:''});
  try{
   const data=await this.transport('/api/browser/conversations/'+this.scope+'/recovery'+this.query,this.lifetime.signal,recover?this.intent:undefined);
   if(this.lifetime.signal.aborted)return;
   this.accept(data);
   // A successful no-transition response proves this attempt did not recover.
   // Keep an uncertain intent only when a request actually failed.
   if(recover){this.save(null);this.publish({});}
  }catch(cause){
   if(this.lifetime.signal.aborted)return;
   const status=(cause as {status?:number})?.status;
   if([401,403,404].includes(status??0)){this.save(null);this.stop();this.denied();return;}
   this.publish({error:recover?'Recovery could not be confirmed. Check status or retry the same recovery.':'Recovery status is unavailable. Your saved discussion and meeting controls are still available.'});
  }finally{this.publish({busy:false});}
 }
 stop(){this.lifetime.abort();}
}
