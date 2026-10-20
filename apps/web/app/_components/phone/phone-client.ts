import {
  type NotifyChannel,
  type PhoneLink,
  phoneLinkReadSchema,
  phoneLinkSchema,
} from "@lib/contracts/phone-link";

// Browser access to the phone check (lib/contracts/phone-link.ts). Every action
// sends a fresh retry key in Idempotency-Key, so the server replays a resent tap
// instead of texting twice.

export type LinkResult =
  | { readonly ok: true; readonly view: PhoneLink }
  | { readonly ok: false; readonly kind: "invalid" | "taken" | "other" };

const URL = "/api/host/imessage/connection";

async function post(url: string, body: unknown) {
  return fetch(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    method: "POST",
  });
}

async function answer(response: Response): Promise<LinkResult> {
  const body = (await response.json().catch(() => null)) as unknown;

  if (response.ok) {
    const view = phoneLinkSchema.safeParse(body);
    return view.success ? { ok: true, view: view.data } : { kind: "other", ok: false };
  }

  const failure = body as { category?: string; reason?: string } | null;
  if (failure?.reason === "phone_taken") return { kind: "taken", ok: false };
  if (failure?.category === "invalid_input" && !failure.reason) return { kind: "invalid", ok: false };
  return { kind: "other", ok: false };
}

async function attempt(work: () => Promise<LinkResult>): Promise<LinkResult> {
  try {
    return await work();
  } catch {
    return { kind: "other", ok: false };
  }
}

export const phoneLinker = {
  notify: async (channel: NotifyChannel) => {
    try {
      return (await post("/api/host/imessage/notify", { channel })).ok;
    } catch {
      return false;
    }
  },
  read: () =>
    attempt(async () => {
      const response = await fetch(URL, { cache: "no-store" });
      const body = phoneLinkReadSchema.safeParse(await response.json().catch(() => null));
      return response.ok && body.success && body.data.connection
        ? { ok: true, view: body.data.connection }
        : { kind: "other", ok: false };
    }),
  retry: () => attempt(async () => answer(await post(`${URL}/retry`, {}))),
  start: (phone: string) => attempt(async () => answer(await post(URL, { phone }))),
};

export type PhoneLinker = typeof phoneLinker;
