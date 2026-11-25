# Spec Delta

## ADDED Requirements

### Requirement: Weekly-limit hold notice in the linked host conversation
When a requester has no selectable time because every otherwise feasible candidate is in a week at the host's weekly limit, the service SHALL notify an actively linked host once for that request and current request and settings revisions. The message SHALL name the request and limit, explain that the guest is waiting for a time, and offer a one-request waiver in words. It SHALL NOT imply a booking or tell the host that their general weekly limit has changed. A stale notice SHALL NOT be sent after the hold or relevant revisions change.

#### Scenario: All times held by the weekly limit
- **WHEN** a requester evaluation finds only otherwise feasible times in weeks at the weekly limit
- **THEN** one notice tells the linked host which request is waiting and asks whether to allow this request beyond the limit

#### Scenario: Hold no longer current
- **WHEN** a queued notice's request or settings revision no longer matches, or the weekly-limit hold is gone
- **THEN** that notice is not sent

### Requirement: Host exception actions in the linked conversation
In a private review discussion reached from a linked iMessage, Telegram or WhatsApp message, the assistant SHALL let the host explicitly waive the weekly limit for the current request or allow 5–240 minutes, in five-minute steps, for one unresolved host trip of a current candidate. It SHALL use the same guarded commands as the web and MCP, and SHALL reject a web turn, stale evaluation, closed request or unsupported trip without changing anything. The result SHALL distinguish an exception recorded from newly checked candidate times. These actions SHALL NOT change the host's general settings, bypass busy time or book a meeting.

#### Scenario: One-request waiver
- **WHEN** the host clearly says to let the current request exceed the weekly limit in the linked conversation
- **THEN** only that request receives a waiver and its times are checked again

#### Scenario: Host trip allowance
- **WHEN** the host clearly allows 30 minutes for one unresolved host trip shown in the current evaluation
- **THEN** only that trip receives the allowance and its times are checked again

#### Scenario: Unsupported turn
- **WHEN** a turn came from the web, the evaluation is stale or the request is closed
- **THEN** no exception is recorded and the host is told what remains unresolved

### Requirement: Host question reaches the guest's conversation
When a linked host explicitly asks the assistant to ask a short free-form question about an open request, the service SHALL record it once in that request's guest web conversation and, if the guest has an active linked messenger, queue the same question there. The notice SHALL identify it as a question from the meeting host, keep the host's words as data, and invite the guest to answer in their conversation. A question SHALL NOT approve, decline, change details or book the request. A web turn, a sample request, a closed request or a repeated call SHALL NOT create another question.

#### Scenario: Host asks the guest
- **WHEN** the host says "Ask the guest whether they need parking" from their linked request conversation
- **THEN** the guest sees a host question in the web conversation and receives the same question in their linked messenger when one is active

#### Scenario: Repeated or unsupported call
- **WHEN** the tool call is retried, or the host's turn is not from a linked channel
- **THEN** no duplicate question is posted
