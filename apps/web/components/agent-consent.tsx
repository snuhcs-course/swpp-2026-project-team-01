'use client';
import {useEffect,useRef,useState} from 'react';
import {agentConsentView,agentGrantsView,agentPermissionLabels,type AgentConsentView,type AgentGrant} from '../../../lib/contracts/agent-oauth.ts';
import {Button} from './ui/button.tsx';
import {Card,CardHeader,CardTitle,CardDescription,CardContent,CardFooter} from './ui/card.tsx';
import {Alert,AlertDescription} from './ui/alert.tsx';
import {Field,FieldLabel} from './ui/field.tsx';

async function api(action:string,input:Record<string,unknown>,method:'GET'|'POST'='GET',signal?:AbortSignal){
 const query=new URLSearchParams(Object.entries(input).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)]));
 const response=await fetch('/api/browser/agent-oauth/'+action+(method==='GET'?'?'+query:''),{method,headers:method==='POST'?{'content-type':'application/json'}:undefined,body:method==='POST'?JSON.stringify(input):undefined,cache:'no-store',signal:signal??AbortSignal.timeout(35000)});
 const data=await response.json();if(!response.ok)throw new Error(data.error?.message??'Access could not be checked. Try again.');return data;
}
function Permissions({scope}:{scope:string}){
 return <ul className="list-disc pl-5 flex flex-col gap-2">{scope.split(' ').map(value=><li key={value}>{agentPermissionLabels[value as keyof typeof agentPermissionLabels]??'Unknown permission — start a new connection.'}</li>)}</ul>;
}
export function AgentConsent({authorizationId,initialRequestId,loginExpired=false}:{authorizationId:string|null;initialRequestId?:string;loginExpired?:boolean}){
 const [state,setState]=useState<AgentConsentView|null>(null),[requestId,setRequestId]=useState(initialRequestId),[revision,setRevision]=useState(0);
 const [revoked,setRevoked]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const inFlight=useRef(false);
 useEffect(()=>{
  if(!authorizationId)return;const controller=new AbortController();let active=true;setLoading(true);setError('');
  api('state',{authorizationId,requestId},'GET',controller.signal).then(value=>{if(active){const next=agentConsentView.parse(value);setState(next);}}).catch(cause=>{if(active){setState(null);setError(cause instanceof Error?cause.message:'Access could not be checked.');}}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;controller.abort();};
 },[authorizationId,requestId,revision]);
 async function act(action:'grant'|'deny'|'login'|'revoke'){
  if(inFlight.current||!authorizationId||!state)return;inFlight.current=true;setBusy(true);setError('');
  try{
   if(action==='revoke'){await api('intake-revoke',{authorizationId},'POST');setRevoked(true);return;}
   const result=await api(action==='login'?'login':'decide',{authorizationId,...(state.requestId?{requestId:state.requestId}:{}),...(action==='login'?{}:{decision:action})},'POST');
   window.location.assign(action==='login'?result.url:result.redirectUri);
  }catch(cause){setError((cause instanceof Error?cause.message:'The response could not be confirmed.')+' You can retry the same choice. If the attempt has expired, start again from your agent.');}
  finally{inFlight.current=false;setBusy(false);}
 }
 return <main className="workspace"><header className="workspace-header"><a className="wordmark" href="/">Find Me a Time<span aria-hidden="true">↗</span></a></header><section className="workspace-content">
  <p className="eyebrow">Personal agent access</p><h1>{authorizationId?'Review this connection.':'Manage your connections.'}</h1>
  {!authorizationId?<AgentGrants requestId={initialRequestId}/>:<>
   {revoked?<p role="status">This connection is revoked. Start a new connection from your agent if needed.</p>:loading?<p role="status">Checking this connection…</p>:state?<Card aria-busy={busy}>
    <CardHeader><CardTitle className="break-words">{state.clientName}</CardTitle><CardDescription>This name is supplied by the client. Only connect an agent you intended to use.</CardDescription></CardHeader>
    <CardContent className="flex flex-col gap-5">
     <div><p>Requested permissions</p><Permissions scope={state.scope}/></div>
     <p>These permissions do not approve a meeting or share your Google credentials. Meeting decisions still require your explicit confirmation.</p>
     {state.audience==='intake'?<p>Your agent can create one request for this host within 15 minutes. After creation, access applies only to that request for up to 30 days and ends earlier if request access ends. No account or meeting-details form is required here.</p>:<p>Access lasts up to 30 days and ends earlier if the underlying account session or request access ends. You can revoke it below.</p>}
     <div><p>Return address</p><p className="break-all">{state.redirectUri}</p></div>
     {state.label?<p>Connecting for: <strong>{state.label}</strong></p>:null}
     {state.access==='sign_in'?<p>Sign in with your invited Google account to review host access.</p>:null}
     {state.access==='admission'?<p>Your account needs an active host invitation. <a href="/app">Open your host workspace</a>, redeem it, then return here.</p>:null}
     {state.audience==='guest'&&state.requests.length>1?<Field><FieldLabel htmlFor="agent-request">Meeting request</FieldLabel><select id="agent-request" value={requestId??''} disabled={busy} onChange={event=>setRequestId(event.target.value||undefined)} className="min-h-11 max-w-full rounded-md border bg-background px-3"><option value="">Choose a request</option>{state.requests.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>:null}
     {state.access==='request_required'?<p>Open your private meeting link in this browser, then return here and reload. Request access does not require a host account.</p>:null}
     {state.decision?<p role="status">Your {state.decision==='grant'?'grant':'denial'} was recorded. Continue to your agent to finish. A grant code expires after one minute; an expired code requires a new connection.</p>:null}
    </CardContent><CardFooter className="flex flex-wrap gap-3">
     {state.access==='sign_in'&&state.decision===null?<Button disabled={busy} onClick={()=>void act('login')} className="min-h-11 h-auto whitespace-normal">Continue with Google</Button>:null}
     {state.decision!=='deny'?<Button disabled={busy||state.access!=='ready'} onClick={()=>void act('grant')} className="min-h-11 h-auto whitespace-normal">{state.decision==='grant'?'Continue to agent':'Grant access'}</Button>:null}
     {state.decision!=='grant'?<Button variant="outline" disabled={busy} onClick={()=>void act('deny')} className="min-h-11 h-auto whitespace-normal">{state.decision==='deny'?'Continue to agent':'Deny access'}</Button>:null}
     {state.audience==='intake'&&state.decision==='grant'?<a href={'/connect/intake?authorizationId='+authorizationId} className="underline underline-offset-4">Open request access</a>:null}
     {state.audience==='intake'&&state.decision==='grant'?<Button variant="outline" disabled={busy} onClick={()=>void act('revoke')}>Revoke this connection</Button>:null}
     <Button variant="ghost" disabled={busy} onClick={()=>setRevision(value=>value+1)} className="min-h-11">Reload</Button>
    </CardFooter>
   </Card>:<Button variant="outline" onClick={()=>setRevision(value=>value+1)}>Try again</Button>}
   {!loading&&!state?<p className="mt-6">If you already granted access for a new request in this browser, <a href={'/connect/intake?authorizationId='+authorizationId} className="underline underline-offset-4">Open request access</a>.</p>:null}
   {loginExpired?<Alert><AlertDescription>Google sign-in was not completed. You can try again or deny this connection.</AlertDescription></Alert>:null}
   {error?<Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>:null}
   {state?.audience!=='intake'?<p className="mt-6"><a href={'/connect/authorize'+(state?.requestId?'?requestId='+state.requestId:'')}>Manage existing agent permissions</a></p>:null}
  </>}
 </section><footer>Your calendar. Your final say.</footer></main>;
}
function AgentGrants({requestId}:{requestId?:string}){
 const [grants,setGrants]=useState<AgentGrant[]>([]),[cursor,setCursor]=useState<string|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(true),[revision,setRevision]=useState(0);
 const inFlight=useRef(false);
 useEffect(()=>{let active=true;const controller=new AbortController();setBusy(true);setError('');
  api('grants',{requestId},'GET',controller.signal).then(value=>{if(active){const result=agentGrantsView.parse(value);setGrants(result.grants);setCursor(result.nextCursor);}}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Permissions could not be checked.');}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;controller.abort();};
 },[requestId,revision]);
 async function more(){if(inFlight.current||!cursor)return;inFlight.current=true;setBusy(true);setError('');try{const result=agentGrantsView.parse(await api('grants',{requestId,cursor}));setGrants(old=>[...old,...result.grants.filter(item=>!old.some(existing=>existing.id===item.id))]);setCursor(result.nextCursor);}catch(cause){setError(cause instanceof Error?cause.message:'Permissions could not be checked.');}finally{inFlight.current=false;setBusy(false);}}
 async function revoke(grantId:string){if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');setNotice('');try{await api('revoke',{requestId,grantId},'POST');setGrants(old=>old.filter(item=>item.id!==grantId));setNotice('Agent access revoked.');}catch(cause){setError(cause instanceof Error?cause.message:'Revocation could not be confirmed. Retry this same action.');}finally{inFlight.current=false;setBusy(false);}}
 return <div className="flex flex-col gap-5" aria-busy={busy}>
  <p>{requestId?'Permissions for this private meeting request.':'Permissions for your host account.'} Revocation stops future access and refresh.</p>
  {busy?<p role="status">Checking permissions…</p>:!error&&!grants.length?<p>No active agent permissions.</p>:null}
  {grants.map(grant=><Card key={grant.id}><CardHeader><CardTitle className="break-words">{grant.clientName}</CardTitle><CardDescription>Expires {new Date(grant.expiresAt).toLocaleString()}{grant.clientDisabled?' · Client disabled':''}</CardDescription></CardHeader><CardContent><Permissions scope={grant.scope}/></CardContent><CardFooter><Button variant="outline" disabled={busy} onClick={()=>void revoke(grant.id)} className="min-h-11">Revoke access</Button></CardFooter></Card>)}
  {cursor?<Button variant="outline" disabled={busy} onClick={()=>void more()}>Load more</Button>:null}
  {error?<Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>:null}{notice?<p role="status">{notice}</p>:null}
  <Button variant="ghost" disabled={busy} onClick={()=>setRevision(value=>value+1)}>Reload permissions</Button>
  <a href={requestId?'/booking/'+requestId:'/app'}>{requestId?'Return to your request':'Open your host workspace'}</a>
 </div>;
}
