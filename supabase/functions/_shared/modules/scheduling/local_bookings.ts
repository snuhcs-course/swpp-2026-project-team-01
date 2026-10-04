import type { HostEvent } from './index.ts';
import { SchedulingInputError } from './time.ts';
export interface ConfirmedBooking {
  payload: { id: string; location: string };
  startsAt: string;
  endsAt: string;
  mode: 'online' | 'in_person';
  calendarId: string;
}
/** SQL receipts provide explicit mode; provider URLs never prove physical whereabouts. */
export function withLocalBookings(
  events: HostEvent[],
  bookings: readonly ConfirmedBooking[],
): HostEvent[] {
  const merged = events.map((event) => ({ ...event }));
  for (const booking of bookings) {
    if (
      !['online', 'in_person'].includes(booking.mode) || !booking.calendarId ||
      !booking.payload.id || !Number.isFinite(Date.parse(booking.startsAt)) ||
      !Number.isFinite(Date.parse(booking.endsAt)) ||
      Date.parse(booking.endsAt) <= Date.parse(booking.startsAt)
    ) throw new SchedulingInputError('invalid_local_booking');
    const id = `${booking.calendarId}:${booking.payload.id}`;
    const existing = merged.find((event) => event.id === id);
    if (existing) {
      existing.mode = booking.mode;
      if (booking.mode === 'online') {
        delete existing.location;
        delete existing.physicalLocation;
      }
      if (
        Date.parse(existing.start) === Date.parse(booking.startsAt) &&
        Date.parse(existing.end) === Date.parse(booking.endsAt)
      ) continue;
    }
    const receiptId = existing ? `${id}:receipt` : id;
    if (merged.some((event) => event.id === receiptId)) continue;
    merged.push({
      id: receiptId,
      start: booking.startsAt,
      end: booking.endsAt,
      mode: booking.mode,
      ...(booking.mode === 'in_person'
        ? { location: booking.payload.location, physicalLocation: booking.payload.location }
        : {}),
    });
  }
  return merged;
}
