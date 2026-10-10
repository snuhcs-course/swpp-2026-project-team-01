import {approvalTarget,approvalDecision,approvalState} from '../../contracts/booking-approval.ts';
import {Database} from '../database/client.ts';
import {requireCredential,type Credential} from '../identity/credentials.ts';
import {ApplicationError} from '../errors.ts';
export class BookingApproval {
 constructor(private readonly database=new Database()){}
 private async call(operation:'read'|'approve',credential:Credential,input:unknown){
  requireCredential(credential);if(credential.kind!=='host')throw new ApplicationError('FORBIDDEN',403);
  return approvalState.parse(await this.database.rpc('fmat_booking_approval',{p_operation:operation,p_credential:credential,p_input:input}));
 }
 async read(credential:Credential,input:unknown){return this.call('read',credential,approvalTarget.parse(input));}
 async approve(credential:Credential,input:unknown){return this.call('approve',credential,approvalDecision.parse(input));}
}
