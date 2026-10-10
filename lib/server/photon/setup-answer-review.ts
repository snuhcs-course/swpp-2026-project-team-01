import {z} from 'zod';
import {isDeepStrictEqual} from 'node:util';
import {setupState,type SetupPatch} from '../../contracts/setup.ts';
import {draftAnswers,chooseDraftAnswers,type DraftAnswer} from '../../contracts/setup-answers.ts';

const keys=['mode','location','transport','travel_buffer'] as const;
const selection=z.array(z.enum(keys)).min(1).max(4).refine(value=>new Set(value).size===value.length);
export type PrivateAnswerCommand={action:'review_answers'}|{action:'accept_answers';reviewId:string;keys:DraftAnswer['key'][]};
/** Syntax only. Only current signed inbox authority can accept draft answers. */
export function parsePrivateAnswerCommand(input:unknown):PrivateAnswerCommand|null{
 if(typeof input!=='string'||input.length>4096)return null;
 const text=input.replace(/^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/gu,'');
 if(text.toLowerCase()==='review setup answers')return {action:'review_answers'};
 const match=/^accept setup answers ([0-9a-f-]{36}) ([a-z_,]+)$/iu.exec(text);
 if(!match||!z.uuid().safeParse(match[1]).success)return null;
 const chosen=selection.safeParse(match[2].toLowerCase().split(','));
 return chosen.success?{action:'accept_answers',reviewId:match[1].toLowerCase(),keys:chosen.data}:null;
}

const snapshot=z.strictObject({reviewId:z.uuid(),expiresAt:z.iso.datetime({offset:true}),state:setupState});
const quoted=(value:string)=>JSON.stringify(value).replace(/[\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
export type PrivateAnswerReview={kind:'review';text:string;keys:DraftAnswer['key'][]}|{kind:'browser_required';reason:'invalid'|'expired'|'empty'|'too_long';text:string};
function fallback(reason:'invalid'|'expired'|'empty'|'too_long'):PrivateAnswerReview{
 return {kind:'browser_required',reason,text:'A complete current answer review is unavailable in this message. Describe or edit your preferences, or open your host workspace. No answers have been accepted and settings have not been saved.'};
}
function current(input:unknown,now:number):{reason:'invalid'|'expired'|'empty'}|{value:z.infer<typeof snapshot>;answers:DraftAnswer[]}{
 const parsed=snapshot.safeParse(input);
 if(!parsed.success||!Number.isFinite(now)||!isDeepStrictEqual(parsed.data.state,(input as z.input<typeof snapshot>).state))return {reason:'invalid' as const};
 if(Date.parse(parsed.data.expiresAt)<=now)return {reason:'expired' as const};
 if(parsed.data.state.draft&&parsed.data.state.draft.baseRulesVersion!==parsed.data.state.rulesVersion)return {reason:'empty'};
 const answers=draftAnswers(parsed.data.state);
 return answers.length?{value:parsed.data,answers}:{reason:'empty' as const};
}
/** Presentation is not publication or authorization. The later persistence
 * boundary must bind this exact snapshot, delivery and current human receipt. */
export function formatPrivateAnswerReview(input:unknown,now=Date.now()):PrivateAnswerReview{
 const prepared=current(input,now);if('reason' in prepared)return fallback(prepared.reason);
 const {value,answers}=prepared;
 const text=[
  'Review extracted setup answers. These are suggestions, not accepted answers.',
  ...answers.map(answer=>answer.key+': '+(answer.key==='location'&&answer.patch.rules?.locationPolicy==='preferred'
   ?'Preferred places: '+answer.patch.rules.locations!.map(quoted).join(', ')
   :quoted(answer.label))),
  'Choose only the keys you want to accept, separated by commas (no spaces).',
  ...(answers.some(answer=>answer.key==='mode')?['Include mode before accepting dependent physical answers.']:[]),
  'Review reference: '+value.reviewId.toLowerCase(),'Valid until: '+new Date(value.expiresAt).toISOString(),
  'Reply using this format: accept setup answers '+value.reviewId.toLowerCase()+' <chosen-keys>',
  'Acceptance updates draft answers only. Review and confirm settings separately. It does not approve or book a meeting.',
 ].join('\n');
 return text.length<=4000?{kind:'review',text,keys:answers.map(answer=>answer.key)}:fallback('too_long');
}
/** Derive only displayed values. This pure helper returns no human authority
 * and must never be exposed as a model tool or direct mutation endpoint. */
export function privateAnswerPatch(input:unknown,selected:unknown,now=Date.now()):SetupPatch|null{
 const chosen=selection.safeParse(selected);if(!chosen.success||formatPrivateAnswerReview(input,now).kind!=='review')return null;
 const prepared=current(input,now);if('reason' in prepared)return null;
 return chooseDraftAnswers(prepared.answers,chosen.data);
}
