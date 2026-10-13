import {z} from 'zod';

export const requestClarificationKind=z.enum(['requesterName','requesterEmail','purpose','durationMinutes','timezone','windows','mode','location','request']);
export const requestClarificationLanguage=z.enum(['en','ko']);
type Kind=z.infer<typeof requestClarificationKind>;
type Language=z.infer<typeof requestClarificationLanguage>;

// Authored wording is part of the immutable review payload. Review exact-retry
// compatibility before changing it; never interpolate model or user prose here.
export const requestClarificationQuestions={
 en:{
  requesterName:'What name should be shown on the meeting request?',
  requesterEmail:'Which email address should receive the meeting invitation?',
  purpose:'What would you like to discuss?',
  durationMinutes:'How long should the meeting last?',
  timezone:'Which timezone should we use?',
  windows:'Which dates, start and end times, and timezone work for you?',
  mode:'Should the meeting be online or in person?',
  location:'Which meeting location or online link should we use?',
  request:'What would you like to clarify or change about this request?',
 },
 ko:{
  requesterName:'회의 요청에 어떤 이름을 표시할까요?',
  requesterEmail:'어떤 이메일 주소로 회의 초대를 받으시겠어요?',
  purpose:'어떤 내용을 논의하고 싶으신가요?',
  durationMinutes:'회의는 얼마나 진행할까요?',
  timezone:'어떤 시간대를 기준으로 할까요?',
  windows:'가능한 날짜와 시작·종료 시간, 시간대를 알려 주세요.',
  mode:'온라인으로 만날까요, 대면으로 만날까요?',
  location:'어떤 회의 장소나 온라인 링크를 사용할까요?',
  request:'이 요청에서 어떤 내용을 명확히 하거나 변경하고 싶으신가요?',
 },
} satisfies Record<Language,Record<Kind,string>>;
