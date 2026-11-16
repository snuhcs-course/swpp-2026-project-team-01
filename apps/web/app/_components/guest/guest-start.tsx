"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { SlidersHorizontalIcon } from "lucide-react";
import { InkStage, Brand, CopyButton } from "@/app/_components/ink/chrome";
import { COPY } from "@/app/_components/ink/copy";
import { ResendLinkForm } from "@/app/_components/requester/resend-link-form";
import { AuthoredMessages, useAuthoredMessageReveal } from "@/app/_components/setup/authored-messages";
import { ChatComposer } from "@/components/chat/composer";
import { ChatConversation, ChatConversationContent, ChatItem } from "@/components/chat/conversation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GuestCard, GuestCardActions } from "./guest-card";
import { COMPOSER_LOCKED, GuestFrame, openingMessages, RequestPanel } from "./guest-frame";
import { browserLanguage, TimezoneLine, useGuestTimezone } from "./timezone";

// A ready host's booking link, /{handle} (guest-flow-completion U6 to U8).
//
// It opens on an ink landing that names whose link it is, with two starts:
// **Continue with web** and **Start with agent** (the guest's own AI agent reads
// /{handle}/SKILL.md or connects to /{handle}/mcp). Resending a booking link is
// a secondary link under them; the page offers no email start (U20).
//
// **Continue with web** opens a chat-only screen, styled like the host
// onboarding: two fixed messages from the host's assistant (a greeting, then a
// request to connect the Google account and Calendar for a quick and exact
// booking) and the identity card under them. No model runs and nothing is
// written until the guest presses a button there. Either button then runs
// request.start, which writes a hidden draft under the tab's nonce; **Continue
// with Google** takes it through the Google consent, whose return identifies
// it, and **Continue without Google** identifies it with a name and email. The
// guest continues on /booking/{bookingId}. A cancelled consent returns here to
// the web start, and trying again reuses the same draft.
//
// A signed-in account (host-as-guest-session, #183) is recognized: on another
// host's link the landing says so and offers **Continue your request** when the
// account already has an open request there, and the identity card offers
// **Continue as {name}**, which identifies the draft with the account's name
// and Google-verified address (request.identify_account) without another
// account. On the account's own link the landing says it is theirs.

// The signed-in account as the booking link sees it; null for anyone else.
export type GuestVisitor = {
  readonly name: string;
  readonly ownLink: boolean;
  readonly openRequestPath: string | null;
};

const GOOGLE_NOTICES: Readonly<Record<string, string>> = {
  cancelled: "Google sign-in was cancelled. Nothing was changed; continue with or without Google.",
};

function nonceKey(handle: string) {
  return `fmat.start-nonce:${handle}`;
}

function storedNonce(handle: string, fresh = false) {
  try {
    const kept = fresh ? null : window.sessionStorage.getItem(nonceKey(handle));
    if (kept) return kept;
    const nonce = crypto.randomUUID();
    window.sessionStorage.setItem(nonceKey(handle), nonce);
    return nonce;
  } catch {
    return crypto.randomUUID();
  }
}

type StartOutcome = { readonly ok: true; readonly bookingId: string } | { readonly ok: false; readonly message: string };

// request.start under the tab's nonce: the same draft on a second try. A nonce
// whose draft is gone (deleted after a day) is replaced once.
async function startDraft(handle: string, timezone: string): Promise<StartOutcome> {
  for (const fresh of [false, true]) {
    try {
      const response = await fetch("/api/requests/start", {
        body: JSON.stringify({ handle, language: browserLanguage(), nonce: storedNonce(handle, fresh), timezone }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as { bookingId?: string; code?: string; error?: string };
      if (response.ok && body.bookingId) return { bookingId: body.bookingId, ok: true };
      if (body.code === "rate_limited") return { message: body.error ?? "Too many new requests right now. Try again later.", ok: false };
    } catch {
      return { message: "That did not go through. Try again.", ok: false };
    }
  }
  return { message: "This page is not taking requests right now.", ok: false };
}

export function GuestStart({
  host,
  visitor = null,
}: {
  readonly host: { readonly displayName: string; readonly handle: string };
  readonly visitor?: GuestVisitor | null;
}) {
  const [web, setWeb] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // A Google return lands on the web start, with its notice.
  useEffect(() => {
    const google = new URLSearchParams(window.location.search).get("google");
    if (!google) return;
    setWeb(true);
    setNotice(GOOGLE_NOTICES[google] ?? null);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const account = visitor && !visitor.ownLink ? visitor : null;
  if (web) return <WebStart account={account} host={host} notice={notice} />;
  return <BookingLanding host={host} onWeb={() => setWeb(true)} visitor={visitor} />;
}

function BookingLanding({
  host,
  onWeb,
  visitor,
}: {
  readonly host: { readonly displayName: string; readonly handle: string };
  readonly onWeb: () => void;
  readonly visitor: GuestVisitor | null;
}) {
  const [agent, setAgent] = useState(false);
  const prompt = useRef<HTMLPreElement>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const agentText = `Book a meeting with ${host.displayName} for me: read ${origin}/${host.handle}/SKILL.md`;

  return (
    <InkStage locale="en">
      <div className="inner" data-screen="booking-landing">
        <header className="top">
          <Brand />
        </header>
        <main className="handoff">
          <p className="lede small">Booking link</p>
          <h1>{host.displayName}</h1>
          <p className="lede">
            Book a meeting with {host.displayName} (@{host.handle}).{" "}
            {visitor?.ownLink
              ? null
              : visitor
                ? `You're signed in as ${visitor.name}, so you can book with the same account.`
                : "You need no account."}
          </p>
          {visitor?.ownLink ? (
            <p className="lede small" role="note">
              This is your own booking link; guests see this page.{" "}
              <a className="underline underline-offset-4" href="/app">
                Back to your workspace
              </a>
            </p>
          ) : null}
          <div className="start">
            {visitor?.openRequestPath ? (
              <a className="primary-btn" href={visitor.openRequestPath}>
                Continue your request
              </a>
            ) : null}
            <button className={visitor?.openRequestPath ? "secondary-btn" : "primary-btn"} onClick={onWeb} type="button">
              {visitor?.openRequestPath ? "Start a new request" : "Continue with web"}
            </button>
            <button aria-expanded={agent} className="secondary-btn" onClick={() => setAgent((open) => !open)} type="button">
              Start with agent
            </button>
          </div>
          <section aria-labelledby="agent-section-heading" className="agent-start">
            <p className="or" id="agent-section-heading">
              For AI agents
            </p>
            {agent ? (
              <div className="prompt">
                <div className="prompt-head">
                  <span className="prompt-label">prompt</span>
                  <CopyButton className="prompt-copy" fallbackTarget={prompt} labels={COPY.en.copy} text={agentText} />
                </div>
                <pre aria-label="Prompt for your AI agent" className="prompt-body" ref={prompt} tabIndex={0}>
                  {agentText}
                </pre>
              </div>
            ) : null}
            <p className="agent-note">
              {agent ? "Paste it into the AI agent you use. " : null}Plain-text instructions for agents are at{" "}
              <a href={`/${host.handle}/SKILL.md`}>/{host.handle}/SKILL.md</a>; reading them installs no tools and grants no access. A
              personal agent connects through the MCP server at /{host.handle}/mcp once you allow it.
            </p>
          </section>
          <div className="alt">
            <details>
              <summary className="link-btn faint">Already made a request?</summary>
              <ResendLinkForm heading="Lost your booking link?" />
            </details>
            <p>
              <a href="/privacy">How we handle your data</a>
            </p>
          </div>
        </main>
      </div>
    </InkStage>
  );
}

function WebStart({
  account,
  host,
  notice,
}: {
  readonly account: GuestVisitor | null;
  readonly host: { readonly displayName: string; readonly handle: string };
  readonly notice: string | null;
}) {
  const timezone = useGuestTimezone();
  const messages = useMemo(() => openingMessages(host.displayName), [host.displayName]);
  const reveal = useAuthoredMessageReveal(messages, `fmat.guest-opening.${host.handle}`, false);
  const panel = (
    <RequestPanel
      host={host}
      note={
        <a className="underline underline-offset-4" href="/privacy">
          How we handle your data
        </a>
      }
      timezone={<TimezoneLine onChoose={timezone.choose} zone={timezone.zone} />}
    />
  );

  return (
    <GuestFrame aside={panel} asideLabel={`Request with ${host.displayName}`}>
      <main aria-label={`Meeting request with ${host.displayName}`} className="flex min-h-0 flex-1 flex-col">
        <ChatConversation>
          <ChatConversationContent aria-label="Messages">
            <AuthoredMessages messages={reveal.visible} onTyped={reveal.onTyped} thinking={reveal.thinking} typingId={reveal.typingId} />
            {reveal.done ? (
              <ChatItem messageId="identity">
                <IdentityCard account={account} handle={host.handle} zone={timezone.zone} />
              </ChatItem>
            ) : null}
            {notice ? (
              <ChatItem messageId="notice">
                <p className="px-1 text-sm text-muted-foreground" role="status">
                  {notice}
                </p>
              </ChatItem>
            ) : null}
          </ChatConversationContent>
        </ChatConversation>
      </main>
      <div className="shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6">
        <div className="mx-auto w-full max-w-2xl px-4 sm:px-6">
          <ChatComposer
            autoFocus={false}
            disabled
            disabledReason={COMPOSER_LOCKED}
            footerEnd={
              <Button aria-label="Request actions" className="size-11 shrink-0 rounded-full" disabled size="icon" type="button" variant="secondary">
                <SlidersHorizontalIcon aria-hidden className="size-5" />
              </Button>
            }
            isBusy={false}
            onChange={() => {}}
            onStop={() => {}}
            onSubmit={() => {}}
            placeholder={COMPOSER_LOCKED}
            value=""
          />
        </div>
      </div>
    </GuestFrame>
  );
}

// **Continue with Google** (name and email, and optionally read-only Calendar,
// on one Google screen) or **Continue without Google** with a name and email.
function IdentityCard({
  account,
  handle,
  zone,
}: {
  readonly account: GuestVisitor | null;
  readonly handle: string;
  readonly zone: string;
}) {
  const id = useId();
  const google = useRef<HTMLFormElement>(null);
  const [bookingId, setBookingId] = useState("");
  const [manual, setManual] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The hidden form posts once it carries the draft's booking identifier.
  useEffect(() => {
    if (bookingId) google.current?.submit();
  }, [bookingId]);

  async function continueWithGoogle() {
    setBusy(true);
    setError(null);
    const started = await startDraft(handle, zone);
    if (started.ok) {
      setBookingId(started.bookingId);
      return;
    }
    setBusy(false);
    setError(started.message);
  }

  // **Continue as {name}**: the signed-in account's own name and verified
  // address, linked to the account; the account session stays as it is.
  async function continueAsAccount() {
    setBusy(true);
    setError(null);
    const started = await startDraft(handle, zone);

    if (!started.ok) {
      setBusy(false);
      setError(started.message);
      return;
    }

    try {
      const response = await fetch(`/api/requests/${started.bookingId}/commands`, {
        body: JSON.stringify({
          expectedRevision: null,
          input: { language: browserLanguage(), timezone: zone },
          operation: "request.identify_account",
          retryKey: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: { message?: string } } | null;

      if (body?.ok) {
        window.location.assign(`/booking/${started.bookingId}`);
        return;
      }

      setError(
        response.status === 401
          ? "You are no longer signed in. Continue with or without Google instead."
          : "That did not go through. Continue with or without Google, or try again in a moment.",
      );
    } catch {
      setError("That did not go through. Try again in a moment.");
    }
    setBusy(false);
  }

  async function continueWithoutGoogle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!name.trim() || !email.trim()) {
      setError("Enter your name and email address.");
      return;
    }

    setBusy(true);
    setError(null);
    const started = await startDraft(handle, zone);

    if (!started.ok) {
      setBusy(false);
      setError(started.message);
      return;
    }

    try {
      const response = await fetch(`/api/requests/${started.bookingId}/commands`, {
        body: JSON.stringify({
          expectedRevision: null,
          input: { email: email.trim(), language: browserLanguage(), name: name.trim(), timezone: zone },
          operation: "request.identify",
          retryKey: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: { category?: string; message?: string } } | null;

      if (body?.ok) {
        window.location.assign(`/booking/${started.bookingId}`);
        return;
      }

      setError(
        body?.error?.category === "invalid_input"
          ? "Enter your name and a valid email address."
          : (body?.error?.message ?? "That did not go through. Try again in a moment."),
      );
    } catch {
      setError("That did not go through. Try again in a moment.");
    }
    setBusy(false);
  }

  return (
    <GuestCard
      description="Continue with Google to fill in your name and email, and optionally let the service check your calendar privately. Or enter them yourself."
      id="guest-identity"
      label="Your details"
      title="How should the host reach you?"
    >
      <form action="/connections/google/start" method="post" ref={google}>
        <input name="purpose" type="hidden" value="request" />
        <input name="bookingId" type="hidden" value={bookingId} />
        <input name="timezone" type="hidden" value={zone} />
        <input name="language" type="hidden" value={browserLanguage()} />
      </form>
      {account ? (
        <p className="text-sm">
          You're signed in to Find Me a Time as {account.name}. Continue with that account's name and email; your own host
          settings and requests stay as they are.
        </p>
      ) : null}
      <GuestCardActions>
        {account ? (
          <Button className="min-h-11" disabled={busy} onClick={() => void continueAsAccount()} type="button">
            Continue as {account.name}
          </Button>
        ) : null}
        <Button
          className="min-h-11"
          disabled={busy}
          onClick={() => void continueWithGoogle()}
          type="button"
          variant={account ? "outline" : "default"}
        >
          Continue with Google
        </Button>
        {!manual ? (
          <Button className="min-h-11" disabled={busy} onClick={() => setManual(true)} type="button" variant="outline">
            Continue without Google
          </Button>
        ) : null}
      </GuestCardActions>
      <p className="text-muted-foreground text-sm">
        <a className="underline underline-offset-4" href="/privacy#calendar">
          How we use your calendar
        </a>
      </p>
      {manual ? (
        <form className="flex flex-col gap-2" noValidate onSubmit={(event) => void continueWithoutGoogle(event)}>
          <div className="flex flex-col gap-1">
            <label className="font-medium" htmlFor={`${id}-name`}>
              Your name
            </label>
            <Input
              autoComplete="name"
              autoFocus
              className="min-h-11"
              id={`${id}-name`}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-medium" htmlFor={`${id}-email`}>
              Email address
            </label>
            <Input
              aria-describedby={error ? `${id}-error` : undefined}
              aria-invalid={error ? true : undefined}
              autoComplete="email"
              className="min-h-11"
              id={`${id}-email`}
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              value={email}
            />
          </div>
          <p className="text-muted-foreground">
            We email you a private booking link. Confirming the address is optional. Without Google, times are found from the host's
            side only.
          </p>
          <GuestCardActions>
            <Button className="min-h-11" disabled={busy} type="submit">
              {busy ? "Continuing..." : "Continue without Google"}
            </Button>
          </GuestCardActions>
        </form>
      ) : null}
      <div aria-live="polite" role="status">
        {error ? (
          <p className="text-destructive" id={`${id}-error`}>
            {error}
          </p>
        ) : null}
      </div>
    </GuestCard>
  );
}
