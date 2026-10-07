import {z} from 'zod';
import {ianaTimezone} from './time.ts';
import {requestLifecycleState,requestLifecycleTarget} from './request-lifecycle.ts';
export const receiptTarget=requestLifecycleTarget;
export const confirmedBookingReceipt=z.strictObject({
 confirmedAt:z.string(),title:z.string(),purpose:z.string(),start:z.iso.datetime({offset:true}),end:z.iso.datetime({offset:true}),timezone:ianaTimezone,
 mode:z.enum(['online','in_person']),location:z.string(),participants:z.array(z.strictObject({email:z.email()})).min(1).max(2),
 calendarUrl:z.string().url().refine(value=>{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='www.google.com'&&!url.username&&!url.password&&url.pathname.startsWith('/calendar/');}).nullable(),
});
export const bookingReceiptState=z.strictObject({requestId:z.uuid(),revision:z.number().int().positive(),status:requestLifecycleState.shape.status,closed:z.boolean(),receipt:confirmedBookingReceipt.nullable(),emailStatus:z.enum(['pending','sending','sent','uncertain','failed','suppressed']).nullable()});
export type BookingReceiptState=z.infer<typeof bookingReceiptState>;
export function bookingJoinUrl(receipt:z.infer<typeof confirmedBookingReceipt>):string|null{
 if(receipt.mode!=='online')return null;
 try{const url=new URL(receipt.location);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
