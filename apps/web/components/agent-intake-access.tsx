'use client';
import {useEffect,useRef,useState} from 'react';
import {agentIntakeBrowserView,type AgentIntakeBrowserView} from '../../../lib/contracts/agent-oauth.ts';
import {Button} from './ui/button.tsx';
import {Card,CardHeader,CardTitle,CardContent,CardFooter} from './ui/card.tsx';
import {Alert,AlertDescription} from './ui/alert.tsx';
async function api(action:string,authorizationId:string,method:'GET'|'POST',signal?:AbortSignal){
 const response=await fetch('/api/browser/agent-oauth/'+action+(method==='GET'?'?authorizationId='+authorizationId:''),{method,headers:method==='POST'?{'content-type':'application/json'}:undefined,body:method==='POST'?JSON.stringify({authorizationId}):undefined,cache:'no-store',signal:signal??AbortSignal.timeout(35000)});
 const result=await response.json();if(!response.ok)throw Error(result.error?.message??'Request access could not be checked. Try again.');return result;
}
export function AgentIntakeAccess({authorizationId}:{authorizationId:string}){
 const [state,setState]=useState<AgentIntakeBrowserView|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[revoked,setRevoked]=useState(false),[revision,setRevision]=useState(0);
 const flight=useRef(false);
 useEffect(()=>{const controller=new AbortController();let active=true;setLoading(true);setError('');
  api('intake-state',authorizationId,'GET',controller.signal).then(value=>{if(active)setState(agentIntakeBrowserView.parse(value));}).catch(cause=>{if(active){setState(null);setError(cause instanceof Error?cause.message:'Request access is unavailable.');}}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;controller.abort();};
 },[authorizationId,revision]);
 async function act(action:'intake-claim'|'intake-revoke'){
  if(flight.current)return;flight.current=true;setBusy(true);setError('');
  try{const result=await api(action,authorizationId,'POST');if(action==='intake-revoke'){setRevoked(true);setState(null);}else if(state?.requestId&&result.path==='/booking/'+state.requestId)window.location.assign(result.path);else throw Error('Request access changed. Reload and try again.');}
  catch(cause){setError((cause instanceof Error?cause.message:'The response could not be confirmed.')+' You can retry this same action.');}
  finally{flight.current=false;setBusy(false);}
 }
 return <main className="workspace"><header className="workspace-header"><a className="wordmark" href="/">Find Me a Time<span aria-hidden="true">↗</span></a></header><section className="workspace-content"><p className="eyebrow">Personal agent access</p><h1>Open your meeting request.</h1>
  <p>Use the browser where you granted your agent access. Copying this link to another browser does not share your request.</p>
  {revoked?<p role="status">Agent access revoked. Request access already saved in this browser keeps its existing limits.</p>:<Card aria-busy={busy||loading}>
   <CardHeader><CardTitle className="break-words">{state?state.clientName:'Request access'}</CardTitle></CardHeader>
   <CardContent>{loading?<p role="status">Checking your request…</p>:state?<><p>Host: <strong>{state.hostName??'Meeting host'}</strong></p><p>{state.state==='pending'?'Your agent has not created the request yet. Return to your agent to supply any missing details, then reload here.':'Your agent created your request. Open it here to review the conversation and meeting controls.'}</p><p>Opening the request does not agree to a meeting or approve a booking.</p></>:<p>This consent may have expired or belongs to another browser. Return to the browser where you granted access.</p>}</CardContent>
   <CardFooter className="flex flex-wrap gap-3">{state?.state==='bound'?<Button disabled={busy||loading} onClick={()=>void act('intake-claim')} className="min-h-11 h-auto whitespace-normal">Open my request</Button>:null}<Button variant="outline" disabled={busy||loading} onClick={()=>setRevision(v=>v+1)} className="min-h-11">Reload</Button><Button variant="outline" disabled={busy||loading} onClick={()=>void act('intake-revoke')} className="min-h-11 h-auto whitespace-normal">Revoke agent access</Button></CardFooter>
  </Card>}
  {error?<Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>:null}
 </section><footer>Your calendar. Your final say.</footer></main>;
}
