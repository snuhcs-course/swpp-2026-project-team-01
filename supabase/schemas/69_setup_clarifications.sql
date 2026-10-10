-- Fixed application wording only. Never interpolate caller text. Keep existing
-- wording recognized when adding revisions so pending browser edits can round-trip.
create or replace function fmat.setup_clarification_questions(p_values text[])
returns text[] language sql immutable set search_path='' as $$
 with questions(code,question) as (values
  ('en:displayName','What name should your booking page display?'),
  ('ko:displayName','예약 페이지에 어떤 이름을 표시할까요?'),
  ('en:handle','Which public booking handle would you like?'),
  ('ko:handle','공개 예약 주소에 어떤 이름을 사용할까요?'),
  ('en:timezone','Which timezone should we use for your schedule?'),
  ('ko:timezone','일정에 어떤 시간대를 사용할까요?'),
  ('en:durationMinutes','How long should meetings last?'),
  ('ko:durationMinutes','회의는 얼마나 진행할까요?'),
  ('en:availability','Which weekdays and start and end times work for meetings?'),
  ('ko:availability','회의가 가능한 요일과 시작·종료 시간을 알려 주세요.'),
  ('en:focusBlocks','Which times should be kept free of meetings?'),
  ('ko:focusBlocks','회의를 잡지 않을 시간을 알려 주세요.'),
  ('en:bufferMinutes','How many minutes should separate meetings?'),
  ('ko:bufferMinutes','회의 사이에 몇 분의 여유를 둘까요?'),
  ('en:preferences','What other scheduling preferences should we consider?'),
  ('ko:preferences','추가로 고려할 일정 선호 사항이 있나요?'),
  ('en:meetingMode','Do you prefer online meetings, in-person meetings, or either?'),
  ('ko:meetingMode','온라인, 대면 또는 둘 다 중 어떤 방식을 선호하시나요?'),
  ('en:location','Which areas or venues do you prefer, or will you decide per meeting?'),
  ('ko:location','선호하는 지역이나 장소가 있나요, 아니면 회의마다 정하시겠어요?'),
  ('en:travelMode','How do you usually travel, or will you decide per trip?'),
  ('ko:travelMode','주로 어떻게 이동하시나요, 아니면 이동할 때마다 정하시겠어요?'),
  ('en:travelBufferMinutes','How many extra minutes should we allow beyond estimated travel time?'),
  ('ko:travelBufferMinutes','예상 이동 시간 외에 몇 분의 여유를 더 둘까요?'),
  ('en:setup','What would you like to clarify or change about your setup preferences?'),
  ('ko:setup','설정 선호 사항에서 어떤 내용을 명확히 하거나 변경하고 싶으신가요?')
 )
 select coalesce(array_agg(coalesce(
  (select q.question from questions q where q.code=v.value or q.question=v.value limit 1),
  'What would you like to clarify or change about your setup preferences?'
 ) order by v.position),'{}'::text[])
 from unnest(p_values) with ordinality v(value,position);
$$;
revoke all on function fmat.setup_clarification_questions(text[]) from public,anon,authenticated,service_role;
