import {bookingReceiptState,receiptTarget} from '../../contracts/booking-receipt.ts';
import {Database} from '../database/client.ts';
import {requireCredential,type Credential} from '../identity/credentials.ts';
export class BookingReceipt{
 constructor(private readonly database=new Database()){}
 async read(credential:Credential,input:unknown){requireCredential(credential);return bookingReceiptState.parse(await this.database.rpc('fmat_booking_receipt',{p_credential:credential,p_input:receiptTarget.parse(input)}));}
}
