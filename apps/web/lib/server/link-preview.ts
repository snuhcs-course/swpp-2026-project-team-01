// AI provenance: OpenAI Codex; initially generated 2026-10-05 (Asia/Seoul); scope: file.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { LinkOptions } from "@/lib/link-options";
import type { TimeWindow } from "@/lib/availability";

type Preview = { purpose: "share-candidates"; owner: string; options: LinkOptions; candidates: TimeWindow[]; issuedAt: number };
function signature(value: string) {
  const key = process.env.CALTALK_SESSION_SECRET;
  if (!key) throw new Error("Session signing key missing");
  return createHmac("sha256", key).update(value).digest("base64url");
}
export function signPreview(owner: string, options: LinkOptions, candidates: TimeWindow[]) {
  const body = Buffer.from(JSON.stringify({ purpose: "share-candidates", owner, options, candidates, issuedAt: Date.now() } satisfies Preview)).toString("base64url");
  return `${body}.${signature(body)}`;
}
export function readPreview(value: unknown, owner: string): Preview {
  if (typeof value !== "string" || value.length > 12_000) throw new Error("후보를 다시 조회해 주세요.");
  const [body, sig, extra] = value.split(".");
  const expected = Buffer.from(signature(body)); const received = Buffer.from(sig ?? "");
  if (extra || received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error("후보 정보를 확인할 수 없습니다. 다시 조회해 주세요.");
  const preview = JSON.parse(Buffer.from(body, "base64url").toString()) as Preview;
  if (preview.purpose !== "share-candidates" || preview.owner !== owner || Date.now() - preview.issuedAt > 15 * 60_000) throw new Error("후보 조회 후 시간이 지났습니다. 후보를 다시 조회해 주세요.");
  return preview;
}
