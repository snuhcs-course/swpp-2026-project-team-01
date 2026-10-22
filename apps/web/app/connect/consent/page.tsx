import { agentAuthorizeDependenciesFromEnvironment, type ConsentView, readConsent } from "@lib/server/agent-authorize";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";

// P10, the personal-agent consent page (agent-access design 7 and 8). It shows
// the client, where it returns to and the permissions it asked for, which the
// person can narrow, and posts Allow or Deny to /connect/decision as a plain
// form, so it works without scripts. A host resource needs the signed-in host;
// a requester resource needs no account and offers a new request with the
// displayed host or the person's existing request by its booking link.

// same-origin, not no-referrer: with no-referrer Chrome sends `Origin: null` on
// the form post, which the decision's same-origin check refuses.
export const metadata: Metadata = { referrer: "same-origin", robots: { follow: false, index: false }, title: "Connect an agent" };

type SearchParams = Promise<{ transaction?: string; problem?: string }>;

const PROBLEMS: Readonly<Record<string, string>> = {
  choice: "Choose whether to start a new request or connect one you already have.",
  link: "That booking link does not match an open request with this host. Check the link from your email.",
  scope: "Keep at least one permission checked, or choose Deny.",
  sign_in: "Sign in as the host to allow this connection.",
};

export default function Page({ searchParams }: { readonly searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="sr-only" role="status">Loading the connection request...</p>}>
      <Consent searchParams={searchParams} />
    </Suspense>
  );
}

async function Consent({ searchParams }: { readonly searchParams: SearchParams }) {
  await connection();
  const { transaction = "", problem } = await searchParams;
  const cookie = (await cookies())
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  const view = await readConsent(agentAuthorizeDependenciesFromEnvironment(), new Request("http://localhost/connect/consent", { headers: { cookie } }), transaction);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      {view.status === "unavailable" ? <Unavailable /> : <Open problem={problem ? (PROBLEMS[problem] ?? null) : null} view={view} />}
    </main>
  );
}

function Unavailable() {
  return (
    <>
      <h1 className="font-display text-3xl">This connection request is not available</h1>
      <p className="text-muted-foreground">
        It expired, was already answered or was opened in another browser. Nothing was connected. Start again from your agent.
      </p>
    </>
  );
}

const primary =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2";
const secondary =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2";

function Open({ problem, view }: { readonly problem: string | null; readonly view: Extract<ConsentView, { status: "open" }> }) {
  const signInHref = `/auth/sign-in?return=consent&transaction=${view.transactionId}`;

  if (view.role === "host" && view.signedIn !== "eligible") {
    return (
      <>
        <h1 className="font-display text-3xl">Sign in to connect {view.clientName}</h1>
        <p className="text-muted-foreground">
          {view.signedIn === "ineligible"
            ? "This host account cannot connect agents right now."
            : "An agent asked to work with your Find Me a Time account. Sign in as the host first; you will come back here to allow or deny it."}
        </p>
        {view.signedIn === "ineligible" ? null : (
          <a className={primary} href={signInHref}>
            Sign in with Google
          </a>
        )}
        <DenyOnly transactionId={view.transactionId} />
      </>
    );
  }

  return (
    <form action="/connect/decision" className="flex flex-col gap-6" method="post">
      <input name="transaction" type="hidden" value={view.transactionId} />
      <div>
        <h1 className="font-display text-3xl">
          {view.role === "host" ? `Connect ${view.clientName} to your account?` : `Let ${view.clientName} request a meeting for you?`}
        </h1>
        <p className="mt-2 text-muted-foreground">
          The agent calls itself <strong>{view.clientName}</strong> and returns to <strong>{view.redirectHost}</strong>.
        </p>
        {view.localOnly ? (
          <p className="mt-2 text-warning">
            It returns to a program on this device. Allow it only if you started the connection yourself, from a tool you trust.
          </p>
        ) : null}
      </div>

      {problem ? (
        <p className="text-destructive" role="alert">
          {problem}
        </p>
      ) : null}

      {view.host ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="font-medium">
            Host: <span className="font-normal">{view.host.displayName}</span> <span className="text-muted-foreground">({view.host.handle})</span>
          </legend>
          <label className="flex items-start gap-3">
            <input className="mt-1 size-4" defaultChecked name="choice" type="radio" value="new" />
            <span>Start a new request with {view.host.displayName}. The agent can create one request; its private link goes to your email.</span>
          </label>
          <label className="flex items-start gap-3">
            <input className="mt-1 size-4" name="choice" type="radio" value="existing" />
            <span>Connect a request I already have with this host.</span>
          </label>
          <label className="flex flex-col gap-1 pl-7">
            <span className="text-sm text-muted-foreground">Your booking link, only for an existing request</span>
            <input
              autoComplete="off"
              className="min-h-11 rounded-lg border border-border bg-background px-3"
              name="bookingLink"
              placeholder="https://findmeatime.com/booking/..."
              type="url"
            />
          </label>
        </fieldset>
      ) : null}

      <fieldset className="flex flex-col gap-3">
        <legend className="font-medium">It will be able to</legend>
        {view.scopes.map(({ description, scope }) => (
          <label className="flex items-start gap-3" key={scope}>
            <input className="mt-1 size-4" defaultChecked name="scope" type="checkbox" value={scope} />
            <span>
              {description} <span className="text-sm text-muted-foreground">({scope})</span>
            </span>
          </label>
        ))}
      </fieldset>

      <p className="text-sm text-muted-foreground">
        {view.role === "host"
          ? "Approving or declining a meeting always needs your own click in Find Me a Time. You can revoke this connection under Connected agents."
          : "The host still has to approve the meeting. You can revoke this connection from your booking page."}
      </p>

      <div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
        <button className={primary} name="decision" type="submit" value="allow">
          Allow
        </button>
        <button className={secondary} name="decision" type="submit" value="deny">
          Deny
        </button>
      </div>
    </form>
  );
}

function DenyOnly({ transactionId }: { readonly transactionId: string }) {
  return (
    <form action="/connect/decision" method="post">
      <input name="transaction" type="hidden" value={transactionId} />
      <button className={secondary} name="decision" type="submit" value="deny">
        Deny
      </button>
    </form>
  );
}
