"use client";

import { CheckIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { CardActions } from "./card";

// A searchable list of the browser's IANA time zones.
function supportedZones() {
  try {
    const zones = Intl.supportedValuesOf("timeZone");
    return zones.includes("UTC") ? zones : ["UTC", ...zones];
  } catch {
    return ["UTC"];
  }
}

export function TimezoneEditor({
  initial,
  onCancel,
  onSave,
  saving,
}: {
  readonly initial: string | null;
  readonly onCancel: () => void;
  readonly onSave: (zone: string) => void;
  readonly saving: boolean;
}) {
  const zones = useMemo(supportedZones, []);
  const [selected, setSelected] = useState<string | null>(initial);

  return (
    <div className="flex flex-col gap-3">
      <Command
        className="rounded-lg border border-input"
        // Opens on the current zone, highlighted and scrolled into view.
        defaultValue={initial?.replaceAll("_", " ")}
        label="Time zones"
        loop
      >
        <CommandInput aria-label="Search time zones" className="text-base" placeholder="Search, e.g. Seoul or New York" />
        <CommandList aria-label="Time zones" className="max-h-56">
          <CommandEmpty>No time zone matches.</CommandEmpty>
          {zones.map((zone) => (
            <CommandItem
              className="min-h-11"
              key={zone}
              onSelect={() => setSelected(zone)}
              value={zone.replaceAll("_", " ")}
            >
              <CheckIcon aria-hidden className={selected === zone ? "opacity-100" : "opacity-0"} />
              <span className="min-w-0 break-all">{zone.replaceAll("_", " ")}</span>
              {selected === zone ? <span className="sr-only">(selected)</span> : null}
            </CommandItem>
          ))}
        </CommandList>
      </Command>
      <p aria-live="polite" className="text-sm">
        {selected ? (
          <>
            Selected: <span className="font-medium">{selected.replaceAll("_", " ")}</span>
          </>
        ) : (
          <span className="text-muted-foreground">Choose a time zone from the list.</span>
        )}
      </p>
      <CardActions>
        <Button disabled={!selected || saving} onClick={() => selected && onSave(selected)} type="button">
          {saving ? "Saving..." : "Save time zone"}
        </Button>
        <Button onClick={onCancel} type="button" variant="outline">
          Cancel
        </Button>
      </CardActions>
    </div>
  );
}
