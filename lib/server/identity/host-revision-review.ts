import {z} from 'zod';
import {requestReviewState,requestReviewDecision} from '../../contracts/request-review.ts';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {requireCredential,type Credential} from './credentials.ts';
const target=z.strictObject({requestId:z.uuid()});
export class HostRevisionReview {
 constructor(private readonly database=new Database()){}
 private async call(operation:'read'|'apply'|'dismiss',credential:Credential,input:unknown){
  requireCredential(credential);if(credential.kind!=='host')throw new ApplicationError('FORBIDDEN',403);
  return requestReviewState.parse(await this.database.rpc('fmat_host_revision_review',{p_operation:operation,p_credential:credential,p_input:input}));
 }
 read(credential:Credential,input:unknown){return this.call('read',credential,target.parse(input));}
 decide(operation:'apply'|'dismiss',credential:Credential,input:unknown){return this.call(operation,credential,target.extend({input:requestReviewDecision}).parse(input));}
}
