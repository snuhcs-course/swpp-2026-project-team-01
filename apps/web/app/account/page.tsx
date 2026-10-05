import {redirect} from "next/navigation";
import {getAccount,safeNext} from "@/lib/server/account";
import {supabaseAdmin} from "@/lib/server/auth";
import SignOut from "./sign-out";
export const dynamic="force-dynamic";
export default async function AccountPage({searchParams}:{searchParams:Promise<{next?:string;calendar_error?:string}>}) {
  const user=await getAccount(); if(!user) redirect("/login");
  const params=await searchParams; const next=safeNext(params.next);
  const {data:connection}=await supabaseAdmin().from("owner_calendars").select("email,calendar_write_enabled").eq("account_id",user.id).maybeSingle();
  return <main className="min-h-screen bg-slate-50 p-6"><section className="mx-auto max-w-xl rounded-3xl bg-white p-8 shadow-sm"><header className="flex justify-between"><a href="/owner" className="font-bold text-indigo-600">Caltalk</a><SignOut/></header><h1 className="mt-8 text-2xl font-semibold">내 계정 · 캘린더 연결</h1><p className="mt-3">{user.email}</p>{params.calendar_error&&<p role="alert" className="mt-4 rounded-xl bg-rose-50 p-4 text-rose-700">Google 연결을 완료하지 못했습니다. 다른 Caltalk 계정에 연결된 Google 계정인지 확인하고 다시 연결해 주세요.</p>}
  {connection?<><p className="mt-6 rounded-xl bg-emerald-50 p-4">연결된 Google 계정: {connection.email}<br/>다음 로그인부터 이 연결을 재사용합니다.</p><a className="mt-6 inline-block rounded-xl bg-indigo-600 px-5 py-3 text-white" href={next==="/account"?"/owner":next}>계속하기</a><a className="mt-4 block text-sm text-indigo-700" href="/api/auth/google/start?role=owner&reconnect=1">연결이 만료됐거나 일정 등록 권한이 필요할 때 다시 연결</a></>:<><p className="mt-6 leading-7">Google Calendar를 한 번 연결해 주세요. 기존 링크가 있다면 예전에 사용한 같은 Google 계정을 선택하면 됩니다.</p><a className="mt-5 inline-block rounded-xl bg-indigo-600 px-5 py-3 text-white" href="/api/auth/google/start?role=owner">Google Calendar 연결</a></>}
  <p className="mt-6 text-xs leading-5 text-slate-500">Google 테스트 모드의 토큰 만료나 권한 취소 시에는 다시 연결해야 할 수 있습니다. Caltalk 비밀번호는 Google에 전달하지 않습니다.</p></section></main>;
}
