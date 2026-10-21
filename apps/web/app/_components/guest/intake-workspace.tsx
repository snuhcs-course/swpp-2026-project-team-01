"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ResendLinkForm } from "@/app/_components/requester/resend-link-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { guestDiscussionClient } from "@/lib/chat/guest";
import { GuestCard, GuestCardActions } from "./guest-card";
import { GuestConversation } from "./guest-conversation";
import { browserLanguage, TimezoneLine, useGuestTimezone } from "./timezone";

// The public host page's intake (design decision 2): the host's public identity,
// the conversation with Thyme under an anonymous intake, the guest identity card
// and the timezone line. The intake token the first message creates is kept in
// sessionStorage for this tab only and sent in a header, never in a URL.
// Continuing with or without Google creates the request, and the browser
// replaces this page with the booking link.

function tokenKey(handle: string) {
  return `fmat.intake:${handle}`;
}

function readToken(handle: string) {
  try {
    return window.sessionStorage.getItem(tokenKey(handle));
  } catch {
    return null;
  }
}

function writeToken(handle: string, token: string | null) {
  try {
    if (token) window.sessionStorage.setItem(tokenKey(handle), token);
    else window.sessionStorage.removeItem(tokenKey(handle));
  } catch {
    // Without storage the intake lasts for this page view only.
  }
}

const GOOGLE_NOTICES: Readonly<Record<string, string>> = {
  cancelled: "Google sign-in was cancelled. Your conversation is still here; continue with or without Google.",
  limited: "Too many new requests from your network right now. Try again later.",
};

export function IntakeWorkspace({
  agentSection,
  displayName,
  handle,
}: {
  readonly agentSection: React.ReactNode;
  readonly displayName: string;
  readonly handle: string;
}) {
  const tokenRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const timezone = useGuestTimezone();

  useEffect(() => {
    tokenRef.current = readToken(handle);
    const google = new URLSearchParams(window.location.search).get("google");
    if (google) {
      setNotice(GOOGLE_NOTICES[google] ?? null);
      window.history.replaceState(null, "", window.location.pathname);
    }
    setReady(true);
  }, [handle]);

  const client = useMemo(
    () =>
      guestDiscussionClient(`/api/intake/${handle}`, (): Record<string, string> =>
        tokenRef.current ? { "x-intake-token": tokenRef.current } : {},
      ),
    [handle],
  );

  const onAccepted = useCallback(
    (outcome: { intakeToken?: string }) => {
      if (outcome.intakeToken) {
        tokenRef.current = outcome.intakeToken;
        writeToken(handle, outcome.intakeToken);
      }
    },
    [handle],
  );

  // An intake that ended (expired, or continued in another tab) is forgotten,
  // so the next message starts a new one.
  const onError = useCallback(
    (error: unknown) => {
      if ((error as { code?: string }).code !== "closed") return;
      tokenRef.current = null;
      writeToken(handle, null);
    },
    [handle],
  );

  const extra = useCallback(() => ({ language: browserLanguage(), timezone: timezone.zone }), [timezone.zone]);

  const intro = (
    <div className="flex flex-col gap-4 pb-2">
      <section className="flex flex-col gap-1">
        <p className="font-medium text-muted-foreground text-sm">Find Me a Time host</p>
        <h1 className="break-words font-display text-[clamp(28px,4vw,40px)] leading-tight">{displayName}</h1>
        <p className="font-mono text-muted-foreground">@{handle}</p>
      </section>
      <p>
        Requests are accepted here, and you do not need an account. Tell Thyme what the meeting is about, then continue
        with or without Google. Thyme offers times once your request exists.
      </p>
      {notice ? (
        <p className="rounded-xl border border-border bg-card p-3 text-sm" role="status">
          {notice}
        </p>
      ) : null}
      {agentSection}
      <details className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">Already made a request?</summary>
        <div className="pt-3">
          <ResendLinkForm heading="Lost your booking link?" />
        </div>
      </details>
    </div>
  );

  if (!ready) return <p className="sr-only" role="status">Loading...</p>;

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <GuestConversation
        ariaLabel={`Request a meeting with ${displayName}`}
        before={intro}
        card={
          <IdentityCard
            handle={handle}
            onToken={onAccepted}
            timezone={timezone.zone}
            token={() => tokenRef.current}
          />
        }
        client={client}
        composerFooter={<TimezoneLine onChoose={timezone.choose} zone={timezone.zone} />}
        extra={extra}
        onAccepted={onAccepted}
        onError={onError}
        placeholder="Tell Thyme about the meeting"
      />
    </div>
  );
}

// The guest identity card: Continue with Google (identity and, optionally,
// read-only Calendar on one Google screen) or Continue without Google with a
// name and email. The Google button is always shown.
function IdentityCard({
  handle,
  onToken,
  timezone,
  token,
}: {
  readonly handle: string;
  readonly onToken: (outcome: { intakeToken?: string }) => void;
  readonly timezone: string;
  readonly token: () => string | null;
}) {
  const id = useId();
  const [manual, setManual] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function continueWithoutGoogle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!name.trim() || !email.trim()) {
      setError("Enter your name and email address.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const current = token();
      const response = await fetch(`/api/intake/${handle}/continue`, {
        body: JSON.stringify({ email: email.trim(), language: browserLanguage(), name: name.trim(), timezone }),
        headers: { "content-type": "application/json", ...(current ? { "x-intake-token": current } : {}) },
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as { bookingId?: string; error?: string; intakeToken?: string };
      onToken(body);

      if (response.ok && body.bookingId) {
        writeToken(handle, null);
        window.location.replace(`/booking/${body.bookingId}`);
        return;
      }

      setError(
        response.status === 400
          ? "Enter your name and a valid email address."
          : (body.error ?? "That did not go through. Try again in a moment."),
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
      <form action="/connections/google/start" method="post" ref={formRef}>
        <input name="purpose" type="hidden" value="intake" />
        <input name="handle" type="hidden" value={handle} />
        <input name="timezone" type="hidden" value={timezone} />
        <input name="language" type="hidden" value={browserLanguage()} />
        <input name="intakeToken" type="hidden" value="" />
        <GuestCardActions>
          <Button
            className="min-h-11"
            onClick={() => {
              const field = formRef.current?.elements.namedItem("intakeToken") as HTMLInputElement | null;
              if (field) field.value = token() ?? "";
            }}
            type="submit"
          >
            Continue with Google
          </Button>
          {!manual ? (
            <Button className="min-h-11" onClick={() => setManual(true)} type="button" variant="outline">
              Continue without Google
            </Button>
          ) : null}
        </GuestCardActions>
      </form>
      {manual ? (
        <form className="flex flex-col gap-2" noValidate onSubmit={continueWithoutGoogle}>
          <div className="flex flex-col gap-1">
            <label className="font-medium" htmlFor={`${id}-name`}>
              Your name
            </label>
            <Input autoComplete="name" className="min-h-11" id={`${id}-name`} onChange={(event) => setName(event.target.value)} value={name} />
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
          <p className="text-muted-foreground">We email you a private booking link. Confirming the address is optional.</p>
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
