"use client";

import { detectedTimeZone, isValidTimeZone, TIMEZONE_STORAGE_KEY, zoneLabel } from "@lib/contracts/timezone";
import { useCallback, useEffect, useId, useState } from "react";
import { TimezoneEditor } from "@/app/_components/setup/timezone-editor";
import { Button } from "@/components/ui/button";

// The guest timezone (design decision 15): the browser's IANA zone at first,
// and once the guest chooses one explicitly, that choice, kept in sessionStorage
// for this tab so it survives a reload and the return from Google consent. Times
// are shown with the offset of their own date.

function storedChoice() {
  try {
    const value = window.sessionStorage.getItem(TIMEZONE_STORAGE_KEY);
    return value && isValidTimeZone(value) ? value : null;
  } catch {
    return null;
  }
}

export function useGuestTimezone() {
  const [zone, setZone] = useState("UTC");
  const [explicit, setExplicit] = useState(false);

  useEffect(() => {
    const chosen = storedChoice();
    setZone(chosen ?? detectedTimeZone());
    setExplicit(chosen !== null);
  }, []);

  const choose = useCallback((next: string) => {
    if (!isValidTimeZone(next)) return;
    try {
      window.sessionStorage.setItem(TIMEZONE_STORAGE_KEY, next);
    } catch {
      // Storage may be unavailable; the choice still applies to this page.
    }
    setZone(next);
    setExplicit(true);
  }, []);

  return { choose, explicit, zone };
}

// The browser's language, as the request's: Korean or English.
export function browserLanguage(): "en" | "ko" {
  try {
    return navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
  } catch {
    return "en";
  }
}

// The timezone line beside the composer: the zone with today's offset, and a
// labeled control that opens the selector in place.
export function TimezoneLine({
  onChoose,
  zone,
}: {
  readonly onChoose: (zone: string) => void;
  readonly zone: string;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <section aria-labelledby={`${id}-heading`} className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
        <h2 className="pb-2 text-base font-semibold" id={`${id}-heading`}>
          Your time zone
        </h2>
        <TimezoneEditor
          initial={zone}
          onCancel={() => setEditing(false)}
          onSave={(next) => {
            onChoose(next);
            setEditing(false);
          }}
          saving={false}
        />
      </section>
    );
  }

  return (
    <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
      <span>
        Times are shown in <span className="font-medium text-foreground">{zoneLabel(zone)}</span>
      </span>
      <Button className="h-auto px-1 py-0.5" onClick={() => setEditing(true)} type="button" variant="link">
        Change time zone
      </Button>
    </p>
  );
}
