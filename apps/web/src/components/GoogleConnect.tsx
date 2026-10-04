"use client"
import {useState} from 'react'
import {z} from 'zod'
import {request} from './api'
import {Button,Spinner} from './ui'
export function GoogleConnect({purpose='login',returnPath='/onboarding'}:{purpose?:'login'|'calendar';returnPath?:string}) {
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
 return <div className="space-y-2">
  <Button variant="primary" size={purpose==='login'?'lg':'md'} disabled={busy} onClick={async()=>{setBusy(true);const r=await request('POST','/api/auth/google/start',z.object({authorizationUrl:z.string()}),{purpose,returnPath});if(r.ok)location.assign(r.data.authorizationUrl);else {setError(r.error.message);setBusy(false)}}}>
   {busy&&<Spinner/>}{busy?'연결 준비 중…':purpose==='login'?'Google 계정으로 시작':'Google Calendar 연결'}
  </Button>
  {error&&<p role="alert" className="text-small font-medium text-danger">{error}</p>}
 </div>
}
