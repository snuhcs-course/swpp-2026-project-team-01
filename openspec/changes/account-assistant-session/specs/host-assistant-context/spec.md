## Purpose

Keep the account assistant current about scheduling state and unresolved questions while remembering only the host's eligible private context, isolated from all requester audiences.

## ADDED Requirements

### Requirement: Fresh scheduling state
Each account turn SHALL receive current DB state: pending decision refs, versions and times, bookings for the next seven days, sent requests through requester projection, setup step, current time and timezone. This snapshot SHALL replace the earlier snapshot, SHALL NOT become durable remembered facts or summary content, and SHALL NOT substitute for current command checks.

#### Scenario: State changes between turns
- **WHEN** a request is decided on the web before the account's next messenger turn
- **THEN** the next snapshot reflects that decision and contains no stale pending decision from the prior snapshot

#### Scenario: Context compaction
- **WHEN** history is compacted
- **THEN** recalled snapshots are excluded from the summary and fresh state is recalled again instead of replaying a summarized snapshot

### Requirement: Open-item ledger
The account SHALL keep its latest unanswered assistant question with target ref, direction and relevant version, plus host-deferred items not represented in domain state. Answered or superseded questions SHALL be cleared or replaced. A notice SHALL NOT change this ledger. An unqualified answer SHALL never authorize action on a stale or ambiguous target.

#### Scenario: Deferred item
- **WHEN** the host says to return to a question later
- **THEN** it is retained as deferred context without approving, declining or changing any request

#### Scenario: Proposal changed before yes
- **WHEN** the host answers yes after the pending question's proposal version changes
- **THEN** no old proposal is approved and the assistant asks about the current one

### Requirement: Private memory eligibility
Only the host's own statements about non-authoritative preferences, persona, relationships, priorities, soft tendencies or dated life context SHALL enter private memory. Requester names/purposes, calendar titles, guest quotations and tool-derived data SHALL NOT enter it. Memory SHALL never decide feasibility. A rule-like preference SHALL be offered through settings changes instead of saved as memory.

#### Scenario: Soft preference
- **WHEN** the host states a soft tendency to avoid Friday afternoons
- **THEN** it can inform conversation but cannot make a time infeasible or change confirmed policy

#### Scenario: Rule-like instruction
- **WHEN** the host asks never to offer Friday afternoons
- **THEN** the assistant offers the existing settings-change flow instead of remembering a hidden scheduling rule

#### Scenario: Requester details in input
- **WHEN** a message or tool result includes a requester's name/purpose or calendar event title
- **THEN** none of those details is persisted as private host memory

### Requirement: Visible memory control
The assistant MAY save eligible memory without an explicit remember request, but SHALL acknowledge every save with one line. The host SHALL be able to list and forget memories in words. Forgotten or expired items SHALL be absent from subsequent recall and SHALL NOT be recreated by replay or compaction capture. Forgetting memory SHALL NOT claim to erase ordinary conversation history.

#### Scenario: Automatic save
- **WHEN** the assistant saves an eligible soft preference
- **THEN** its reply includes a one-line notice such as "금요일 오후는 피하시는 걸로 기억해 둘게요"

#### Scenario: List and forget
- **WHEN** the host asks what is remembered and then asks to forget one listed memory
- **THEN** the eligible stored memories are listed and the selected item is removed from future recall, including after compaction

### Requirement: Private context lifecycle and isolation
Ledger and private memory SHALL be account-owned, retained under application retention/deletion controls and deleted with the account. Dated memory SHALL expire and resolved ledger items SHALL be removed. No requester session or requester projection SHALL receive the account's ledger or private memory, including through guest-facing host notes. Recent history SHALL remain verbatim until normal runtime compaction.

#### Scenario: Dated context expires
- **WHEN** the remembered context "exams until mid-December" reaches its recorded expiry
- **THEN** it is no longer recalled and retention removes its stored entry

#### Scenario: Account deletion
- **WHEN** the existing operator or scheduled account deletion completes
- **THEN** its ledger and private memory are deleted and cannot be restored by a retried provider capture

#### Scenario: Requester asks for memory
- **WHEN** an anonymous requester or another account acting as requester asks for the receiving host's preferences or pending questions
- **THEN** neither memory nor ledger is registered or serialized into that requester context, including host.notes

#### Scenario: Recent conversation
- **WHEN** a turn proceeds before normal compaction is triggered
- **THEN** recent runtime turns remain verbatim; no fixed last-N-turn rotation truncates them
