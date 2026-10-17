// AI-generated with Claude Code (claude-opus-5-5), 2026-10-18
"use client";

import { request } from "@/components/api";
import type { ApiResult } from "@/contracts/common";
import { notifyRequestSchema, phoneLinkReadSchema, phoneLinkSchema, type NotifyChannel, type PhoneLink } from "@/contracts/phone-link";

// Talking to the number check (contracts/phone-link.ts). Demo mode has no texts, so it plays the same states
// in the page: the text goes out after a moment, and demo buttons stand in for the host's reply (right or wrong)
// or a failed send.

export type LinkResult = { ok: true; view: PhoneLink } | { ok: false; kind: "invalid" | "taken" | "other"; message: string };

export type PhoneLinker = {
  start(phone: string): Promise<LinkResult>;
  read(): Promise<LinkResult>;
  retry(): Promise<LinkResult>;
  /** Asks to hear when texting works again; false when the request did not go through. */
  notify(channel: NotifyChannel): Promise<boolean>;
  demo?: { reply(): void; wrong(): void; fail(): void };
};

const URL = "/api/host/imessage/connection";

function answer(r: ApiResult<PhoneLink | null>): LinkResult {
  if (r.ok) return r.data ? { ok: true, view: r.data } : { ok: false, kind: "other", message: "" };
  const kind = r.error.code === "invalid_input" ? "invalid" : r.error.code === "revision_conflict" ? "taken" : "other";
  return { ok: false, kind, message: r.error.message };
}

export const serverLinker: PhoneLinker = {
  start: async (phone) => answer(await request("POST", URL, phoneLinkSchema, { phone }, crypto.randomUUID())),
  read: async () => answer(await request("GET", URL, phoneLinkReadSchema.transform((r) => r.connection))),
  retry: async () => answer(await request("POST", `${URL}/retry`, phoneLinkSchema, {}, crypto.randomUUID())),
  notify: async (channel) => (await request("POST", "/api/host/imessage/notify", notifyRequestSchema, { channel }, crypto.randomUUID())).ok,
};

// The demo follows the agreed rules: a number lasts 5 minutes, a text goes out no sooner than a minute after the
// last one (asking earlier just waits), after 5 texts within 5 minutes the phone is put off, a wrong reply
// replaces the number, and 3 wrong replies fail the check until 5 minutes have passed.
const TTL_MS = 5 * 60_000;
const RETRY_MS = 60_000;
const WINDOW_MS = 5 * 60_000;
const MAX_SENDS = 5;
const MAX_WRONG = 3;
const LOCK_MS = 5 * 60_000;
const SEND_DELAY_MS = 1200;

export function demoLinker(): PhoneLinker {
  let view: PhoneLink | null = null;
  // when each text went out, or will
  let sends: number[] = [];
  const code = () => String(Math.floor(Math.random() * 90) + 10);
  const send = (phone: string) => {
    const now = Date.now();
    const recent = sends.filter((at) => now - at < WINDOW_MS);
    if (recent.length >= MAX_SENDS) {
      view = { ...view!, status: "failed", failure: "provider_rejected", retryEligibleAt: null };
      return;
    }
    const at = Math.max(now, (sends.at(-1) ?? 0) + RETRY_MS);
    sends = [...recent, at];
    view = { status: "pending", phone, code: null, expiresAt: at + TTL_MS, retryEligibleAt: sends.length < MAX_SENDS ? at + RETRY_MS : null, failure: null, wrongReplies: 0 };
    setTimeout(() => { if (view?.status === "pending") view = { ...view, status: "sent", code: code() }; }, at - now + SEND_DELAY_MS);
  };
  const current = (): LinkResult => {
    if (!view) return { ok: false, kind: "other", message: "" };
    if ((view.status === "sent" || view.status === "uncertain") && Date.now() >= view.expiresAt) view = { ...view, status: "expired" };
    return { ok: true, view };
  };
  return {
    start: async (phone) => {
      send(`•••• ${phone.replace(/\D/g, "").slice(-4)}`);
      return current();
    },
    read: async () => current(),
    retry: async () => {
      if (view && view.retryEligibleAt !== null) send(view.phone);
      return current();
    },
    notify: async () => true,
    demo: {
      reply: () => { if (view) view = { ...view, status: "connected" }; },
      wrong: () => {
        if (!view) return;
        const wrongReplies = view.wrongReplies + 1;
        let next = code();
        while (next === view.code) next = code();
        view = wrongReplies >= MAX_WRONG ? { ...view, wrongReplies, status: "failed", failure: "too_many_wrong_replies", retryEligibleAt: Date.now() + LOCK_MS } : { ...view, wrongReplies, code: next };
      },
      fail: () => { if (view) view = { ...view, status: "failed", failure: "provider_rejected" }; },
    },
  };
}
