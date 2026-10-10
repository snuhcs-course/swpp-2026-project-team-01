import {requestLifecycleTarget,requestClosure,requestLifecycleState} from '../../contracts/request-lifecycle.ts';
import {Database} from '../database/client.ts';
import {requireCredential,type Credential} from '../identity/credentials.ts';
import {ApplicationError} from '../errors.ts';
export class RequestLifecycle {
 constructor(private readonly database=new Database()){}
 private async call(operation:'read'|'withdraw'|'decline',credential:Credential,input:unknown){
  requireCredential(credential);
  if(operation==='withdraw'&&credential.kind!=='guest'||operation==='decline'&&credential.kind!=='host')throw new ApplicationError('FORBIDDEN',403);
  const value=(operation==='read'?requestLifecycleTarget:requestClosure).parse(input);
  return requestLifecycleState.parse(await this.database.rpc('fmat_request_lifecycle',{p_operation:operation,p_credential:credential,p_input:value}));
 }
 read(credential:Credential,input:unknown){return this.call('read',credential,input);}
 withdraw(credential:Credential,input:unknown){return this.call('withdraw',credential,input);}
 decline(credential:Credential,input:unknown){return this.call('decline',credential,input);}
}
