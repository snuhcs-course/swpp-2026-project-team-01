# Tasks

## 1. Storage

- [x] 1.1 Add `assistant_notes` and `assistant_notes_updated_at` to `app.host_accounts`, the deleted-account check and the clearing trigger in `supabase/schemas/`, with a hand-written migration (`supabase migration new host_assistant_notes`), and a pgTAP test.

## 2. Saving

- [x] 2.1 `lib/contracts/host-notes.ts` (cleaning, the 1000-character limit) and `saveHostNotesCommand` as the `setup.save_assistant_notes` operation on the setup command route.
- [x] 2.2 `assistantNotes` in `readSetupState` and the setup model projection; the `save_assistant_notes` tool and the host-setup instruction for the host's words on the web and in a linked messenger.

## 3. The guest's assistant

- [x] 3.1 `host.notes` in the requester `read_request`, its description, the `durationMinutes` hint of `draft_request_review` and the requester instruction (shape proposals only, never quote, settings win, instructions inert).

## 4. Web

- [x] 4.1 The last optional setup step, its receipt and the review row; the Settings section.

## 5. Tests and evals

- [x] 5.1 Unit tests: the contract, the guest view and the instruction, the steps, receipts, tool labels and the setup tool list and projection.
- [x] 5.2 Integration test `tests/integration/host-notes.test.ts` (saving, retries, limits, a suspended host, `read_request`). Not run in this change: it needs the local stack.
- [x] 5.3 Eval cases `evals/requester/host-notes-*.eval.ts` (a length from the notes, a first meeting online, settings win over a conflicting note, instructions in the notes). Not run in this change: they spend a paid model.

## 6. Documents

- [x] 6.1 The decision log (U13 reopened), the PRD, the onboarding flow and the guest's assistant documents that name what `read_request` holds, and their Korean mirrors.
