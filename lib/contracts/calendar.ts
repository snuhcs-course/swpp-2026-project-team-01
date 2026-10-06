import {z} from 'zod';
export const calendarTarget=z.strictObject({requestId:z.uuid().optional()});
export const calendarStatus=z.object({connected:z.boolean(),kind:z.enum(['host','guest']),selected:z.boolean()});
export type CalendarStatus=z.infer<typeof calendarStatus>;
