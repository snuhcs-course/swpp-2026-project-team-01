import type { BookingStatusView } from "@lib/contracts/booking";
import type { RequestState } from "@lib/contracts/request";
import { findRequestByBookingId } from "@lib/server/booking-links";
import { database } from "@lib/server/database";
import { openGuestSession } from "@lib/server/guest-conversations";
import { signedInGuestAccount } from "@lib/server/guest-account-session";
import { readRequesterView, requesterRouteDependenciesFromEnvironment } from "@lib/server/requester-routes";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { Receipt } from "@/app/_components/booking-receipt";
import { BookedWorkspace } from "@/app/_components/guest/booked-workspace";
import { CLOSED_TEXT } from "@/app/_components/guest/composer-state";
import { GuestWorkspace } from "@/app/_components/guest/guest-workspace";
import { ClosedImessageUpdates } from "@/app/_components/requester/cards";
import { ResendLinkForm } from "@/app/_components/requester/resend-link-form";

// The requester's protected destination (design decision 2; meeting-requests:
// protected request continuation). The identifier is the only credential: it is
// looked up by hash, and a malformed, unknown or expired one gets the generic
// unavailable view with **Resend my booking link** and nothing else, as does a
// draft, whose thread lives only in the tab that started it on the public page
// until the guest is identified. A booked meeting keeps its conversation with
// the confirmed receipt, so a guest who linked no messenger can cancel or start a
// change in words on the web (post-booking-changes, #329); any other closed
// request with an unexpired link shows only its status. Otherwise it is the guest thread, the same one the public
// page began, loaded from its stored events. next.config.ts sends noindex and
// no-store for every /booking path, and nothing here logs the path. The
// referrer is same-origin, not no-referrer: with no-referrer Chrome sends
// `Origin: null` on the Connect Google Calendar form post, which the start
// route's same-origin check refuses; the link still never leaves the origin.
type Params = Promise<{ bookingId: string }>;

export const metadata: Metadata = {
  referrer: "same-origin",
  robots: { follow: false, index: false },
  title: "Your meeting request",
};

// The booking link is the guest's credential; resolve it for every request.
export const instant = false;

export default async function Page({ params }: { readonly params: Params }) {
  await connection();
  return (
    <Suspense fallback={<p className="sr-only" role="status">Loading your request...</p>}>
      <Booking params={params} />
    </Suspense>
  );
}

async function Booking({ params }: { readonly params: Params }) {
  const { bookingId } = await params;
  const db = database();
  const link = await findRequestByBookingId(db, bookingId);
  const view = link && !link.expired ? await readRequesterView(db, link.requestId) : null;

  if (!link || !view || (view.open && view.request.state === "draft")) return <Unavailable />;
  // A signed-in account on its own linked request gets the way back to /app;
  // the session adds no authority here, the link stays the credential.
  const workspaceLink = async () => (await signedInGuestAccount(await cookies(), { requestId: link.requestId }))?.linked ?? false;

  if (!view.open && view.request.state === "booked" && view.conversation && typeof view.request.revision === "number") {
    return (
      <BookedWorkspace
        bookingId={bookingId.toLowerCase()}
        host={view.host}
        receipt={view.booking?.receipt ?? null}
        revision={view.request.revision}
        timezone={view.timezone}
        workspaceLink={await workspaceLink()}
      />
    );
  }
  if (!view.open) {
    return <Closed bookingId={bookingId.toLowerCase()} booking={view.booking} groupFull={view.groupFull === true} hostName={view.host.displayName} state={view.request.state} timezone={view.timezone} />;
  }

  // Opens the request session if a request from before D13 has none yet (and
  // delivers its intake summary); the page still renders when the agent is
  // unreachable.
  try {
    await openGuestSession(requesterRouteDependenciesFromEnvironment(), { id: link.requestId, type: "requester_request" });
  } catch (error) {
    console.error(JSON.stringify({ error: error instanceof Error ? error.name : typeof error, event: "requester_session_unavailable" }));
  }

  return <GuestWorkspace bookingId={bookingId.toLowerCase()} host={view.host} initialView={view} workspaceLink={await workspaceLink()} />;
}

function Unavailable() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-6 px-4 py-16">
      <section aria-labelledby="unavailable-title" className="flex flex-col gap-2">
        <h1 className="font-display text-[clamp(36px,5vw,52px)] leading-[1.05]" id="unavailable-title">
          This booking link is not available
        </h1>
        <p>Use the private request link from your email. If you lost it, we can send it again.</p>
      </section>
      <ResendLinkForm heading="Resend my booking link" />
    </main>
  );
}

function Closed({
  bookingId,
  booking,
  groupFull,
  hostName,
  state,
  timezone,
}: {
  readonly bookingId: string;
  readonly booking: BookingStatusView | null;
  // A group meeting's participant whose group closed before they were done.
  readonly groupFull: boolean;
  readonly hostName: string;
  readonly state: RequestState;
  readonly timezone: string;
}) {
  const receipt = state === "booked" ? booking?.receipt : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 px-4 py-16">
      <div className="flex flex-col gap-2">
        <p className="font-medium text-muted-foreground text-sm">Meeting request with {hostName}</p>
        <h1 className="font-display text-[clamp(36px,5vw,52px)] leading-[1.05]">{receipt ? "Your meeting is booked" : "This request is closed"}</h1>
        <p role="status">
          {receipt
            ? "It is in the calendar. Google Calendar sends the invitation."
            : groupFull
              ? "This group meeting filled up, or the host closed it, before your answers were in."
              : (CLOSED_TEXT[state] ?? "This request is no longer active.")}
        </p>
      </div>
      {receipt ? (
        <section aria-label="Booking" className="rounded-3xl bg-card px-5 py-4 text-sm">
          <Receipt receipt={receipt} timeZone={timezone} />
        </section>
      ) : null}
      <ClosedImessageUpdates bookingId={bookingId} timezone={timezone} />
    </main>
  );
}
