// AI provenance: OpenAI Codex; initially generated 2026-10-05 (Asia/Seoul); scope: file.
"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
export default function SignOut() {
  const router=useRouter();
  const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  return <><button disabled={busy} className="text-sm text-slate-600" onClick={async()=>{setBusy(true);setError("");try{const r=await fetch("/api/account",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"logout"})});if(!r.ok)throw Error();router.push("/");router.refresh();}catch{setBusy(false);setError("로그아웃하지 못했습니다. 다시 시도해 주세요.");}}}>{busy?"로그아웃 중…":"로그아웃"}</button>{error&&<span role="alert">{error}</span>}</>;
}
