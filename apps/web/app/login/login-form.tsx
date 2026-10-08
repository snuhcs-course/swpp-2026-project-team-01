// AI-generated with OpenAI Codex, 2026-10-05.
"use client";
import { useState, type FormEvent } from "react";
import { readJsonResponse } from "@/lib/client-json";
export default function LoginForm({next}:{next:string}) {
  const [signup,setSignup]=useState(false); const [email,setEmail]=useState(""); const [password,setPassword]=useState("");
  const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const [message,setMessage]=useState("");
  async function submit(event:FormEvent) {
    event.preventDefault();setBusy(true);setError("");setMessage("");
    try {
      const result=await readJsonResponse<{next?:string;message?:string}>(await fetch("/api/account",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:signup?"signup":"login",email,password,next})}),"로그인하지 못했습니다.");
      if(result.next) window.location.assign(result.next);
      else {setMessage(result.message??"이메일을 확인해 주세요.");setPassword("");}
    } catch(cause) {setError(cause instanceof Error?cause.message:"로그인하지 못했습니다.");}
    finally {setBusy(false);}
  }
  return <form onSubmit={submit} className="mt-6 space-y-4"><fieldset disabled={busy} className="space-y-4">
    <label className="block text-sm font-medium">이메일<input required type="email" autoComplete="email" maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} className="mt-2 w-full rounded-xl border p-3"/></label>
    <label className="block text-sm font-medium">비밀번호<input required type="password" minLength={8} maxLength={128} autoComplete={signup?"new-password":"current-password"} value={password} onChange={e=>setPassword(e.target.value)} className="mt-2 w-full rounded-xl border p-3"/>{signup&&<span className="mt-1 block text-xs text-slate-500">8자 이상 입력해 주세요. 가입 후 이메일 인증이 필요합니다.</span>}</label>
    <button className="w-full rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white">{busy?"처리 중…":signup?"Caltalk 계정 만들기":"로그인"}</button>
    <button type="button" onClick={()=>{setSignup(!signup);setError("");setMessage("");}} className="w-full text-sm text-indigo-700">{signup?"이미 계정이 있어요 · 로그인":"처음이신가요? 계정 만들기"}</button>
  </fieldset>{error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}{message&&<p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm">{message}</p>}<a href="/api/auth/google/start?role=owner" className="block pt-2 text-center text-sm text-slate-600">기존 Google 연결로 계속하기</a></form>;
}
