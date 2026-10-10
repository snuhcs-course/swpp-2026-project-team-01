import {z} from 'zod';
export const calendarTarget=z.strictObject({requestId:z.uuid().optional()});
export const calendarStatus=z.object({connected:z.boolean(),kind:z.enum(['host','guest']),selected:z.boolean()});
export type CalendarStatus=z.infer<typeof calendarStatus>;

export const calendarEntry=z.object({id:z.string().min(1).max(1024),name:z.string().max(1024),accessRole:z.enum(['freeBusyReader','reader','writer','writerWithoutPrivateAccess','owner']),primary:z.boolean(),timeZone:z.string().nullable(),color:z.string().nullable()});
export const calendarSelection=z.strictObject({generation:z.uuid(),rulesVersion:z.number().int().nonnegative(),conflictCalendarIds:z.array(z.string().min(1).max(1024)).min(1).max(50),bookingCalendarId:z.string().min(1).max(1024)});
export const calendarCatalog=z.object({generation:z.uuid(),rulesVersion:z.number().int(),calendars:z.array(calendarEntry).max(2500),conflictCalendarIds:z.array(z.string()),bookingCalendarId:z.string().nullable()});
export type CalendarCatalog=z.infer<typeof calendarCatalog>;
