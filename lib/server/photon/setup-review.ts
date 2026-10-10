import {z} from 'zod';
import {isDeepStrictEqual} from 'node:util';
import {publicHandle} from '../../contracts/handles.ts';
import {setupRules} from '../../contracts/setup.ts';

export type PrivateSetupCommand={action:'review'}|{action:'confirm';reviewId:string};
// Recognition is not authorization. Only the signed inbox dispatcher may act
// on these commands; neither model output nor runtime tools may call a save.
export function parsePrivateSetupCommand(input:unknown):PrivateSetupCommand|null{
 if(typeof input!=='string'||input.length>4096)return null;
 const text=input.replace(/^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/gu,'');
 if(text.toLowerCase()==='review setup')return {action:'review'};
 const match=/^confirm setup ([0-9a-f-]{36})$/iu.exec(text);
 if(!match||!z.uuid().safeParse(match[1]).success)return null;
 return {action:'confirm',reviewId:match[1].toLowerCase()};
}

export const privateSetupReviewSettings=z.strictObject({
 handle:publicHandle,displayName:z.string().trim().min(1).max(120),rules:setupRules,
});
const snapshot=z.strictObject({reviewId:z.uuid(),expiresAt:z.iso.datetime({offset:true}),settings:privateSetupReviewSettings});
const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const mode={online:'Online',in_person:'In person',either:'Online or in person'};
const travel={DRIVE:'Drive',TRANSIT:'Transit',WALK:'Walk',BICYCLE:'Bicycle',PER_TRIP:'Decide per trip',NONE:'None'};
// Quote arbitrary field values, including line breaks and direction controls,
// so their contents cannot masquerade as the application's decision prompt.
const quoted=(value:string)=>JSON.stringify(value).replace(/[\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
export type PrivateSetupReviewText={kind:'review';text:string}|{kind:'browser_required';reason:'invalid'|'expired'|'too_long';text:string};
function fallback(reason:'invalid'|'expired'|'too_long'):PrivateSetupReviewText{
 return {kind:'browser_required',reason,text:reason==='expired'
  ?'This setup review has expired. Request a new review or open your host workspace. Settings have not been saved.'
  :'A complete setup review is unavailable in this message. Open your host workspace to review every setting and any remaining steps. Settings have not been saved.'};
}
/** Presentation only: eligibility, provenance, delivery and current authority
 * must be established by the private review service before using this text. */
export function formatPrivateSetupReview(input:unknown,now=Date.now()):PrivateSetupReviewText{
 const parsed=snapshot.safeParse(input);
 if(!parsed.success||!Number.isFinite(now))return fallback('invalid');
 // Validation must not silently trim/normalize the settings being confirmed.
 if(!isDeepStrictEqual(parsed.data.settings,(input as z.input<typeof snapshot>).settings))return fallback('invalid');
 const {reviewId,expiresAt,settings}=parsed.data,{rules}=settings;
 if(Date.parse(expiresAt)<=now)return fallback('expired');
 const lines=[
  'Review your setup settings. Nothing has been saved yet.',
  'Name: '+quoted(settings.displayName),'Booking handle: '+quoted(settings.handle),
  'Timezone: '+quoted(rules.timezone),'Default meeting duration: '+rules.durationMinutes+' minutes',
  'Weekly meeting windows (in the timezone above):',
  ...rules.availability.map(w=>'- '+w.days.map(d=>days[d]).join(', ')+': '+w.start+'–'+w.end+(w.end<w.start?' (ends the next day)':'')),
  'Focus blocks (exact instants):',
  ...(rules.focusBlocks.length?rules.focusBlocks.map(w=>'- '+w.start+' to '+w.end):['- None']),
  'Meeting buffer: '+rules.bufferMinutes+' minutes','Meeting mode: '+mode[rules.meetingMode],
  'Location policy: '+(rules.locationPolicy==='preferred'?'Preferred places':'Decide per meeting'),
  'Preferred places: '+(rules.locations.length?rules.locations.map(quoted).join(', '):'None'),
  'Transportation: '+travel[rules.travelMode],
  'Extra travel buffer: '+rules.travelBufferMinutes+' minutes (in addition to journey duration)',
  'Home location: '+(rules.homeLocation===undefined?'Not set':quoted(rules.homeLocation)),
  'Additional preferences: '+quoted(rules.preferences),
  'Review reference: '+reviewId.toLowerCase(),'Valid until: '+new Date(expiresAt).toISOString(),
  'To save these exact settings, reply: confirm setup '+reviewId.toLowerCase(),
  'This confirms settings only. It does not approve or book a meeting.',
 ];
 const text=lines.join('\n');
 return text.length<=4000?{kind:'review',text}:fallback('too_long');
}
