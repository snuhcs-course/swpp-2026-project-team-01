/** All scheduling comparisons use instants. Local clock input must be resolved first. */
export class SchedulingInputError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export function instant(value: string): number {
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/
      .test(value)
  ) {
    throw new SchedulingInputError('explicit_timezone_required');
  }
  const parsed = Date.parse(value);
  // Date.parse can normalize impossible dates (e.g. February 30).
  const date = value.slice(0, 10);
  const nominal = new Date(`${date}T00:00:00Z`);
  if (
    !Number.isFinite(parsed) || !Number.isFinite(nominal.getTime()) ||
    nominal.toISOString().slice(0, 10) !== date
  ) {
    throw new SchedulingInputError('invalid_timestamp');
  }
  return parsed;
}

export function timezoneFormatter(timezone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new SchedulingInputError('invalid_timezone');
  }
}

export function localParts(ms: number, formatter: Intl.DateTimeFormat) {
  const values: Record<string, number> = {};
  for (const part of formatter.formatToParts(ms)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
    weekday: new Date(Date.UTC(values.year, values.month - 1, values.day))
      .getUTCDay(),
  };
}

/** Reject DST gaps/repeated clocks unless the host/requester selects an actual UTC offset. */
export function resolveLocalDateTime(
  local: string,
  timezone: string,
  offsetMinutes?: number,
): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(local)) {
    throw new SchedulingInputError('invalid_local_time');
  }
  const complete = local.length === 16 ? `${local}:00` : local;
  const nominal = instant(`${complete}Z`);
  if (new Date(nominal).toISOString().slice(0, 19) !== complete) {
    throw new SchedulingInputError('invalid_local_time');
  }
  const formatter = timezoneFormatter(timezone);
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = nominal + hours * 3_600_000;
    const p = localParts(sample, formatter);
    offsets.add(
      (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
        sample) / 60_000,
    );
  }
  const matches = [...offsets].filter((offset) => {
    const p = localParts(nominal - offset * 60_000, formatter);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) ===
      nominal;
  });
  if (!matches.length) throw new SchedulingInputError('nonexistent_local_time');
  if (offsetMinutes === undefined && matches.length !== 1) {
    throw new SchedulingInputError('ambiguous_local_time');
  }
  const selected = offsetMinutes ?? matches[0];
  if (!matches.includes(selected)) {
    throw new SchedulingInputError('offset_does_not_match_timezone');
  }
  return new Date(nominal - selected * 60_000).toISOString();
}
