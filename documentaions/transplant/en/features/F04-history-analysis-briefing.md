# F04 — History analysis: AI classification, code estimates, briefing and Q&A

## Intent
- Remove the work of re-reading one's own calendar to fill a settings form: the app reads the past 8 weeks and *suggests* work hours, usual meeting times and places. `[doc one_pager §1]` `[commit c0ccfb9]`
- Keep the model's job tiny and checkable (label each title business/personal/unknown); every number in the briefing is computed by code and always called an estimate. `[commit c0ccfb9]`
- Answer "what did you think my hours were?" from stored numbers instead of a canned reply. `[commit 22fd5b5]`
- Each re-analysis restarts the conversation because earlier replies described the old reading. `[code comment]` `[commit 22fd5b5]`

## How the user is led
- Triggered automatically by "AI로 설정 시작하기" (F02) or by the bar above the onboarding chat: text "Calendar에서 가져온 지난 8주 일정을 AI가 살펴봐요" + button **가져온 일정 분석하기**; after a run, text "다시 분석하면 대화가 새로 시작돼요. 입력한 설정은 그대로예요." + **다시 분석**. Shown only when a calendar import exists.
- The result appears as the first assistant message in the onboarding chat, e.g. (sentence templates from `core/briefing.ts describeHistory`; the numbers below are illustrative, not real output):
  - "지난 8주 일정 N건 중 업무 a건, 개인 b건, 확인 필요 c건을 관찰했어요."
  - "업무 일정은 화요일 5건, 목요일 4건 …에 있었어요. 이 요일을 선호하시나요?"
  - "지난 업무 일정 k건으로 짐작해 보면, 예상 근무시간은 평일 10:00–18:00이고, 기존 미팅은 주로 14:00–16:30 사이에 시작했어요."
  - "업무 일정 장소는 회사 6건, 온라인 3건이라 회사를 선호하시는 것 같아요."
  - "저녁 업무 일정도 n건 있었지만, 앞으로 그 시간에 미팅을 허용한다는 뜻은 아니에요."
  - Always ends "모두 지난 일정에서 본 경향이라, 맞으면 직접 설정에 반영하거나 말로 고쳐 주세요."
  - Thin data: "업무 일정이 N건뿐이라 근무시간이나 미팅 시간을 추정하기는 어려워요. 직접 알려 주세요."
- Questions in chat (regex `historyQuestion`: ends with ?, or contains 어떻게/뭐/몇 시/언제/어디/알려줘/추정/짐작/분석 …; topics by 근무/미팅/장소 keywords) get `answerFromHistory` answers, always ending "지난 일정에서 본 경향일 뿐이니 …".

## Rules (verified)
- Preconditions: calendar `connected` with an analysis snapshot (full import), else `calendar_snapshot_changed` "선택한 캘린더를 먼저 가져와 주세요".
- Window: `[kstDayStart(snapshot.startedAt) − 56 d, kstDayStart(snapshot.startedAt))`.
- Classification (`llm/classify.ts`): batches of ≤40; only integer indexes + title + times cross the model boundary (provider ids never do); system prompt marks titles as untrusted, forbids inferring permission/work hours, forces `unknown` for mixed/social titles (dinner, lunch, golf, networking, coffee chat). Per-item validation; unusable output → split in halves (max depth 3, max 12 calls); partly usable → re-ask only missing items; service outage → stop. `numPredict = 128 + 16·n`.
- Budget per analysis: at most 120 not-yet-cached events, stop new batches after 65 s; hard timeout 90 s.
- Cache: `event_classifications` keyed by (connection, calendar, provider event, content fingerprint, model, `CLASSIFICATION_SCHEMA_VERSION=2`). Bump the version when labelling rules change.
- Aggregation (`core/analysis.ts analyzeHistory`): counts by label; `coverage {eligible, classified, partial}`; business by weekday; late business (start ≥ 18:00).
- Estimates (`estimateFromBusiness`), from business events < 12 h within one day:
  - `MIN_EVENTS_FOR_ESTIMATE = 4`.
  - workHours only if ≥ 4 events, ≥ 3 days, and the median day has ≥ 2 business events: start = 10th percentile of daily first starts (floored to :00/:30), end = 90th percentile of daily last ends (ceiled), weekdays = those seen.
  - meetingStarts = interquartile range of starts of business events ≤ 3 h.
  - places = location kinds of business events, most frequent first.
- Commit: inserts classification proposals in batches, `analysis_runs` (summary JSON), `analysis_evidence`, **deletes all draft messages**, inserts the briefing message carrying `evidence_id`, links `profile_drafts.analysis_id`. Fails with `source_changed` if snapshot or annotations changed during the run.
- Disconnect / selection change replaces evidence-bearing messages with "근거 제거됨" and deletes analyses (`clearDerived`).

## Data / API
`POST /api/profile-drafts/:id/analyze {expectedRevision}` → `ProfileDraftView`. Tables `analysis_runs`, `analysis_evidence`, `event_classifications`, `profile_drafts.analysis_id`.

## Code map
`server/services/analysis.ts`, `core/analysis.ts`, `core/briefing.ts`, `llm/classify.ts`, `server/services/onboarding.ts` (Q&A hook), `components/onboarding/OnboardingWorkspace.tsx` (analysis bar), `components/calendar/CalendarSettings.tsx` (auto run). Live evaluation script: `scripts/eval-onboarding.ts`.

## Depends on / used by
Depends on F02 (analysis snapshot), F03 (user labels). Used by F05 (briefing message, Q&A).

## Transplant unit
- `core/analysis.ts` + `core/briefing.ts` are pure and portable; they need only `AnalysisEvent[]` with a classification.
- `llm/classify.ts` is provider-agnostic through `ChatClient {chat(messages, opts)}`; keep the "indexes only", "untrusted titles", split/retry strategy.
- Keep the wording rules: every estimate is labelled as such and never auto-applied (P3, P4).
