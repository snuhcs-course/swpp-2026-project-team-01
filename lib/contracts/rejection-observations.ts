import {z} from 'zod';

export const rejectionCategories=['authorization_denied','stale_action'] as const;
export const rejectionCategory=z.enum(rejectionCategories);
export type RejectionCategory=z.infer<typeof rejectionCategory>;
const instant=z.iso.datetime({offset:true});
const signal=z.strictObject({category:rejectionCategory,count:z.number().int().min(0).max(24_000_000),lastSeenAt:instant.nullable(),saturated:z.boolean()});
export const rejectionSnapshot=z.strictObject({
 version:z.literal(1),scope:z.literal('database_rpc'),delivery:z.literal('best_effort'),
 observedAt:instant,windowStart:instant,hourlyBuckets:z.literal(24),bucketLimit:z.literal(1_000_000),partialCurrentHour:z.literal(true),
 coverage:z.strictObject({preDatabaseDenials:z.literal('not_recorded'),uncategorizedRejections:z.literal('not_recorded'),releaseReadiness:z.literal('not_assessed')}),
 signals:z.array(signal).length(2),
}).superRefine((value,ctx)=>{
 const start=Date.parse(value.windowStart),end=Date.parse(value.observedAt);
 if(start%3_600_000!==0||end-start<23*3_600_000||end-start>=24*3_600_000)ctx.addIssue({code:'custom',message:'Invalid observation window'});
 for(const [index,item] of value.signals.entries()){
  if(item.category!==rejectionCategories[index]||(item.count===0)!==(item.lastSeenAt===null)||item.saturated&&item.count<1_000_000||item.lastSeenAt!==null&&(Date.parse(item.lastSeenAt)<start||Date.parse(item.lastSeenAt)>end))ctx.addIssue({code:'custom',message:'Inconsistent rejection observations'});
 }
});
export type RejectionSnapshot=z.infer<typeof rejectionSnapshot>;
