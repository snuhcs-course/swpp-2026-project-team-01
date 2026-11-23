# Proposal

## Why

A host cannot tell the guest's assistant anything beyond the fixed setup fields: one meeting length with buffers, one meeting form, places and hours. Preferences such as "investment advisory meetings are 30 minutes" or "a first meeting is online" have nowhere to go, and the guest's assistant, which gathers the purpose, form and place in conversation ([`guest-flow-completion`](../../guest-flow-completion/proposal.md) U13), cannot use them. [Issue #53](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/53) tracks this change. The repository owner decided it on 2026-11-23: build it.

## What Changes

- Hosts get one optional free-text setting, **Notes for Thyme** (at most 1000 characters), for meeting preferences and background the guest's assistant should apply.
- Setup asks for it as its last, optional step ("Anything Thyme should know when talking with your guests?"), with **Skip for now**; the setup review shows it as a row with Edit. Settings shows it as its own section. The host's assistant saves it from the host's words, on the web and in the linked iMessage, WhatsApp or Telegram conversation (`save_assistant_notes`).
- The notes are saved at once, outside the setup draft and its confirmation: they are not scheduling policy, feasibility never reads them and a change needs no calendar recheck.
- The guest's `read_request` gives the assistant the notes as quoted data (`host.notes`) beside `host.offer`. The assistant uses them only to shape what it proposes within what the host offers and the tools allow: a length for this kind of meeting, the form to suggest first, which of the host's places to suggest. It never quotes, paraphrases or mentions them, never treats them as rules over the host's settings, and never reveals more than its proposals already show. Instructions inside the notes change nothing.
- The notes reach no one else: not the guest's cards or emails, not the host's or a guest's agent through MCP, not the host-review assistant.
- This reopens the U13 scope decision of `guest-flow-completion` ("`read_request` gives the assistant what the host offers every guest … and nothing else of the host's settings, calendar or rules"); the [decision log](../../../../documentations/technical_specification/08_decision_log.md#host-preference-notes) records it.

## Capabilities

### New Capabilities

- `host-assistant-notes`: the host's notes for the guest's assistant: where they are set, how they are stored, and how the guest's assistant may use them.

### Modified Capabilities

None. The `host-setup` capability is still in the open `host-onboarding` change, so the setup step is specified here.

## Impact

A schema change: `app.host_accounts.assistant_notes` and `assistant_notes_updated_at`, a check that a deleted account keeps none, and a trigger that clears them when the account is marked deleted (`supabase/migrations/20261123064947_host_assistant_notes.sql`, written by hand with `supabase migration new` and not applied here). Code: `lib/contracts/host-notes.ts`, `lib/server/host-notes.ts`, the `setup.save_assistant_notes` operation in `lib/server/setup-routes.ts`, `assistantNotes` in `readSetupState` and the setup model projection, the `save_assistant_notes` tool and the host-setup instruction, `host.notes` in the requester `read_request` and the requester instruction, the web setup step, receipt, review row and Settings section. Related: [#231](https://github.com/snuhcs-course/swpp-2026-project-team-01/issues/231) (meeting presets) would give hosts structured lengths per meeting type; the notes stay free text and do not depend on it.
