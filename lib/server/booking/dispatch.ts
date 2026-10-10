import {z} from 'zod';
import {Database} from '../database/client.ts';
import {bookingTransportSnapshot} from '../calendar/booking.ts';

export const bookingLease=z.strictObject({workerId:z.string().min(1).max(200),jobId:z.uuid(),leaseToken:z.uuid()});
const target=z.strictObject({requestId:z.uuid(),revision:z.number().int().positive(),checkId:z.uuid(),basis:z.string().regex(/^[a-f0-9]{64}$/u),evaluationId:z.uuid()});
const receipt=z.discriminatedUnion('dispatched',[
 z.strictObject({dispatched:z.literal(true),snapshot:bookingTransportSnapshot}),
 z.strictObject({dispatched:z.literal(false)}),
]);
/** A positive receipt is returned only by the transaction that first commits
 * dispatch. Unknown/lost responses require reconciliation of the saved event;
 * retrying this operation cannot issue another insertion permission. */
export class BookingDispatch {
 constructor(private readonly database=new Database()){}
 async dispatch(lease:unknown,input:unknown){
  return receipt.parse(await this.database.rpc('fmat_booking_dispatch',{p_lease:bookingLease.parse(lease),p_input:target.parse(input)}));
 }
}
