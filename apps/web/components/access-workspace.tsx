'use client';
import {cn} from 'cn';
import {RetainedConversationDraft} from './retained-conversation-draft.tsx';
import {hostLoginTarget} from '../lib/host-login-target.ts';
import {RequesterRecoveryCard,type RecoveryProof} from './requester-recovery.tsx';
import {recoveryRedeem,recoveryStart} from '../../../lib/contracts/requester-recovery.ts';
import {BookingReceiptCard} from './booking-receipt.tsx';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {RequestLifecycleCard} from './request-lifecycle.tsx';
import {IMessageEntry} from './imessage-entry.tsx';
import {HostRequestWorkspace} from './host-request-workspace.tsx';
import { ConversationWorkspace } from './conversation-workspace.tsx';
import { hostState, guestState, type HostState, type GuestState } from '../../../lib/contracts/browser.ts';

async function api(path:string,body?:unknown) {
  const response=await fetch('/api/browser/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
  const data=await response.json();
  if(!response.ok)throw Object.assign(new Error(data.error?.message??'Please try again.'),{status:response.status});
  return data;
}
function Frame({children,aside,compact=false}:{children:React.ReactNode;aside?:React.ReactNode;compact?:boolean}) {
  return <main className={cn("workspace",compact&&"workspace-host")}><header className="workspace-header"><a className="wordmark" href="/">Find Me a Time<span aria-hidden="true">↗</span></a>{aside}</header>
    <section className="workspace-content">{children}</section><footer>Your calendar. Your final say.</footer></main>;
}
function ProposalTime({proposal}:{proposal:NonNullable<GuestState['proposal']>}) {
  try {
    const format=new Intl.DateTimeFormat('en',{dateStyle:'medium',timeStyle:'short',timeZone:proposal.timezone});
    return <p>{format.format(new Date(proposal.start))} – {format.format(new Date(proposal.end))}<br/>{proposal.timezone}</p>;
  } catch {return <p>Time details need review before this meeting can continue.</p>;}
}
export function HostWorkspace() {
  const [retainedDraft,setRetainedDraft]=useState('');
  const [host,setHost]=useState<HostState|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[waitlist,setWaitlist]=useState(false);
  const [email,setEmail]=useState(''),[name,setName]=useState(''),[code,setCode]=useState('');
  useEffect(()=>{let active=true;api('host/state').then(data=>{if(active)setHost(hostState.parse(data));}).catch(e=>{if(active&&e.status!==401)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    if(new URLSearchParams(location.search).get('auth')==='expired'){setError('Google sign-in wasn’t completed or has expired. Continue with Google again in this browser.');const url=new URL(location.href);url.searchParams.delete('auth');history.replaceState(null,'',url.pathname+url.search+url.hash);}
    return()=>{active=false;};},[]);
  async function submit(event:FormEvent) {
    event.preventDefault();setBusy(true);setError('');setNotice('');
    try {
      if(host){setHost(hostState.parse(await api('host/redeem',{code,idempotencyKey:crypto.randomUUID()})));setCode('');}
      else if(waitlist){await api('waitlist',{email,name,idempotencyKey:crypto.randomUUID()});setNotice('You’re on the list. We’ll be in touch when an invitation is available.');}
      else {const query=new URLSearchParams(location.search),target=hostLoginTarget.safeParse({requestId:query.get('request'),audience:query.get('audience')??'host_private'});const {url}=await api('auth/start',target.success?{target:target.data}:{});window.location.assign(url);return;}
    }catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}
  }
  async function signOut(){setBusy(true);setError('');try{await api('auth/logout',{});setHost(null);setNotice('You’re signed out.');setCode('');}catch(e){setError(e instanceof Error?e.message:'Sign-out failed. Try again.');}finally{setBusy(false);}}
  return <Frame compact={!!host?.admitted} aside={host?<button className="text-button" onClick={signOut} disabled={busy}>Sign out</button>:<span className="header-note">Host workspace</span>}>
    <IMessageEntry admitted={host?.admitted??false}/>{!host?.admitted?<p className="eyebrow">A little less back and forth</p>:null}
    <h1>{loading?'Getting your place ready.':host?.admitted?'Welcome to your workspace.':host?'Your invitation, please.':waitlist?'Make room for better meetings.':'Let’s find your time.'}</h1>
    {!host?.admitted?<p className="workspace-description">{host?'Enter the invitation code sent to your verified email. Signing in and host access are separate.':waitlist?'Hosting is opening by invitation. Join the list—no calendar connection needed.':'Sign in to set up your scheduling assistant. Every meeting stays subject to your final approval.'}</p>:null}
    {loading?<p role="status">Checking your access…</p>:host?.admitted?<><p className="signed-in">Signed in as <strong>{host.email}</strong></p><HostRequestWorkspace onDraftRetained={setRetainedDraft} onAccessLost={draft=>{if(draft)setRetainedDraft(draft);setHost(null);setError('Your conversation access has ended. Sign in again to check your access.');}}/></>:<form onSubmit={submit} className="access-form">
      {host?<><p className="signed-in">Signed in as <strong>{host.email}</strong></p><label htmlFor="invitation">Invitation code</label><input id="invitation" value={code} onChange={e=>setCode(e.target.value)} autoComplete="off" placeholder="ABCD-EFGH-IJKL-MNOP" maxLength={19} required spellCheck={false}/><p className="field-note">Use the code from your invitation. It stays outside the conversation.</p></>:waitlist?<><label htmlFor="name">Name <span className="optional">(optional)</span></label><input id="name" value={name} onChange={e=>setName(e.target.value)} autoComplete="name" maxLength={200}/><label htmlFor="email">Email address</label><input id="email" type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" maxLength={254} required/><p className="field-note">Use your Google account email for your host invitation.</p></>:<p className="field-note">Use the Google account your invitation was sent to. Calendar access is requested separately.</p>}
      <button className="primary-button" disabled={busy}>{busy?'One moment…':host?'Use invitation':waitlist?'Join the waitlist':'Continue with Google'}<span aria-hidden="true">↗</span></button>
      {!host?<button type="button" className="text-button secondary-choice" disabled={busy} onClick={()=>{setWaitlist(!waitlist);setNotice('');setError('');}}>{waitlist?'Already invited? Sign in':'Not invited yet? Join the waitlist'}</button>:null}
    </form>}
    <RetainedConversationDraft text={retainedDraft} onDiscard={()=>setRetainedDraft('')}/>
    {notice?<p className="notice" role="status">{notice}</p>:null}{error?<p className="error" role="alert">{error}</p>:null}
    {host?.admitted?<p className="privacy-note"><a href="/connect/authorize">Manage agent permissions</a></p>:null}
    {!host&&!loading?<p className="privacy-note">Requesting a meeting? Use your host’s booking link. You don’t need a host account.</p>:null}
  </Frame>;
}
export function BookingWorkspace({requestId}:{requestId:string}) {
  const [retainedDraft,setRetainedDraft]=useState('');
  useEffect(()=>setRetainedDraft(''),[requestId]);
  const [state,setState]=useState<GuestState|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const [recovery,setRecovery]=useState<RecoveryProof|null>(null),[reload,setReload]=useState(0),[recoveryNotice,setRecoveryNotice]=useState('');
  const recoveryOwner=useRef(requestId),pendingRecovery=useRef<RecoveryProof|null>(null),pageHeading=useRef<HTMLHeadingElement>(null);
  const statusHeading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{if(state?.closed)statusHeading.current?.focus();},[state?.closed]);
  const request=useRef<{id:string;task:Promise<unknown>}|null>(null);
  useEffect(()=>{let active=true,sequence=0;
    function load() {
      if(recoveryOwner.current!==requestId){recoveryOwner.current=requestId;pendingRecovery.current=null;setRecovery(null);request.current=null;setRecoveryNotice('');}
      const current=++sequence;
      setLoading(true);setState(null);setError('');
      const fragment=new URLSearchParams(location.hash.slice(1)),token=fragment.get('token'),receiptToken=fragment.get('receipt');
      const hasFragment=Boolean(location.hash),recover=fragment.get('recover');
      if(location.hash)history.replaceState(null,'',location.pathname+location.search);
      if(hasFragment){
       pendingRecovery.current=null;setRecovery(null);setRecoveryNotice('');
       if(recover!==null){
        const [challengeId,proof,...extra]=recover.split('.');const parsed=recoveryRedeem.safeParse({requestId,challengeId,proof});
        if(parsed.success&&!extra.length&&!token&&!receiptToken){pendingRecovery.current={challengeId:parsed.data.challengeId,proof:parsed.data.proof};setRecovery(pendingRecovery.current);}
        else setRecoveryNotice('This recovery link is invalid. Request a new link for an active request.');
       }
      }
      if(pendingRecovery.current){setLoading(false);return;}

      const receiptState=(value:{requestId:string;status:string;closed:boolean})=>({requestId:value.requestId,status:value.status,closed:value.closed,title:null,proposal:null});
      if(token||receiptToken||request.current?.id!==requestId)request.current={id:requestId,task:receiptToken?api('booking-receipt/exchange',{requestId,token:receiptToken}).then(receiptState):token?api('guest/exchange',{requestId,token}):api('guest/state?requestId='+encodeURIComponent(requestId)).catch(()=>api('booking-receipt?audience=guest&requestId='+encodeURIComponent(requestId)).then(receiptState))};
      request.current!.task.then(data=>{if(active&&current===sequence)setState(guestState.parse(data));}).catch(()=>{if(active&&current===sequence){setState(null);setError('Open the private link sent to you to continue. This page address alone does not unlock your meeting.');}}).finally(()=>{if(active&&current===sequence)setLoading(false);});
    }
    load();addEventListener('hashchange',load);
    return()=>{active=false;removeEventListener('hashchange',load);};
  },[requestId,reload]);
  const finishRecovery=(message:string)=>{if(recoveryOwner.current!==requestId)return;pendingRecovery.current=null;setRecovery(null);request.current=null;setRecoveryNotice(message);setReload(value=>value+1);pageHeading.current?.focus();};
  return <Frame aside={<span className="header-note">Your meeting</span>}>{state&&!state.closed?<p className="privacy-note"><a href={'/connect/authorize?requestId='+requestId}>Manage agent permissions</a></p>:null}<p className="eyebrow">One meeting at a time</p><h1 ref={pageHeading} tabIndex={-1}>{loading?'Finding your conversation.':recovery?'Restore your request.':error?'This link is private.':state?.status==='booked'?'A time to connect.':'Your meeting, in progress.'}</h1>
    {loading?<p role="status">Checking your private access…</p>:null}{error?<p className="workspace-description" role="alert">{error}</p>:null}
    <RetainedConversationDraft text={retainedDraft} onDiscard={()=>setRetainedDraft('')}/>
    {recoveryNotice?<p role="status">{recoveryNotice}</p>:null}
    {(recovery||(!loading&&!state&&recoveryStart.shape.requestId.safeParse(requestId).success))?<RequesterRecoveryCard key={requestId+':'+(recovery?.challengeId??'entry')} requestId={requestId} proof={recovery} onRecovered={()=>finishRecovery('Request access restored.')} onDiscard={message=>finishRecovery(message??'Recovery cancelled.')}/>:null}
    {state&&state.status!=='booked'?<div className="access-card"><div><h2 ref={statusHeading} tabIndex={-1}>{state.title||'Meeting status'}</h2><p className="status-label">{state.status.replaceAll('_',' ')}</p>{state.proposal?<><ProposalTime proposal={state.proposal}/>{state.proposal.location?<p>{state.proposal.location}</p>:null}</>:null}<p>{state.closed?'This request is closed. Conversation history and changes are no longer available.':state.status==='booking'?'Your proposal is saved. Check booking status below.':'Your saved request is protected. Use the conversation below to discuss the details.'}</p></div></div>:null}
    {state&&['booking','booked'].includes(state.status)?<BookingReceiptCard key={requestId+'receipt'} requestId={requestId} audience="guest" onStatus={next=>setState(previous=>previous?.requestId===next.requestId?{...previous,status:next.status,closed:next.closed}:previous)}/>:null}
    {state&&!state.closed?<RequestLifecycleCard key={requestId+'closure'} requestId={requestId} audience="guest" onStatus={next=>{setState(previous=>previous&&previous.requestId===next.requestId?{...previous,status:next.status,closed:next.closed,...(next.closed?{title:null,proposal:null}:{})}:previous);if(next.closed)void api('guest/state?requestId='+encodeURIComponent(requestId)).then(data=>{const receipt=guestState.parse(data);if(receipt.closed)setState(previous=>previous?.requestId===requestId?receipt:previous);}).catch(()=>{});}}/>:null}
    {state&&!state.closed&&state.status!=='booking'?<ConversationWorkspace key={requestId} target={{audience:'request_shared',requestId,guest:true}} onRequestChanged={()=>{void api('guest/state?requestId='+encodeURIComponent(requestId)).then(data=>{const next=guestState.parse(data);setState(previous=>previous&&!previous.closed&&previous.requestId===requestId?next:previous);}).catch(()=>setError('Could not refresh your meeting status. Reload to check the current details.'));}} onAccessLost={draft=>{if(draft)setRetainedDraft(draft);setState(null);void api('guest/state?requestId='+encodeURIComponent(requestId)).then(data=>{const next=guestState.parse(data);if(next.closed)setState(next);else setError('Your conversation access has ended. Open a current private link to continue.');}).catch(()=>setError('Your conversation access has ended. Open a current private link to continue.'));}}/>:null}
  </Frame>;
}
