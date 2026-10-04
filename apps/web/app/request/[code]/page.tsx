import Link from "next/link";
import { createHash } from "node:crypto";
import { getSession, supabaseAdmin } from "@/lib/server/auth";
import RequestForm from "./request-form";
export const dynamic = "force-dynamic";
export default async function RequestPage({ params }: PageProps<"/request/[code]">) {
  const { code } = await params;
  const codeHash = createHash("sha256").update(code).digest("hex");
  const { data: share } = await supabaseAdmin().from("share_links").select("id,active,owner_calendars(email)").eq("code_hash", codeHash).maybeSingle();
  const session = await getSession();
  const owner = Array.isArray(share?.owner_calendars) ? share.owner_calendars[0] : share?.owner_calendars;
  if (!share?.active) return <main className="grid min-h-screen place-items-center p-6"><section className="w-full max-w-lg rounded-3xl bg-white p-8 shadow-xl"><h1 className="text-2xl font-semibold">사용할 수 없는 요청 링크예요</h1><p className="mt-3 text-slate-600">일정 소유자에게 새 링크를 요청해 주세요.</p><Link className="mt-6 inline-block text-indigo-700" href="/">Caltalk 홈으로</Link></section></main>;
  const connected = session?.role === "requester" && session.shareId === share.id;
  return <main className="min-h-screen bg-[#f6f7fb] px-5 py-12"><section className="mx-auto max-w-2xl rounded-3xl bg-white p-8 shadow-xl"><p className="text-sm font-semibold tracking-widest text-indigo-600">CALTALK · MEETING REQUEST</p><h1 className="mt-3 text-3xl font-semibold text-slate-900">{owner?.email ?? "일정 소유자"}님과 미팅 요청</h1><p className="mt-3 text-slate-600">미팅 목적과 소요 시간을 알려주세요. 두 캘린더의 충돌과 장소 이동 여유를 확인해 후보 시간을 추천합니다.</p>{connected ? <RequestForm /> : <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6"><h2 className="font-semibold text-slate-900">요청자 Google Calendar 연결</h2><p className="mt-2 text-sm leading-6 text-slate-600">일정 제목이나 참석자는 저장하지 않습니다. 바쁜 시간, 일정 시간, 장소만 확인하며 읽기 전용으로 연결합니다.</p><a className="mt-5 inline-flex rounded-xl bg-indigo-600 px-5 py-3 font-medium text-white hover:bg-indigo-700" href={`/api/auth/google/start?role=requester&share=${encodeURIComponent(code)}`}>Google Calendar 연결</a></div>}</section></main>;
}
