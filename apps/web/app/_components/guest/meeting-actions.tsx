"use client";

import { useRef, useState } from "react";
import type { CommandOutcome } from "@/app/_components/requester/cards";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// The same two visible tabs follow a sent request into its booked meeting.
// The requester command changes with the request state; navigation never
// silently withdraws a request or cancels a meeting.
export type MeetingActionMode = "pending" | "booking" | "booked" | "changing";

export function MeetingActions({
  bookingId,
  mode,
  revision,
  standingBooking = false,
}: {
  readonly bookingId: string;
  readonly mode: MeetingActionMode;
  readonly revision: number;
  readonly standingBooking?: boolean;
}) {
  const [busy, setBusy] = useState<"change" | "cancel" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const retryKeys = useRef(new Map<string, string>());

  const cancellingMeeting = mode === "booked" || standingBooking;
  const changeOperation = mode === "booked" ? "booking.change" : "request.change_agreement";
  const cancelOperation = cancellingMeeting ? "booking.cancel" : "request.withdraw";

  async function run(operation: "booking.change" | "booking.cancel" | "request.change_agreement" | "request.withdraw") {
    const retryKey = retryKeys.current.get(operation) ?? crypto.randomUUID();
    retryKeys.current.set(operation, retryKey);
    try {
      const response = await fetch(`/api/requests/${bookingId}/commands`, {
        body: JSON.stringify({ expectedRevision: revision, input: {}, operation, retryKey }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body: unknown = await response.json();
      if (
        !body || typeof body !== "object" || !("ok" in body)
        || (body.ok !== true && (body.ok !== false || !("error" in body) || !body.error || typeof body.error !== "object"))
      ) {
        setError(response.status === 404 ? "This booking link is no longer available." : "That action could not be confirmed. Try again.");
        return;
      }
      const outcome = body as CommandOutcome;
      retryKeys.current.delete(operation);
      if (outcome.ok || outcome.error.category === "request_closed" || outcome.error.category === "stale_revision") {
        window.location.reload();
        return;
      }
      setError(outcome.error.message);
    } catch {
      // Keep the key: a lost response may follow a committed command. Retrying
      // the same operation must replay its result instead of running it twice.
      setError("We could not confirm whether that went through. Check the meeting, then try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="flex items-end gap-1" data-guest-meeting-actions>
        <Button
          className="meeting-action-tab meeting-action-tab-change"
          disabled={busy !== null || mode === "booking"}
          onClick={() => {
            setError(null);
            if (mode === "changing") {
              document.querySelector<HTMLTextAreaElement>("[data-chat-composer-input]")?.focus();
              return;
            }
            setBusy("change");
            void run(changeOperation);
          }}
          type="button"
          variant="ghost"
        >
          <span>{busy === "change" ? "Opening…" : "Change meeting"}</span>
        </Button>
        <Button
          className="meeting-action-tab meeting-action-tab-cancel"
          disabled={busy !== null || mode === "booking"}
          onClick={() => { setError(null); setConfirming(true); }}
          ref={cancelRef}
          type="button"
          variant="ghost"
        >
          <span>Cancel meeting</span>
        </Button>
      </div>
      {error && !confirming ? <p className="pb-2 text-sm text-destructive" role="alert">{error}</p> : null}
      <Dialog onOpenChange={setConfirming} open={confirming}>
        <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); cancelRef.current?.focus(); }}>
          <DialogHeader>
            <DialogTitle>{cancellingMeeting ? "Cancel this booked meeting?" : "Withdraw this meeting request?"}</DialogTitle>
            <DialogDescription>{cancellingMeeting
              ? "The meeting will be cancelled and the host will be notified. You can’t undo this."
              : "The request will be withdrawn before booking. You can’t undo this."}</DialogDescription>
          </DialogHeader>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <DialogFooter>
            <DialogClose asChild><Button disabled={busy !== null} type="button" variant="outline">Keep meeting</Button></DialogClose>
            <Button
              disabled={busy !== null}
              onClick={() => { setError(null); setBusy("cancel"); void run(cancelOperation); }}
              type="button"
              variant="destructive"
            >
              {busy === "cancel" ? "Cancelling…" : cancellingMeeting ? "Cancel meeting" : "Withdraw request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
