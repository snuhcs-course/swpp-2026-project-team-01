import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Temporal} from '@js-temporal/polyfill';
import {Database} from '../../lib/server/database/client.ts';
import {HostSetup} from '../../lib/server/setup/commands.ts';
import {CalendarConsent} from '../../lib/server/calendar/consent.ts';
import {CalendarSelection} from '../../lib/server/calendar/selection.ts';
import {CalendarScans} from '../../lib/server/calendar/scans.ts';
import {calendarScopes} from '../../lib/server/calendar/google.ts';
import type {CalendarProvider} from '../../lib/server/calendar/catalog.ts';
import type {Credential} from '../../lib/server/identity/credentials.ts';
import {setupGuide,type SetupStep} from '../../lib/contracts/setup-guide.ts';
import type {SetupState} from '../../lib/contracts/setup.ts';
import type {LocalSql} from '../integration/local-sql.ts';
export type NarrationStage='calendars'|'analysis'|'rich_scan'|'sparse_scan'|'dismissed'|'answers'|'review'|'revoked';
export type NarrationScenario={id:string;text:string;duration?:number;stage?:NarrationStage};
export const laterNarrationCases:NarrationScenario[]=[
 {id:'en-calendar-selection',stage:'calendars',text:'Google is connected. Tell me the next setup step and explain the different calendar roles. Do not change anything or claim that a scan happened.'},
 {id:'ko-analysis-choice',stage:'analysis',text:'충돌 확인용 캘린더와 예약 저장 캘린더를 선택했어요. 다음 단계가 뭔가요? 아직 분석 날짜를 고르거나 스캔에 동의하지 않았어요. 상태는 바꾸지 말고 안내해 주세요.'},
 {id:'en-rich-scan',stage:'rich_scan',text:'Read the current setup analysis and explain what it actually supports. Are its suggested windows guaranteed availability or my saved preferences? Do not apply suggestions or change my draft.'},
 {id:'ko-sparse-scan',stage:'sparse_scan',text:'현재 캘린더 분석 결과를 확인하고 다음 단계를 안내해 주세요. 제안 시간이 실제 일정 패턴에 근거한 건지, 임시 기본값인지 구별해 주세요. 비어 있는 캘린더가 항상 예약 가능하다는 뜻인가요? 설정은 바꾸지 마세요.'},
 {id:'en-dismissed-defaults',stage:'dismissed',text:'I already dismissed the suggested schedule and meeting mode. What do you need from me next? Do not suggest those defaults again, undo my dismissal, or change my draft.'},
 {id:'ko-extracted-answers',stage:'answers',text:'제가 말한 온라인 미팅 선호가 초안에 들어갔어요. 다시 입력해야 하나요? 지금 저장이 확정됐는지, 다음에 어떻게 확인해야 하는지 알려 주세요. 제 대신 답을 수락하거나 설정을 확정하지 마세요.'},
 {id:'en-current-review',stage:'review',text:'My current settings review is ready. Explain what is saved and what still needs my action. Do not confirm it for me and do not invent booking links.'},
 {id:'ko-revoked-calendar',stage:'revoked',text:'예전에 설정을 확정했지만 Google 연결을 해제했어요. 저장된 설정은 유지되나요? 지금 예약 링크를 공유해도 되나요? 현재 준비 상태를 확인하고 다음 조치를 안내해 주세요. 설정은 바꾸지 마세요.'},
];
const q=(value:string)=>"'"+value.replaceAll("'","''")+"'";

/** Only synthetic local fixtures. The live model process never receives this
 * encryption key or a Google/Photon/AgentMail credential. */
export async function prepareNarrationStage(stage:NarrationStage,input:{sql:LocalSql;database:Database;env:NodeJS.ProcessEnv;credential:Credential;host:string}){
 const {sql,database,credential,host}=input;
 const env={...input.env,APP_ORIGIN:'http://localhost:3000',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
 const provider:CalendarProvider={async refresh(value){return value;},async list(){return [{id:'narration-calendar',name:'Synthetic calendar',accessRole:'owner',primary:true,timeZone:'Asia/Seoul',color:null}];}};
 const selection=new CalendarSelection(database,env,provider),setup=new HostSetup(database,selection);
 const consent=new CalendarConsent(database,env,{authorization(){return 'https://accounts.google.com/synthetic';},async exchange(_code,_verifier,_nonce,kind){return {accessToken:'synthetic-narration-token',refreshToken:'synthetic-narration-refresh',subject:'synthetic-narration-subject',scopes:[...calendarScopes[kind]],expiresAt:Date.now()+3600000};}});
 const started=await consent.start(credential);assert.equal((await consent.callback(started.state,started.binding,'synthetic',false)).result,'connected');
 if(stage!=='calendars'){
  const catalog=await selection.list(credential);await selection.select(credential,{generation:catalog.generation,rulesVersion:catalog.rulesVersion,conflictCalendarIds:['narration-calendar'],bookingCalendarId:'narration-calendar'});
 }
 let state=await setup.read(credential);
 if(state.nextAction==='refresh_draft')state=await setup.rebase(credential,{expectedRevision:state.revision,rulesVersion:state.rulesVersion,idempotencyKey:randomUUID()});
 if(stage==='rich_scan'||stage==='sparse_scan'){
  const start=Temporal.Now.plainDateISO('Asia/Seoul'),end=start.add({days:28});
  const scans=new CalendarScans(database,env,provider,{async read(){return [{id:'narration-calendar',timezone:'Asia/Seoul',events:stage==='sparse_scan'?[]:Array.from({length:8},(_,n)=>({id:'synthetic-'+n,start:{dateTime:start.add({days:n}).toString()+'T09:00:00+09:00'},end:{dateTime:start.add({days:n}).toString()+'T10:00:00+09:00'},location:'Narration private venue sentinel'}))}];}});
  const scan=await scans.start(credential,{calendarIds:['narration-calendar'],startDate:start.toString(),endDate:end.toString(),timezone:'Asia/Seoul',expectedRevision:state.revision,rulesVersion:state.rulesVersion,generation:state.calendarGeneration!,consented:true,idempotencyKey:randomUUID()});
  assert.equal(scan.scan?.status,'ready');assert.equal(scan.scan?.summary?.windowSource,stage==='sparse_scan'?'starter':'calendar');
 }else if(['dismissed','answers','review','revoked'].includes(stage)){
  state=await setup.progress(credential,{expectedRevision:state.revision,choice:'skip_analysis',idempotencyKey:randomUUID()});
  if(stage==='dismissed'){
   for(const choice of ['dismiss_schedule','dismiss_mode'])state=await setup.progress(credential,{expectedRevision:state.revision,choice,idempotencyKey:randomUUID()});
  }else{
   const patch={rules:{timezone:'Asia/Seoul',durationMinutes:30,availability:[{days:[1,2,3,4,5],start:'13:00',end:'17:00'}],bufferMinutes:10,focusBlocks:[],preferences:'',meetingMode:'online'}};
   if(stage==='answers'){
    // Model-provenance fixture setup is deliberately distinct from a human
    // choice. The live turn must never promote it to explicit acceptance.
    await sql.query(`select fmat.host_setup_operation('draft',jsonb_build_object('kind','host','id',${q(host)},'email',(select email from fmat.hosts where id=${q(host)})),${q(JSON.stringify({expectedRevision:state.revision,patch,unresolved:[],idempotencyKey:randomUUID()}))}::jsonb,'assistant');`);
   }else{
    state=await setup.draft(credential,{expectedRevision:state.revision,idempotencyKey:randomUUID(),patch,unresolved:[]});
    assert.ok(state.review);
    if(stage==='revoked'){
     state=await setup.confirm(credential,{expectedRevision:state.revision,draftRevision:state.review.draftRevision,reviewRevision:state.review.revision,rulesVersion:state.rulesVersion,calendarGeneration:state.calendarGeneration!,confirmed:true,idempotencyKey:randomUUID()});
     assert.equal(state.nextAction,'settings_confirmed');await consent.disconnect(credential);
    }
   }
  }
 }
 state=await setup.read(credential);
 const expected:Record<NarrationStage,SetupStep>={calendars:'calendars',analysis:'analysis',rich_scan:'analysis_review',sparse_scan:'analysis_review',dismissed:'schedule',answers:'answers_review',review:'review',revoked:'connect'};
 assert.equal(setupGuide(state).step,expected[stage],`Fixture must reach the requested ${stage} before a paid model call`);
 if(stage==='answers')assert.equal(state.draft?.provenance['rules.meetingMode'],'assistant');
 return state as SetupState;
}
