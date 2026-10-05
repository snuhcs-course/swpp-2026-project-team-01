# Cross-cutting mechanisms (AI-facing)

## 1. Idempotent operations (every non-trivial mutation)
- Client: `useMutationOperation()` freezes `{method,url,kind,payload,schema}` and a fresh `crypto.randomUUID()` key; sends header `Idempotency-Key`. Phases `idle → submitting → reconciling`. If the response is not a definite "not applied", phase becomes `reconciling` and the UI shows a "… 결과 확인" button that calls `recover()`: reads `/api/operations/:id` or `/api/operations?kind&key`, and if still unknown re-sends **the same frozen command and key**. (`components/hooks/useMutationOperation.ts`, `components/api.ts request`)
- Server: `beginOperation(ctx, actor, kind, input, {key})` under advisory lock `operation:<actor>:<kind>:<key>`; same key + different payload hash → `idempotency_key_reused`; succeeded → replay stored result; failed_final → rethrow; running with live lease → `operation_pending`; expired lease → reclaim with `fence+1`. `finishOperation` runs the mutation and records the result in **one** transaction after `assertOperation` (fence + lease) — external I/O must happen before it. `failOperation` stores retryable vs final. (`server/services/operations.ts`, table `mutation_operations`)
- Response envelope (`contracts/common.ts ApiResult`): `{ok:true,data,meta}` | `{ok:false,error:{code,message,retryable,fieldErrors?,currentRevision?},meta:{operationId?,outcome:'not_applied'|'pending'|'unknown'}}`. Error codes are a closed enum (30 codes).
- Legacy screens (host places/types, app events, user switch) still use `call()` without idempotency.

## 2. Optimistic concurrency
`revision` on drafts, searches, requests, annotations, calendar connection (`revision`, `selection_revision`, `generation`), users (`schedule_revision`, `host_settings_revision`, `annotation_revision`, `calendar_use_revision`, `current_profile_version`). Clients send `expectedRevision`; mismatches → `revision_conflict` with `currentRevision`.

## 3. Preflight receipts (fresh data at commitment points)
`preflightCalendars(ctx, userIds, key)` for search create/turn/conditions/refresh, request send and accept: each participant must be setup-ready (`setup_required`); `reconnect_required` / `decision_required` stop the action; connected users get a `future` sync. Returns receipts `{generation, selectionRevision, calendarUseRevision}`; `checkReceipts` inside the committing transaction rejects with `calendar_snapshot_changed` (retryable) if anything moved. (`server/services/preflight.ts`)

## 4. Locks
Postgres advisory transaction locks (`server/db/client.ts lock`), always acquired in sorted order: `user:<id>` pairs for booking mutations, `profile:<id>`, `annotation:<id>`, `calendar:<connectionId>` + `service_leases`, `contacts:<a>:<b>`, `auth:<subject>`, `calendar-use:<id>`, `connection-create:<id>`. Verified in the port notes: two concurrent accepts → one success, one `revision_conflict` `[doc postgres_port.md]`.

## 5. LLM boundary
- Single adapter `llm/ollama.ts` (`ChatClient.chat(messages,{json,numPredict,temperature,think})`), ported from kibitzer `postChat`: key pool `OLLAMA_API_KEY_1..3` rotated per call and on 401/403/429; one 20 s deadline covering the body read; `done_reason=length` in JSON mode → `ModelTruncatedError`; `extractJson` tolerates code fences, `//` comments and trailing commas.
- Failure taxonomy: `unparseable` (model answered, unusable) vs `unavailable` (HTTP/timeout/network) — surfaced differently.
- Live call sites: `interpret` (search), `interpretOnboarding` (profile patch), `classifyEvents` (labels). All JSON mode, temperature 0, Zod-validated, ≤1 retry (classification: split strategy).
- Prompt-injection stance: titles and user text are declared data; outputs are allow-listed (ids must exist, ranges clamped).
- Model: `OLLAMA_MODEL` default `gemma4:31b`.

## 6. Privacy and data scope
- RLS enabled on every table with no policies; `anon`/`authenticated` privileges revoked; only the server connects via `DATABASE_URL` (Supabase transaction pooler, `prepare:false`).
- Imported fields: title, description, location, status, transparency, times, recurrence ids, attendee **self** response only, a boolean "has online link" in the normalised source (hangoutLink/conferenceData only enter a fingerprint). Attachments and other attendees are not parsed (`calendar-sync.ts googleEvent` schema).
- Counter-party sees: host places/meeting types, candidate labels, request message. Never the other person's events.
- Logs (`server/log.ts`, JSON lines, `LOG_LEVEL=silent`): event names `analysis.classify`, `calendar.event_invalid_time` (shape only), `api.*`, `chat.*` (legacy), `request.*` (legacy). No titles, places, message bodies or tokens.

## 7. Deployment facts
`vercel.json regions: ["icn1"]` next to the Seoul database `[commit 1843e51]`. Dev/start bind to 127.0.0.1. `npm run dev:mock` runs a demo instance on :3100 with its own build dir.

## 8. Tests
Vitest; server tests run on PGlite with the real migrations (`tests/server/helpers.ts`); fixtures for Google provider and onboarding scenarios; component tests with Testing Library. Live-model evals: `scripts/eval-interpret.ts`, `scripts/eval-onboarding.ts`.
