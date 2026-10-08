// AI-generated with OpenAI Codex, 2026-10-05.
import Link from "next/link";
import { safeNext } from "@/lib/server/account";
import LoginForm from "./login-form";
export default async function LoginPage({searchParams}:{searchParams:Promise<{next?:string;error?:string}>}) {
  const params=await searchParams;
  return <main className="grid min-h-screen place-items-center bg-slate-50 p-6"><section className="w-full max-w-md rounded-3xl bg-white p-8 shadow-sm"><Link href="/" className="text-xl font-bold text-indigo-600">Caltalk</Link><h1 className="mt-6 text-2xl font-semibold">내 계정으로 시작하기</h1><p className="mt-3 text-sm leading-6 text-slate-600">Google Calendar는 계정에 한 번 연결하면 다음 로그인부터 다시 사용할 수 있어요. 연결 권한이 만료된 경우에만 재연결이 필요합니다.</p>{params.error && <p role="alert" className="mt-4 text-rose-700">인증 링크가 만료됐거나 다른 브라우저에서 열렸습니다. 가입한 브라우저에서 열거나 인증 완료 후 로그인해 주세요.</p>}<LoginForm next={safeNext(params.next)}/></section></main>;
}
