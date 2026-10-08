// AI-generated with OpenAI Codex, 2026-10-05.
import { NextResponse } from "next/server";
import { accountClient, safeNext, sameOrigin } from "@/lib/server/account";
import { appUrl, clearSession, jsonError } from "@/lib/server/auth";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("이 사이트에서 다시 시도해 주세요.",403);
  let body;
  try {body=await request.json();} catch {return jsonError("입력 내용을 확인해 주세요.",400);}
  const client=await accountClient();
  if(body?.action==="logout") {
    await client.auth.signOut({scope:"local"}); await clearSession();
    return NextResponse.json({next:"/"});
  }
  const email=typeof body?.email==="string"?body.email.trim().toLowerCase():"";
  const password=typeof body?.password==="string"?body.password:"";
  if(email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length<8 || password.length>128) return jsonError("이메일과 8~128자 비밀번호를 입력해 주세요.",400);
  if(body.action==="signup") {
    const {data,error}=await client.auth.signUp({email,password,options:{emailRedirectTo:appUrl("/api/account/confirm")}});
    if(error) return jsonError(error.status===429?"가입 요청이 많습니다. 잠시 후 다시 시도해 주세요.":"가입하지 못했습니다. 이메일을 확인해 주세요. 인증 메일 발송 설정이 필요한 경우 관리자에게 알려 주세요.",error.status===429?429:400);
    await clearSession();
    return NextResponse.json(data.session ? {next:safeNext(body.next)} : {message:"인증 메일을 확인한 뒤 로그인해 주세요. 메일이 없다면 스팸함도 확인해 주세요."});
  }
  if(body.action!=="login") return jsonError("지원하지 않는 요청입니다.",400);
  const {error}=await client.auth.signInWithPassword({email,password});
  if(error) return jsonError(error.status===429?"로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.":"이메일·비밀번호 또는 이메일 인증 완료 여부를 확인해 주세요.",error.status===429?429:401);
  await clearSession();
  return NextResponse.json({next:safeNext(body.next)});
}
