"use client";
import { useEffect, useState } from "react";
import type { ConnectLinkView } from "@lib/server/connect-link-routes";
import { PendingCode, TELEGRAM_PRIVACY, WHATSAPP_OPT_IN, useMessagesPlatform } from "@/app/_components/imessage/imessage-card";
import { Button } from "@/components/ui/button";

const CLOSED = "This link is no longer open. Ask your agent to start again.";
export function LinkCard({ initial, token }: { readonly initial: ConnectLinkView; readonly token: string }) {
  const [view, setView] = useState<ConnectLinkView | { state: "linked" }>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const platform = useMessagesPlatform();
  // The code's expiry is shown in the browser's own locale and time zone, which
  // the server cannot know, so the pending code renders only after mounting.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (view.state !== "open") return;
    const controller = new AbortController();
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/connect/link/${token}/status`, { cache: "no-store", signal: controller.signal });
        if (response.ok) {
          const next: ConnectLinkView = await response.json();
          setView(current => current.state === "open" ? next : current);
        }
        else setError("Status could not be loaded. Try again.");
      } catch {
        if (!controller.signal.aborted) setError("Status could not be loaded. Try again.");
      }
    }, 3000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [token, view.state]);
  async function act(action: "confirm" | "cancel") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/connect/link/${token}/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, retryKey: crypto.randomUUID() }) });
      const result = await response.json();
      if (response.ok) setView({ state: result.state });
      else setError(result.error ?? "Could not finish. Try again.");
    } catch { setError("The answer was lost. Reload to check the link."); }
    finally { setBusy(false); }
  }
  if (view.state === "closed") return <p role="status">{CLOSED}</p>;
  if (view.state === "linked") return <p role="status">Linked. You can go back to your agent.</p>;
  if (view.state === "sign_in") return <><h1>Sign in to link your chat</h1><Button asChild><a href={`/auth/sign-in?return=link&token=${encodeURIComponent(token)}`}>Sign in with Google</a></Button></>;
  const notice = error ? <p role="alert">{error}</p> : null;
  if (view.status.state === "pending") return !mounted ? <p role="status">Loading the link…</p> : <PendingCode busy={busy} notice={notice} onCancel={() => void act("cancel")} platform={platform} status={{ ...view.status, channels: { imessage: null, whatsapp: null, telegram: null } }} switchers={null} />;
  return <section className="flex flex-col gap-4"><h1>Is this you?</h1>{notice}<p>Sent from <strong>{view.status.sender}</strong></p>{"replaces" in view.status && view.status.replaces ? <p>This replaces your {view.status.replaces} link.</p> : null}{view.status.channel === "whatsapp" ? <p>{WHATSAPP_OPT_IN}</p> : null}{view.status.channel === "telegram" ? <p>{TELEGRAM_PRIVACY}</p> : null}<Button disabled={busy} onClick={() => void act("confirm")}>Confirm and link</Button><Button disabled={busy} variant="outline" onClick={() => void act("cancel")}>Cancel</Button></section>;
}
