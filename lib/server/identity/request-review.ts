import {requestReviewState,requestReviewDecision} from '../../contracts/request-review.ts';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {requireCredential,type Credential} from './credentials.ts';
export class RequestReview {
  constructor(private readonly database=new Database()){}
  private async call(operation:'read'|'apply'|'dismiss',credential:Credential,input:unknown){
    requireCredential(credential);
    if(credential.kind!=='guest')throw new ApplicationError('FORBIDDEN',403);
    return requestReviewState.parse(await this.database.rpc('fmat_request_detail_review',{p_operation:operation,p_credential:credential,p_input:input}));
  }
  read(credential:Credential){return this.call('read',credential,{});}
  decide(operation:'apply'|'dismiss',credential:Credential,input:unknown){return this.call(operation,credential,requestReviewDecision.parse(input));}
}
