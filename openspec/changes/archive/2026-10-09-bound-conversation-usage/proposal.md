# Proposal

## Why

The [release plan](../../../../documentations/technical_specification/04_implementation_plan.md) requires concrete enforced runtime limits. Lifetime conversation caps alone allow rapid model starts across scopes and channels.

## What Changes

- Enforce shared host/request and service message-admission budgets before new runtime input is committed.
- Preserve accepted retry receipts without charging again; recheck current authority after budget lock waits.
- Report temporary throttling on web and defer authenticated messaging receipts without losing their order or consuming provider failure attempts.
- Document exact limits and their separation from model-token and dollar-spend limits.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chat-workspaces`: bounded conversation admission and recoverable temporary throttling, extending [safe recovery](../../../specs/chat-workspaces/spec.md).

## Impact

Private PostgreSQL quota state, runtime acceptance, Photon and AgentMail dispatch, public error mapping, SQL/concurrency/channel tests and operations documentation. No dependency or provider configuration change. Model dollar budgets, retention/deletion and backups remain separate release obligations.
