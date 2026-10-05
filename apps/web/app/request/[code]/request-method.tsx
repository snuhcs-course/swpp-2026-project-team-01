"use client";
import { useState } from "react";
import RequestForm from "./request-form";
import ManualRequestForm from "./manual-request-form";
export default function RequestMethod({ code, fixedDuration, connected }: {code:string;fixedDuration:number|null;connected:boolean}) {
  const [mode,setMode]=useState<"google"|"manual">("google");
  return <div className="mt-8"><div className="grid grid-cols-2 gap-3" aria-label="요청 방식">
    <button type="button" aria-pressed={mode==="google"} onClick={()=>setMode("google")} className={mode==="google"?"rounded-xl bg-indigo-600 p-3 text-white":"rounded-xl border border-slate-300 p-3"}>Google Calendar 자동 확인</button>
    <button type="button" aria-pressed={mode==="manual"} onClick={()=>setMode("manual")} className={mode==="manual"?"rounded-xl bg-indigo-600 p-3 text-white":"rounded-xl border border-slate-300 p-3"}>연동 없이 시간 선택</button>
  </div>{mode==="manual" ? <ManualRequestForm code={code} fixedDuration={fixedDuration}/> : connected ? <RequestForm fixedDuration={fixedDuration} code={code}/> : <div className="mt-6 rounded-2xl bg-slate-50 p-6"><h2 className="font-semibold">캘린더로 자동 확인</h2><p className="mt-2 text-sm leading-6 text-slate-600">바쁜 시간과 장소를 읽기 전용으로 확인합니다. 연결한 Caltalk 계정이 있으면 로그인해서 기존 연결을 사용할 수 있어요.</p><a className="mt-5 inline-flex rounded-xl bg-indigo-600 px-5 py-3 text-white" href={"/api/auth/google/start?role=requester&share="+encodeURIComponent(code)}>Google Calendar 연결</a><a className="ml-4 text-indigo-700" href={"/login?next="+encodeURIComponent("/request/"+code)}>Caltalk 로그인</a></div>}</div>;
}
