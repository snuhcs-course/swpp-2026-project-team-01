import {z} from 'zod';
export const contactDiagnosticCategories=['aged_contact_shares','failed_contact_shares','uncertain_contact_shares'] as const;
const instant=z.iso.datetime({offset:true});
const signal=z.strictObject({category:z.enum(contactDiagnosticCategories),count:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),oldestAt:instant.nullable(),samples:z.array(z.strictObject({id:z.uuid(),since:instant})).max(20)});
export const contactSnapshot=z.strictObject({
 version:z.literal(1),scope:z.literal('photon_contacts'),observedAt:instant,ageThresholdSeconds:z.literal(300),sampleLimit:z.number().int().min(0).max(20),
 coverage:z.strictObject({deviceDelivery:z.literal('not_observed'),contactSaving:z.literal('not_observed'),releaseReadiness:z.literal('not_assessed')}),
 signals:z.array(signal).length(contactDiagnosticCategories.length),
}).superRefine((value,ctx)=>{
 for(const [index,item] of value.signals.entries()){
  if(item.category!==contactDiagnosticCategories[index]||item.samples.length!==Math.min(item.count,value.sampleLimit)||(item.count===0)!==(item.oldestAt===null))ctx.addIssue({code:'custom',message:'Inconsistent contact signal'});
  if(new Set(item.samples.map(s=>s.id)).size!==item.samples.length||item.samples.some((s,n)=>Date.parse(s.since)<Date.parse(item.oldestAt!)||(n>0&&(Date.parse(s.since)<Date.parse(item.samples[n-1].since)||(s.since===item.samples[n-1].since&&s.id<item.samples[n-1].id)))))ctx.addIssue({code:'custom',message:'Invalid contact sample order'});
 }
});
