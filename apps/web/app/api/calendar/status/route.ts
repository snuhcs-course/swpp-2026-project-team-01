import { NextResponse } from "next/server";
import { getSession, supabaseAdmin } from "@/lib/server/auth";
export const dynamic = "force-dynamic";
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ connected: false });
  const { data } = await supabaseAdmin().from("owner_calendars").select("email").eq("google_sub", session.sub).maybeSingle();
  return NextResponse.json({ connected: session.role === "owner" && Boolean(data), email: session.role === "owner" ? data?.email : undefined });
}
