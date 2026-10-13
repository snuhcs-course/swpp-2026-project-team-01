import {z} from 'zod';
import {Database} from '../database/client.ts';
import {formatPrivateAnswerReview} from './setup-answer-review.ts';
const receipt=z.strictObject({accepted:z.literal(true),reviewId:z.uuid(),revision:z.number().int().positive(),draftRevision:z.number().int().positive(),keys:z.array(z.enum(['mode','location','transport','travel_buffer'])).min(1).max(4),acceptedAt:z.iso.datetime({offset:true})});
/** Internal service adapter only. SQL derives human authority and the chosen
 * keys from a frozen signed inbox. No browser/model supplied patch is accepted. */
export class PrivateSetupAnswers {
 constructor(private readonly database:Pick<Database,'rpc'>=new Database()){}
 private call(operation:string,inboxId:string,input:unknown){return this.database.rpc('fmat_photon_setup_answers',{p_operation:operation,p_inbox_id:z.uuid().parse(inboxId),p_input:input});}
 async review(inboxId:string){
  const snapshot=z.strictObject({reviewId:z.uuid(),expiresAt:z.string(),state:z.unknown(),text:z.string().nullable()}).parse(await this.call('review',inboxId,{}));
  if(snapshot.text!==null)return {kind:'review' as const,text:snapshot.text};
  const formatted=formatPrivateAnswerReview({reviewId:snapshot.reviewId,expiresAt:snapshot.expiresAt,state:snapshot.state});
  if(formatted.kind!=='review')return formatted;
  const published=z.strictObject({text:z.string()}).parse(await this.call('publish',inboxId,{reviewId:snapshot.reviewId,text:formatted.text}));
  return {kind:'review' as const,text:published.text};
 }
 async accept(inboxId:string,reviewId:string){return receipt.parse(await this.call('accept',inboxId,{reviewId:z.uuid().parse(reviewId)}));}
}
