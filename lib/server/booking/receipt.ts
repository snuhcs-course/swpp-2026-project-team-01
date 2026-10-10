import {createHash} from 'node:crypto';
import {z} from 'zod';
import {bookingReceiptState,receiptTarget} from '../../contracts/booking-receipt.ts';
import {Database} from '../database/client.ts';
import {requireCredential,type Credential} from '../identity/credentials.ts';
import {ApplicationError} from '../errors.ts';
type ReceiptCredential=Readonly<{kind:'booking_receipt';requestId:string;tokenHash:string}>;
const issued=new WeakSet<object>();
export function bookingReceiptCredential(requestId:string,token:string):ReceiptCredential{
 z.uuid().parse(requestId);z.string().regex(/^[A-Za-z0-9_-]{43}$/u).parse(token);
 const credential=Object.freeze({kind:'booking_receipt' as const,requestId,tokenHash:createHash('sha256').update(token).digest('hex')});issued.add(credential);return credential;
}
export class BookingReceipt{
 constructor(private readonly database=new Database()){}
 async read(credential:Credential|ReceiptCredential,input:unknown){if(credential.kind==='booking_receipt'){if(!issued.has(credential))throw new ApplicationError('UNAUTHORIZED',401);}else requireCredential(credential);return bookingReceiptState.parse(await this.database.rpc('fmat_booking_receipt',{p_credential:credential,p_input:receiptTarget.parse(input)}));}
}
