'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {bookingReceiptState,bookingJoinUrl,type BookingReceiptState} from '../../../lib/contracts/booking-receipt.ts';
import {Button} from './ui/button';
import {Card,CardHeader,CardTitle,CardDescription,CardContent,CardFooter} from './ui/card';
import {Alert,AlertTitle,AlertDescription} from './ui/alert';
const deliveryText={pending:'Confirmation email is queued.',sending:'Confirmation email is being sent.',sent:'Confirmation email was accepted for sending.',uncertain:'Confirmation email delivery could not yet be verified.',failed:'Confirmation email could not be sent.',suppressed:'Confirmation email is unavailable for this recipient.'};
export function BookingReceiptCard({requestId,audience,onStatus}:{requestId:string;audience:'host'|'guest';onStatus?:(state:BookingReceiptState)=>void}){
 const [state,setState]=useState<BookingReceiptState|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const generation=useRef(0),notify=useRef(onStatus);notify.current=onStatus;
 const refresh=useCallback(async()=>{
  const ticket=++generation.current;setBusy(true);
  try{
   const response=await fetch('/api/browser/booking-receipt?'+new URLSearchParams({requestId,audience}),{cache:'no-store',signal:AbortSignal.timeout(15000)}),body=await response.json();
   if(!response.ok)throw new Error(body.error?.message??'Your booking could not be loaded. Try again.');
   const next=bookingReceiptState.parse(body);if(ticket!==generation.current)return;
   setState(next);setError('');notify.current?.(next);
  }catch(cause){if(ticket!==generation.current)return;setState(null);setError(cause instanceof Error?cause.message:'Your booking could not be loaded. Try again.');}
  finally{if(ticket===generation.current)setBusy(false);}
 },[requestId,audience]);
 useEffect(()=>{setState(null);setError('');void refresh();const focus=()=>{if(document.visibilityState==='visible')void refresh();};
  addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);const timer=setInterval(focus,30000);
  return()=>{generation.current++;clearInterval(timer);removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
 },[refresh]);
 const receipt=state?.requestId===requestId?state.receipt:null,join=receipt?bookingJoinUrl(receipt):null;
 const format=receipt?new Intl.DateTimeFormat('en',{dateStyle:'full',timeStyle:'short',timeZone:receipt.timezone}):null;
 return <Card role="region" aria-label="Booking confirmation" className="min-w-0">
  <CardHeader><CardTitle className="wrap-anywhere">{receipt?'Meeting confirmed':state?.status==='booking'?'Booking in progress':'Booking details'}</CardTitle><CardDescription>{receipt?'Your meeting is saved in the calendar.':state?.status==='booking'?'We’re checking the saved booking. A confirmation will appear here once the Calendar event is verified.':'Check the latest permitted booking details.'}</CardDescription></CardHeader>
  <CardContent className="flex min-w-0 flex-col gap-4">
   {error?<Alert variant="destructive"><AlertTitle>Booking unavailable</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>:null}
   {receipt&&format?<><h3 className="wrap-anywhere">{receipt.title}</h3><p className="wrap-anywhere whitespace-pre-wrap">{receipt.purpose}</p>
    <dl className="flex min-w-0 flex-col gap-2">
     <div><dt>Starts</dt><dd className="wrap-anywhere"><time dateTime={receipt.start}>{format.format(new Date(receipt.start))}</time></dd></div>
     <div><dt>Ends</dt><dd className="wrap-anywhere"><time dateTime={receipt.end}>{format.format(new Date(receipt.end))}</time></dd></div>
     <div><dt>Timezone</dt><dd>{receipt.timezone}</dd></div>
     <div><dt>Duration</dt><dd>{(Date.parse(receipt.end)-Date.parse(receipt.start))/60000} minutes</dd></div>
     <div><dt>{receipt.mode==='online'?'Meeting link':'Location'}</dt><dd className="wrap-anywhere">{receipt.location}</dd></div>
     <div><dt>Participants</dt><dd><ul>{receipt.participants.map(person=><li className="wrap-anywhere" key={person.email}>{person.email}</li>)}</ul></dd></div>
    </dl>
    <p role="status">{state?.emailStatus?deliveryText[state.emailStatus]:''} Your booking remains confirmed regardless of email delivery.</p>
    <p>For changes after booking, use your calendar.</p></>:null}
   {state?.status==='booked'&&!receipt?<p role="status">The confirmed receipt is not available yet. Check again to load it.</p>:null}
   {busy&&!state?<p role="status">Checking booking…</p>:null}
  </CardContent>
  <CardFooter className="flex flex-wrap gap-2">
   {join?<Button asChild className="min-h-11"><a href={join} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Join meeting</a></Button>:null}
   {receipt?.calendarUrl?<Button asChild variant="outline" className="min-h-11"><a href={receipt.calendarUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open in Google Calendar</a></Button>:null}
   <Button variant="outline" className="min-h-11" disabled={busy} onClick={()=>void refresh()}>Check booking status</Button>
  </CardFooter>
 </Card>;
}
