import {z} from 'zod';

export const diagnosticCategories=[
 'overdue_jobs','expired_job_leases','dead_jobs','pending_runtime','failed_runtime',
 'held_reservations','uncertain_bookings','failed_delivery','uncertain_delivery',
 'failed_photon_replies','uncertain_photon_replies','uncertain_email_replies','mismatched_decisions',
] as const;
export const diagnosticInput=z.strictObject({project:z.string().regex(/^(?:local|[a-z]{20})$/u),sampleLimit:z.number().int().min(0).max(20).default(10)});
const instant=z.iso.datetime({offset:true});
const sample=z.strictObject({id:z.uuid(),since:instant});
const signal=z.strictObject({category:z.enum(diagnosticCategories),count:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),oldestAt:instant.nullable(),samples:z.array(sample).max(20)}).superRefine((value,ctx)=>{
 if((value.count===0)!==(value.oldestAt===null)||value.samples.length>value.count)ctx.addIssue({code:'custom',message:'Inconsistent diagnostic count'});
 if(value.samples.some((item,index)=>index>0&&(Date.parse(item.since)<Date.parse(value.samples[index-1].since)||(item.since===value.samples[index-1].since&&item.id<value.samples[index-1].id))))ctx.addIssue({code:'custom',message:'Unordered diagnostic sample'});
 if(value.samples.some(item=>Date.parse(item.since)<Date.parse(value.oldestAt!)))ctx.addIssue({code:'custom',message:'Inconsistent oldest timestamp'});
 if(new Set(value.samples.map(item=>item.id)).size!==value.samples.length)ctx.addIssue({code:'custom',message:'Duplicate diagnostic sample'});
});
export const operationalSnapshot=z.strictObject({
 version:z.literal(1),observedAt:instant,ageThresholdSeconds:z.literal(300),sampleLimit:z.number().int().min(0).max(20),
 coverage:z.strictObject({authorizationDenialEvents:z.literal('not_recorded'),rejectedStaleActionEvents:z.literal('not_recorded'),releaseReadiness:z.literal('not_assessed')}),
 signals:z.array(signal).length(diagnosticCategories.length),
}).superRefine((value,ctx)=>{
 if(value.signals.some((item,index)=>item.category!==diagnosticCategories[index]||item.samples.length!==Math.min(item.count,value.sampleLimit)))ctx.addIssue({code:'custom',message:'Invalid diagnostic category or limit'});
});
export type OperationalSnapshot=z.infer<typeof operationalSnapshot>;
