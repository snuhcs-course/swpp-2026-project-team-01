import type { BookingStatusView } from "@lib/contracts/booking";
import type { RequestState } from "@lib/contracts/request";
import { findRequestByBookingId } from "@lib/server/booking-links";
import { database } from "@lib/server/database";
import { openGuestSession } from "@lib/server/guest-conversations";
import { readRequesterView, requesterRouteDependenciesFromEnvironment } from "@lib/server/requester-routes";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Receipt } from "@/app/_components/booking-receipt";
import { GuestWorkspace } from "@/app/_components/guest/guest-workspace";
import { ResendLinkForm } from "@/app/_components/requester/resend-link-form";

// The requester's protected destination (design decision 2; meeting-requests:
// protected request continuation). The identifier is the only credential: it is
// looked up by hash, and a malformed, unknown or expired one gets the generic
// unavailable view with **Resend my booking link** and nothing else, as does a
// draft, whose thread lives only in the tab that started it on the public page
// until the guest is identified. A closed request with an unexpired link shows
// only its status and, once booked, the confirmed receipt. Otherwise it is the guest thread, the same one the public
// page began, loaded from its stored events. next.config.ts sends
// no-referrer, noindex and no-store for every /booking path, and nothing here
// logs the path.
type Params = Promise<{ bookingId: string }>;

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { follow: false, index: false },
  title: "Your meeting request",
};

export default function Page({ params }: { readonly params: Params }) {
  return (
    <Suspense fallback={<p className="sr-only" role="status">Loading your request...</p>}>
      <Booking params={params} />
    </Suspense>
  );
}

async function Booking({ params }: { readonly params: Params }) {
  await connection();
  const { bookingId } = await params;
  const db = database();
  const link = await findRequestByBookingId(db, bookingId);
  const view = link && !link.expired ? await readRequesterView(db, link.requestId) : null;

  if (!link || !view || (view.open && view.request.state === "draft")) return <Unavailable />;
  if (!view.open) {
    return <Closed booking={view.booking} hostName={view.host.displayName} state={view.request.state} timezone={view.timezone} />;
  }

  // Opens the request session if a request from before D13 has none yet (and
  // delivers its intake summary); the page still renders when the agent is
  // unreachable.
  try {
    await openGuestSession(requesterRouteDependenciesFromEnvironment(), { id: link.requestId, type: "requester_request" });
  } catch (error) {
    console.error(JSON.stringify({ error: error instanceof Error ? error.name : typeof error, event: "requester_session_unavailable" }));
  }

  return <GuestWorkspace bookingId={bookingId.toLowerCase()} host={view.host} initialView={view} />;
}

function Unavailable() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-6 px-4 py-16">
      <section aria-labelledby="unavailable-title" className="flex flex-col gap-2">
        <h1 className="font-display text-3xl leading-tight" id="unavailable-title">
          This booking link is not available
        </h1>
        <p>Use the private request link from your email. If you lost it, we can send it again.</p>
      </section>
      <ResendLinkForm heading="Resend my booking link" />
    </main>
  );
}

const CLOSED_TEXT: Readonly<Partial<Record<RequestState, string>>> = {
  booked: "This meeting is booked. Check your calendar for the details.",
  declined: "The host declined this request.",
  expired: "This request expired before a time was agreed and booked.",
  withdrawn: "You withdrew this request.",
};

function Closed({
  booking,
  hostName,
  state,
  timezone,
}: {
  readonly booking: BookingStatusView | null;
  readonly hostName: string;
  readonly state: RequestState;
  readonly timezone: string;
}) {
  const receipt = state === "booked" ? booking?.receipt : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 px-4 py-16">
      <div className="flex flex-col gap-2">
        <p className="font-medium text-muted-foreground text-sm">Meeting request with {hostName}</p>
        <h1 className="font-display text-3xl leading-tight">{receipt ? "Your meeting is booked" : "This request is closed"}</h1>
        <p role="status">
          {receipt ? "It is in the calendar. Google Calendar sends the invitation." : (CLOSED_TEXT[state] ?? "This request is no longer active.")}
        </p>
      </div>
      {receipt ? (
        <section aria-label="Booking" className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
          <Receipt receipt={receipt} timeZone={timezone} />
        </section>
      ) : null}
    </main>
  );
}
