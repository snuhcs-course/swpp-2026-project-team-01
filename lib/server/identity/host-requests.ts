import {hostRequestTarget,hostRequestQuery,hostRequestSummary,hostRequestPage} from '../../contracts/host-requests.ts';
import {Database} from '../database/client.ts';
import {requireCredential,type Credential} from './credentials.ts';
import {ApplicationError} from '../errors.ts';
export class HostRequests {
 constructor(private readonly database=new Database()){}
 private call(operation:'list'|'read',credential:Credential,input:unknown){
  requireCredential(credential);
  if(credential.kind!=='host')throw new ApplicationError('FORBIDDEN',403);
  return this.database.rpc('fmat_host_requests',{p_operation:operation,p_credential:credential,p_input:input});
 }
 async list(credential:Credential,input:unknown){return hostRequestPage.parse(await this.call('list',credential,hostRequestQuery.parse(input)));}
 async read(credential:Credential,input:unknown){return hostRequestSummary.parse(await this.call('read',credential,hostRequestTarget.parse(input)));}
}
