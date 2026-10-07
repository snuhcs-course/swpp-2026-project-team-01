import {schedulingTarget,schedulingEvaluate,schedulingSelection,schedulingAgreement,schedulingState} from '../../contracts/scheduling.ts';
import {Database} from '../database/client.ts';
import {requireCredential,type Credential} from '../identity/credentials.ts';
import {ApplicationError} from '../errors.ts';
import {AvailabilityEvaluation} from './availability.ts';
import {CandidateRanking} from './ranking.ts';
export class SchedulingPublication {
 constructor(private readonly database=new Database(),private readonly evaluation=new AvailabilityEvaluation(database),private readonly ranking=new CandidateRanking(database)){}
 private async call(operation:string,credential:Credential,input:unknown){requireCredential(credential);return schedulingState.parse(await this.database.rpc('fmat_scheduling',{p_operation:operation,p_credential:credential,p_input:input}));}
 read(credential:Credential,input:unknown){return this.call('read',credential,schedulingTarget.parse(input));}
 async evaluate(credential:Credential,input:unknown){
  requireCredential(credential);const target=schedulingEvaluate.parse(input);
  const current=await this.read(credential,{requestId:target.requestId});
  if(current.revision!==target.revision)throw new ApplicationError('STALE_REVISION',409);
  if(!current.detailsComplete)throw new ApplicationError('INVALID_INPUT',400);
  const batch=await this.evaluation.batch(credential,{...target,sampling:{stepMinutes:15,limit:12}});
  const {checkId,basis}=batch.context,ranked=await this.ranking.rank(credential,{...target,checkId,basis});
  return this.call('publish',credential,{...target,rankingId:ranked.rankingId,truncated:batch.truncated});
 }
 select(credential:Credential,input:unknown){return this.call('select',credential,schedulingSelection.parse(input));}
 async agree(credential:Credential,input:unknown){requireCredential(credential);if(credential.kind!=='guest')throw new ApplicationError('FORBIDDEN',403);return this.call('agree',credential,schedulingAgreement.parse(input));}
}
