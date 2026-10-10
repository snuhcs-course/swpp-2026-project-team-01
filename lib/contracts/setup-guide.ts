import type {SetupState,SetupPatch} from './setup.ts';
import {draftAnswers} from './setup-answers.ts';
export type SetupStep='connect'|'calendars'|'refresh'|'analysis'|'analysis_review'|'profile'|'schedule'|'answers_review'|'mode'|'location'|'transport'|'travel_buffer'|'clarification'|'review'|'confirmed';
export type SetupGuide={step:SetupStep;question:string;completed:string[];total:number};
export function setupGuide(state:SetupState):SetupGuide{
 const s=state.draft?.settings??state.confirmed,r=s.rules??{},p=state.draft?.provenance??{};
 const explicit=(key:string)=>p['rules.'+key]==='host';
 const steps:[string,boolean][]=[['Google',!!state.calendarGeneration],['Calendars',state.calendarSelected],['Analysis choice',state.progress.analysisDecided],['Profile',!!s.handle&&!!s.displayName],['Schedule',!!r.timezone&&!!r.availability?.length&&!!r.durationMinutes&&r.bufferMinutes!==undefined&&r.focusBlocks!==undefined&&r.preferences!==undefined],['Meeting mode',explicit('meetingMode')]];
 if(r.meetingMode!=='online')steps.push(['Location',explicit('locationPolicy')&&(r.locationPolicy==='per_meeting'||explicit('locations')&&!!r.locations?.length)],['Transportation',explicit('travelMode')&&r.travelMode!=='NONE'],['Travel buffer',explicit('travelBufferMinutes')]);
 const result=(step:SetupStep,question:string)=>({step,question,completed:steps.filter(([,done])=>done).map(([name])=>name),total:steps.length});
 if(!state.calendarGeneration)return result('connect','Connect Google Calendar to start. You can draft preferences while you connect.');
 if(!state.calendarSelected)return result('calendars','Which calendars should block meetings, and where should approved bookings go?');
 if(state.nextAction==='refresh_draft')return result('refresh','Your calendar or saved settings changed. Refresh your draft before reviewing it.');
 if(state.nextAction==='settings_confirmed')return result('confirmed','Your meeting preferences are confirmed.');
 if(!state.progress.analysisDecided)return result('analysis','Would you like suggestions from selected calendars, or choose preferences yourself?');
 if(state.analysisStatus==='ready')return result('analysis_review','Your Calendar suggestions are ready. Review them below before choosing new defaults.');
 if(!s.handle||!s.displayName)return result('profile','What name and booking name would you like people to see?');
 if(!steps[4][1])return result('schedule','Would this meeting week work for you?');
 if(draftAnswers(state).length)return result('answers_review','Review the answers already in your draft. You do not need to enter them again.');
 if(!explicit('meetingMode'))return result('mode','Do you prefer online meetings, in-person meetings, or either?');
 if(r.meetingMode!=='online'){
  if(!explicit('locationPolicy')||r.locationPolicy==='preferred'&&(!explicit('locations')||!r.locations?.length))return result('location','Where do you prefer to meet? You can decide per meeting.');
  if(!explicit('travelMode')||r.travelMode==='NONE')return result('transport','How do you usually get to meetings?');
  if(!explicit('travelBufferMinutes'))return result('travel_buffer','How much extra time should I leave around travel?');
 }
 if(state.draft?.clarifications.length)return result('clarification',state.draft.clarifications[0]);
 return result('review','Review the exact values below, then confirm when they are right.');
}
export function scheduleSuggestion(state:SetupState,timezone:string):{patch:SetupPatch;defaults:string[];starterFields:string[]}|null{
 if(state.progress.dismissedSuggestions.includes('schedule'))return null;
 const rules=state.draft?.settings.rules??state.confirmed.rules??{},defaults:string[]=[];
 const value=<T>(name:string,existing:T|undefined,fallback:T)=>{if(existing!==undefined)return existing;defaults.push(name);return fallback;};
 return {patch:{rules:{timezone:value('timezone',rules.timezone,timezone),durationMinutes:value('meeting length',rules.durationMinutes,30),availability:value('meeting windows',rules.availability,[{days:[1,2,3,4,5],start:'13:00',end:'17:00'}]),bufferMinutes:value('meeting buffer',rules.bufferMinutes,10),focusBlocks:value('focus blocks',rules.focusBlocks,[]),preferences:value('other preferences',rules.preferences,'')}},defaults,starterFields:defaults.map(name=>({'timezone':'timezone','meeting length':'durationMinutes','meeting windows':'availability','meeting buffer':'bufferMinutes','focus blocks':'focusBlocks','other preferences':'preferences'})[name]!)};
}
