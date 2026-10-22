import { type BookingReceipt, personLine } from "@lib/contracts/booking";
import { displayTime } from "@lib/contracts/timezone";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

// The confirmed booking's receipt (host-review-and-booking design 10; cal.diy's
// success card for presentation only): the Confirmed badge, then What, When
// with the duration and the zone named, Who with the actual Calendar organizer,
// Where, and **Join meeting** for an online meeting. **Open in Google Calendar**
// appears only on the host's copy. Built from the confirmed event's evidence,
// never shown before confirmation.

function Rows({ rows }: { readonly rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1">
      {rows.map(([term, value]) => (
        <div className="contents" key={term}>
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Receipt({ receipt, timeZone }: { readonly receipt: BookingReceipt; readonly timeZone: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p>
        <span className="inline-block rounded-full border border-foreground px-2.5 py-0.5 text-xs font-medium">Confirmed</span>
      </p>
      <Rows
        rows={[
          ["What", receipt.title],
          [
            "When",
            `${displayTime(new Date(receipt.start), timeZone)} to ${displayTime(new Date(receipt.end), timeZone).split(", ")[1]} (${receipt.durationMinutes} minutes, ${timeZone})`,
          ],
          [
            "Who",
            <>
              {personLine(receipt.organizer.name, receipt.organizer.email) || "Organizer"} (organizer)
              <br />
              {personLine(receipt.requester.name, receipt.requester.email)} (guest)
            </>,
          ],
          ["Where", receipt.mode === "in_person" ? (receipt.location ?? "") : "Online"],
        ]}
      />
      <div className="flex flex-wrap items-center gap-2">
        {receipt.joinUrl ? (
          <Button asChild>
            <a href={receipt.joinUrl} rel="noreferrer" target="_blank">
              Join meeting
            </a>
          </Button>
        ) : null}
        {receipt.calendarUrl ? (
          <Button asChild variant="outline">
            <a href={receipt.calendarUrl} rel="noreferrer" target="_blank">
              Open in Google Calendar
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

