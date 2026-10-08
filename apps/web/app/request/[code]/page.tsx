// AI provenance: OpenAI Codex; initially generated 2026-10-04 (Asia/Seoul); scope: file.
import Link from "next/link";
import { createHash } from "node:crypto";
import { getSession, supabaseAdmin } from "@/lib/server/auth";
import RequestMethod from "./request-method";
import { linkIsOpen } from "@/lib/availability";
export const dynamic="force-dynamic";
export default async function RequestPage({params}:PageProps<"/request/[code]">) {
  const {code}=await params;
  const {data:share}=await supabaseAdmin().from("share_links").select("id,active,deleted_at,availability_end,meeting_duration_minutes,owner_calendars(email)").eq("code_hash",createHash("sha256").update(code).digest("hex")).maybeSingle();
  if(!share || !linkIsOpen(share)) return <main className="grid min-h-screen place-items-center p-6"><section className="w-full max-w-lg rounded-3xl bg-white p-8 shadow-xl"><h1 className="text-2xl font-semibold">사용할 수 없는 요청 링크예요</h1><p className="mt-3 text-slate-600">일정 소유자에게 새 링크를 요청해 주세요.</p><Link className="mt-6 inline-block text-indigo-700" href="/">Caltalk 홈으로</Link></section></main>;
  const session=await getSession();
  const owner=Array.isArray(share.owner_calendars)?share.owner_calendars[0]:share.owner_calendars;
  const connected=!!session && (session.role==="owner" || session.shareId===share.id);
  return <main className="min-h-screen bg-[#f6f7fb] px-5 py-12"><section className="mx-auto max-w-2xl rounded-3xl bg-white p-8 shadow-xl"><Link href="/" className="text-sm font-semibold tracking-widest text-indigo-600">CALTALK · MEETING REQUEST</Link><h1 className="mt-3 text-3xl font-semibold text-slate-900">{owner?.email??"일정 소유자"}님과 미팅 요청</h1><p className="mt-3 text-slate-600">캘린더로 자동 확인하거나, 연결 없이 가능한 시간을 직접 선택하세요. 호스트가 수락해야 확정됩니다.</p>{connected&&<p className="mt-4 text-sm text-emerald-700">기존 Google 연결 사용 · {session.email}</p>}<RequestMethod code={code} fixedDuration={share.meeting_duration_minutes} connected={connected}/></section></main>;
}
