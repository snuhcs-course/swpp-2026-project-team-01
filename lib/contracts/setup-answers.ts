import type {SetupPatch,SetupState} from './setup.ts';

export type DraftAnswer={key:'mode'|'location'|'transport'|'travel_buffer';label:string;patch:SetupPatch};
/** Reuse extracted values without assigning human authority. Only a protected
 * browser choice can apply these patches with host provenance. */
export function draftAnswers(state:SetupState):DraftAnswer[]{
 const draft=state.draft,r=draft?.settings.rules,p=draft?.provenance??{};
 if(!r||draft?.status!=='active'||state.nextAction==='refresh_draft')return [];
 const suggested=(key:string)=>p['rules.'+key]==='assistant';
 const answers:DraftAnswer[]=[];
 if(r.meetingMode&&suggested('meetingMode')&&!state.progress.dismissedSuggestions.includes('mode'))answers.push({key:'mode',label:({online:'Online only',in_person:'In person',either:'Either online or in person'})[r.meetingMode],patch:{rules:{meetingMode:r.meetingMode}}});
 // A dismissed/unknown mode cannot silently make physical answers applicable.
 if(!r.meetingMode||r.meetingMode==='online'||p['rules.meetingMode']!=='host'&&!answers.length)return answers;
 if(r.locationPolicy==='per_meeting'&&suggested('locationPolicy'))answers.push({key:'location',label:'Decide location per meeting',patch:{rules:{locationPolicy:'per_meeting',locations:[]}}});
 if(r.locationPolicy==='preferred'&&r.locations?.length&&(suggested('locationPolicy')||suggested('locations')))answers.push({key:'location',label:'Preferred places: '+r.locations.join(' · '),patch:{rules:{locationPolicy:'preferred',locations:r.locations}}});
 if(r.travelMode&&r.travelMode!=='NONE'&&suggested('travelMode'))answers.push({key:'transport',label:({DRIVE:'Drive',TRANSIT:'Public transit',WALK:'Walk',BICYCLE:'Bicycle',PER_TRIP:'Depends on the trip'})[r.travelMode],patch:{rules:{travelMode:r.travelMode}}});
 if(r.travelBufferMinutes!==undefined&&suggested('travelBufferMinutes'))answers.push({key:'travel_buffer',label:r.travelBufferMinutes+' extra travel minutes, separate from journey time',patch:{rules:{travelBufferMinutes:r.travelBufferMinutes}}});
 return answers;
}

export function chooseDraftAnswers(answers:DraftAnswer[],selected:DraftAnswer['key'][]):SetupPatch|null{
 if(!selected.length||selected.some(key=>!answers.some(answer=>answer.key===key)))return null;
 if(answers.some(a=>a.key==='mode')&&!selected.includes('mode'))return null;
 return {rules:Object.assign({},...answers.filter(answer=>selected.includes(answer.key)).map(answer=>answer.patch.rules))};
}
