"use client";

import { WEEKDAYS, type Weekday, type WeeklyWindow } from "@lib/contracts/setup";
import { CopyIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { CardActions } from "./card";
import {
  checkRange,
  copyDay,
  emptyRows,
  normalizeClock,
  rowsFromWindows,
  type TimeRange,
  validateRows,
  WEEKDAY_LABELS,
  WEEKDAY_TARGETS,
  type WindowRows,
} from "./format";

// The weekly windows editor: one row per weekday with its time ranges, after
// cal.diy's schedule rows (add and remove ranges, copy a day to other days). Times
// are typed as 24-hour HH:MM; an end before its start is the next day, and equal
// clocks block saving.

const DEFAULT_RANGE: TimeRange = { end: "17:00", start: "09:00" };

export function WeeklyWindowsEditor({
  initial,
  onCancel,
  onSave,
  saving,
}: {
  readonly initial: readonly WeeklyWindow[] | null;
  readonly onCancel: () => void;
  readonly onSave: (windows: WeeklyWindow[]) => void;
  readonly saving: boolean;
}) {
  const [rows, setRows] = useState<WindowRows>(() => (initial ? rowsFromWindows(initial) : emptyRows()));
  const result = validateRows(rows);
  const errorId = useId();

  const update = (weekday: Weekday, ranges: readonly TimeRange[]) => setRows((current) => ({ ...current, [weekday]: ranges }));

  return (
    <form
      aria-label="Edit weekly windows"
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!result.error) onSave(result.windows);
      }}
    >
      <p className="text-sm text-muted-foreground">Times are 24-hour, in your meeting time zone.</p>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {WEEKDAYS.map((weekday) => (
          <DayRow
            key={weekday}
            onChange={(ranges) => update(weekday, ranges)}
            onCopy={(targets) => setRows((current) => copyDay(current, weekday, targets))}
            ranges={rows[weekday]}
            weekday={weekday}
          />
        ))}
      </ul>
      {result.error ? (
        <p className="text-sm text-destructive" id={errorId} role="status">
          {result.error}
        </p>
      ) : null}
      <CardActions>
        <Button aria-describedby={result.error ? errorId : undefined} disabled={Boolean(result.error) || saving} type="submit">
          {saving ? "Saving..." : "Save windows"}
        </Button>
        <Button onClick={onCancel} type="button" variant="outline">
          Cancel
        </Button>
      </CardActions>
    </form>
  );
}

function DayRow({
  onChange,
  onCopy,
  ranges,
  weekday,
}: {
  readonly onChange: (ranges: readonly TimeRange[]) => void;
  readonly onCopy: (targets: readonly Weekday[]) => void;
  readonly ranges: readonly TimeRange[];
  readonly weekday: Weekday;
}) {
  const label = WEEKDAY_LABELS[weekday];
  const checkboxId = useId();
  const available = ranges.length > 0;

  return (
    <li className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-start sm:gap-4">
      <label className="flex min-h-11 shrink-0 items-center gap-3 sm:w-36" htmlFor={checkboxId}>
        <input
          checked={available}
          className="size-5 accent-primary"
          id={checkboxId}
          onChange={(event) => onChange(event.target.checked ? [DEFAULT_RANGE] : [])}
          type="checkbox"
        />
        <span className="font-medium">{label}</span>
        {!available ? <span className="text-sm text-muted-foreground">Unavailable</span> : null}
      </label>
      {available ? (
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {ranges.map((range, index) => (
            <RangeRow
              day={label}
              index={index}
              // Ranges have no identity of their own; their position is it.
              // oxlint-disable-next-line react/no-array-index-key
              key={index}
              onChange={(next) => onChange(ranges.map((current, at) => (at === index ? next : current)))}
              onRemove={() => onChange(ranges.filter((_, at) => at !== index))}
              range={range}
            />
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              aria-label={`Add a range on ${label}`}
              onClick={() => onChange([...ranges, nextRange(ranges)])}
              type="button"
              variant="ghost"
            >
              <PlusIcon aria-hidden />
              Add range
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button aria-label={`Copy ${label} to other days`} type="button" variant="ghost">
                  <CopyIcon aria-hidden />
                  Copy
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => onCopy(WEEKDAY_TARGETS)}>Copy to weekdays</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onCopy(WEEKDAYS)}>Copy to all days</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ) : null}
    </li>
  );
}

// A new range starts an hour after the day's last one ends.
function nextRange(ranges: readonly TimeRange[]): TimeRange {
  const last = ranges.at(-1);
  if (!last) return DEFAULT_RANGE;
  const hour = Number(last.end.slice(0, 2));
  if (!Number.isFinite(hour) || hour >= 22) return DEFAULT_RANGE;
  const pad = (value: number) => `${String(value).padStart(2, "0")}:00`;
  return { end: pad(hour + 2), start: pad(hour + 1) };
}

function RangeRow({
  day,
  index,
  onChange,
  onRemove,
  range,
}: {
  readonly day: string;
  readonly index: number;
  readonly onChange: (range: TimeRange) => void;
  readonly onRemove: () => void;
  readonly range: TimeRange;
}) {
  const check = checkRange(range);
  const hintId = useId();
  const position = index === 0 ? day : `${day}, range ${index + 1}`;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <TimeInput
          describedBy={check.error || check.nextDay ? hintId : undefined}
          invalid={Boolean(check.error)}
          label={`${position} start`}
          onChange={(start) => onChange({ ...range, start })}
          value={range.start}
        />
        <span aria-hidden className="text-muted-foreground">
          –
        </span>
        <TimeInput
          describedBy={check.error || check.nextDay ? hintId : undefined}
          invalid={Boolean(check.error)}
          label={`${position} end`}
          onChange={(end) => onChange({ ...range, end })}
          value={range.end}
        />
        <Button aria-label={`Remove ${position} ${range.start} to ${range.end}`} onClick={onRemove} size="icon" type="button" variant="ghost">
          <Trash2Icon aria-hidden className="size-4" />
        </Button>
      </div>
      {check.error ? (
        <p className="text-sm text-destructive" id={hintId}>
          {check.error}
        </p>
      ) : check.nextDay ? (
        <p className="text-sm text-muted-foreground" id={hintId}>
          Ends next day
        </p>
      ) : null}
    </div>
  );
}

function TimeInput({
  describedBy,
  invalid,
  label,
  onChange,
  value,
}: {
  readonly describedBy?: string;
  readonly invalid: boolean;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly value: string;
}) {
  return (
    <input
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-label={label}
      autoComplete="off"
      className={cn(
        "h-11 w-[5.5rem] rounded-md border border-input bg-card px-3 text-center text-base tabular-nums outline-none",
        "focus-visible:border-ring aria-invalid:border-destructive",
      )}
      inputMode="numeric"
      maxLength={5}
      onChange={(event) => onChange(normalizeClock(event.target.value))}
      placeholder="HH:MM"
      value={value}
    />
  );
}
