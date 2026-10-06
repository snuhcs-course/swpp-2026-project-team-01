'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { hostState, guestState, type HostState, type GuestState } from '../../../lib/contracts/browser.ts';

async function api(path:string,body?:unknown) {
  const response=await fetch('/api/browser/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
  const data=await response.json();
  if(!response.ok)throw Object.assign(new Error(data.error?.message??'Please try again.'),{status:response.status});
  return data;
}
function Frame({children,aside}:{children:React.ReactNode;aside?:React.ReactNode}) {
  return <main className="workspace"><header className="workspace-header"><a className="wordmark" href="/">Find Me a Time<span aria-hidden="true">↗</span></a>{aside}</header>
    <section className="workspace-content">{children}</section><footer>Your calendar. Your final say.</footer></main>;
}
function ProposalTime({proposal}:{proposal:NonNullable<GuestState['proposal']>}) {
  try {
    const format=new Intl.DateTimeFormat('en',{dateStyle:'medium',timeStyle:'short',timeZone:proposal.timezone});
    return <p>{format.format(new Date(proposal.start))} – {format.format(new Date(proposal.end))}<br/>{proposal.timezone}</p>;
  } catch {return <p>Time details need review before this meeting can continue.</p>;}
}
export function HostWorkspace() {
  const [host,setHost]=useState<HostState|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[waitlist,setWaitlist]=useState(false);
  const [email,setEmail]=useState(''),[name,setName]=useState(''),[code,setCode]=useState('');
  useEffect(()=>{let active=true;api('host/state').then(data=>{if(active)setHost(hostState.parse(data));}).catch(e=>{if(active&&e.status!==401)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    if(new URLSearchParams(location.search).get('auth')==='expired'){setError('That sign-in link has expired or belongs to another browser. Request a fresh link here.');history.replaceState(null,'','/app');}
    return()=>{active=false;};},[]);
  async function submit(event:FormEvent) {
    event.preventDefault();setBusy(true);setError('');setNotice('');
    try {
      if(host){setHost(hostState.parse(await api('host/redeem',{code,idempotencyKey:crypto.randomUUID()})));setCode('');}
      else if(waitlist){await api('waitlist',{email,name,idempotencyKey:crypto.randomUUID()});setNotice('You’re on the list. We’ll be in touch when an invitation is available.');}
      else {await api('auth/start',{email});setNotice('Check your email. Open the sign-in link in this browser to continue.');}
    }catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}
  }
  async function signOut(){setBusy(true);setError('');try{await api('auth/logout',{});setHost(null);setNotice('You’re signed out.');setCode('');}catch(e){setError(e instanceof Error?e.message:'Sign-out failed. Try again.');}finally{setBusy(false);}}
  return <Frame aside={host?<button className="text-button" onClick={signOut} disabled={busy}>Sign out</button>:<span className="header-note">Host workspace</span>}>
    <p className="eyebrow">A little less back and forth</p>
    <h1>{loading?'Getting your place ready.':host?.admitted?'Welcome to your workspace.':host?'Your invitation, please.':waitlist?'Make room for better meetings.':'Let’s find your time.'}</h1>
    <p className="workspace-description">{host?.admitted?'Your host access is active. Your calendar, preferences and final approval will guide each meeting.':host?'Enter the invitation code sent to your verified email. Signing in and host access are separate.':waitlist?'Hosting is opening by invitation. Join the list—no calendar connection needed.':'Sign in to set up your scheduling assistant. Every meeting stays subject to your final approval.'}</p>
    {loading?<p role="status">Checking your access…</p>:host?.admitted?<div className="access-card"><span className="status-dot" aria-hidden="true"/><div><h2>Host access confirmed</h2><p>{host.email}</p><p>Calendar connection and the guided setup conversation are being prepared. Your booking link will appear after setup is complete.</p></div></div>:<form onSubmit={submit} className="access-form">
      {host?<><p className="signed-in">Signed in as <strong>{host.email}</strong></p><label htmlFor="invitation">Invitation code</label><input id="invitation" value={code} onChange={e=>setCode(e.target.value)} autoComplete="off" placeholder="ABCD-EFGH-IJKL-MNOP" maxLength={19} required spellCheck={false}/><p className="field-note">Use the code from your invitation. It stays outside the conversation.</p></>:<>{waitlist?<><label htmlFor="name">Name <span className="optional">(optional)</span></label><input id="name" value={name} onChange={e=>setName(e.target.value)} autoComplete="name" maxLength={200}/></>:null}<label htmlFor="email">Email address</label><input id="email" type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" maxLength={254} required/><p className="field-note">{waitlist?'We’ll use this address for your host invitation.':'Use the email address your invitation was sent to.'}</p></>}
      <button className="primary-button" disabled={busy}>{busy?'One moment…':host?'Use invitation':waitlist?'Join the waitlist':'Email me a sign-in link'}<span aria-hidden="true">↗</span></button>
      {!host?<button type="button" className="text-button secondary-choice" disabled={busy} onClick={()=>{setWaitlist(!waitlist);setNotice('');setError('');}}>{waitlist?'Already invited? Sign in':'Not invited yet? Join the waitlist'}</button>:null}
    </form>}
    {notice?<p className="notice" role="status">{notice}</p>:null}{error?<p className="error" role="alert">{error}</p>:null}
    {!host&&!loading?<p className="privacy-note">Requesting a meeting? Use your host’s booking link. You don’t need a host account.</p>:null}
  </Frame>;
}
export function BookingWorkspace({requestId}:{requestId:string}) {
  const [state,setState]=useState<GuestState|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const request=useRef<{id:string;task:Promise<unknown>}|null>(null);
  useEffect(()=>{let active=true,sequence=0;
    function load() {
      const current=++sequence;
      setLoading(true);setState(null);setError('');
      const fragment=new URLSearchParams(location.hash.slice(1)),token=fragment.get('token');
      if(location.hash)history.replaceState(null,'',location.pathname+location.search);
      if(token||request.current?.id!==requestId)request.current={id:requestId,task:token?api('guest/exchange',{requestId,token}):api('guest/state?requestId='+encodeURIComponent(requestId))};
      request.current!.task.then(data=>{if(active&&current===sequence)setState(guestState.parse(data));}).catch(()=>{if(active&&current===sequence){setState(null);setError('Open the private link sent to you to continue. This page address alone does not unlock your meeting.');}}).finally(()=>{if(active&&current===sequence)setLoading(false);});
    }
    load();addEventListener('hashchange',load);
    return()=>{active=false;removeEventListener('hashchange',load);};
  },[requestId]);
  return <Frame aside={<span className="header-note">Your meeting</span>}><p className="eyebrow">One meeting at a time</p><h1>{loading?'Finding your conversation.':error?'This link is private.':state?.status==='booked'?'A time to connect.':'Your meeting, in progress.'}</h1>
    {loading?<p role="status">Checking your private access…</p>:null}{error?<p className="workspace-description" role="alert">{error}</p>:null}
    {state?<div className="access-card"><div><h2>{state.title||'Meeting status'}</h2><p className="status-label">{state.status.replaceAll('_',' ')}</p>{state.proposal?<><ProposalTime proposal={state.proposal}/>{state.proposal.location?<p>{state.proposal.location}</p>:null}</>:null}<p>{state.closed?'This request is closed. Conversation history and changes are no longer available.':'Your saved request is protected. Conversation and proposal controls are being prepared.'}</p></div></div>:null}
  </Frame>;
}
