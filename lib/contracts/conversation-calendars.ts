import {z} from 'zod';
const reference=z.string().regex(/^cal_[a-f0-9]{24}$/);
export const configureCalendars=z.strictObject({generation:z.uuid(),rulesVersion:z.number().int().nonnegative(),conflictCalendars:z.array(reference).min(1).max(50),bookingCalendar:reference});
