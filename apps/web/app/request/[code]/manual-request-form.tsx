"use client";
import { useState, type FormEvent } from "react";
import { readJsonResponse } from "@/lib/client-json";
type Slot = { start: string; end: string; label: string };
const field = "mt-2 w-full rounded-xl border border-slate-300 px-4 py-3";
export default function ManualRequestForm({ code, fixedDuration }: { code: string; fixedDuration: number | null }) {
  const [name,setName]=useState(""); const [email,setEmail]=useState(""); const [purpose,setPurpose]=useState("");
  const [location,setLocation]=useState(""); const [duration,setDuration]=useState(fixedDuration ?? 60);
  const [slots,setSlots]=useState<Slot[] | null>(null); const [selected,setSelected]=useState<string[]>([]);
  const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const [sent,setSent]=useState(false);
  function resetSlots() { setSlots(null); setSelected([]); setError(""); }
  async function findSlots() {
    setBusy(true); setError(""); setSelected([]); setSlots(null);
    try {
      const query = new URLSearchParams({ code, location, duration: String(duration) });
      const result=await readJsonResponse<{slots:Slot[]}>(await fetch("/api/requests/manual?"+query, {cache:"no-store"}),"시간을 불러오지 못했습니다.");
      setSlots(result.slots);
    } catch(cause) {setError(cause instanceof Error ? cause.message : "시간을 불러오지 못했습니다.");}
    finally {setBusy(false);}
  }
  async function submit(event: FormEvent) {
    event.preventDefault();setBusy(true);setError("");
    try {
      await readJsonResponse(await fetch("/api/requests/manual",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code,name,email,purpose,location,duration,selectedStarts:selected})}),"요청을 보내지 못했습니다.");
      setSent(true);
    } catch(cause) {setError(cause instanceof Error ? cause.message : "요청을 보내지 못했습니다.");}
    finally {setBusy(false);}
  }
  if(sent) return <div className="mt-6 rounded-2xl bg-emerald-50 p-6"><h2 className="text-xl font-semibold">미팅 요청을 보냈어요</h2><p className="mt-3">아직 확정된 일정은 아닙니다. 호스트가 선택한 시간을 수락하면 입력한 이메일로 Google 일정 초대를 보내도록 요청합니다.</p></div>;
  return <form onSubmit={submit} className="mt-6 space-y-5"><p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Google 연결이나 회원가입 없이 요청할 수 있어요. 내 캘린더는 자동 확인하지 않으니, 직접 가능한 시간을 선택해 주세요. 최종 확정은 호스트가 합니다.</p>
    <fieldset disabled={busy} className="space-y-5">
      <label className="block">이름<input className={field} required maxLength={100} value={name} onChange={e=>setName(e.target.value)} /></label>
      <label className="block">초대받을 이메일<input className={field} required type="email" maxLength={254} autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} /><span className="text-xs text-slate-500">이메일 주소를 정확히 입력해 주세요. 이 주소의 소유 여부는 확인하지 않습니다.</span></label>
      <label className="block">미팅 목적<input className={field} required maxLength={500} value={purpose} onChange={e=>setPurpose(e.target.value)} /></label>
      <label className="block">희망 장소<input className={field} maxLength={200} placeholder="예: 강남역, 온라인" value={location} onChange={e=>{setLocation(e.target.value);resetSlots();}} /></label>
      {fixedDuration ? <p>{fixedDuration}분 · 호스트가 정한 미팅 길이</p> : <label className="block">미팅 길이<select className={field} value={duration} onChange={e=>{setDuration(Number(e.target.value));resetSlots();}}>{[30,45,60,90].map(n=><option key={n} value={n}>{n}분</option>)}</select></label>}
      <button type="button" onClick={()=>void findSlots()} className="rounded-xl border border-indigo-600 px-5 py-3 text-indigo-700">{busy ? "확인 중…" : slots ? "가능 시간 다시 확인" : "선택 가능한 시간 보기"}</button>
      {slots && <fieldset className="space-y-3"><legend className="mb-3 font-semibold">가능한 시간 선택 · 1~3개 · 서울 시간</legend>{slots.length===0 ? <p>현재 가능한 시간이 없습니다. 호스트에게 새 링크를 요청해 주세요.</p> : slots.map(slot=><label key={slot.start} className="flex items-center gap-3 rounded-xl border border-slate-200 p-4"><input type="checkbox" checked={selected.includes(slot.start)} disabled={!selected.includes(slot.start)&&selected.length>=3} onChange={e=>setSelected(current=>e.target.checked?[...current,slot.start]:current.filter(s=>s!==slot.start))} /><span>{slot.label}<br /><small>{duration}분 미팅</small></span></label>)}</fieldset>}
      <button type="submit" disabled={!selected.length || busy} className="rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white disabled:opacity-50">{busy ? "처리 중…" : "선택한 시간으로 미팅 요청"}</button>
    </fieldset>{error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">{error}</p>}
  </form>;
}
