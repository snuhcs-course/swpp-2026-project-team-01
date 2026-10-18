# Design

## Context

See [proposal](proposal.md). `requestExtractionInput` currently adds an intent discriminator to `detailsProposalInput` but inherits arbitrary clarification strings. The extraction adapter removes the model intent, then the database persists strings verbatim. The review card displays them under More information needed. The old extractor replaced its single clarification with fixed wording in every language.

## Goals / Non-Goals

**Goals:** eliminate arbitrary model prose from newly generated review clarifications, retain useful missing-field questions in English/Korean and preserve the current domain/API separation.

**Non-Goals:** filter arbitrary generated chat, rewrite previously stored reviews, classify human language perfectly, sanitize user-authored purpose/location text or change external authorized agent inputs. Those are not certified by this bounded correction.

## Decisions

1. Narrow model `clarifications` to the supported categories `requesterName`, `requesterEmail`, `purpose`, `durationMinutes`, `timezone`, `windows`, `mode`, `location` and `request`. Add optional `clarificationLanguage` with only `en`/`ko`; omission selects English in the adapter. Existing complete drafts with `[]` need no new language field. Retain the base nonempty result and uncertain-intent empty-patch checks.
2. Use a checked-in bilingual dictionary without interpolation. Map validated categories to authored questions in `proposeRequestExtraction`, remove the language and intent metadata, then invoke the unchanged domain proposal path. Regex claim filtering was rejected because it cannot cover arbitrary language or preserve legitimate text reliably. One generic sentence for all categories would lose useful clarification specificity.
3. Keep browser and external agent schemas unchanged. Newly saved model reviews contain ordinary authored strings and use the existing rendering/apply guard. Historical reviews are not silently rewritten; their retention and broader prose policy remain separate.
4. Preserve the selected category order and repeatable mapping. The database continues to compare immutable resulting draft payloads under the same accepted-message retry key. Changed language/wording conflicts rather than silently overwriting a committed review. Treat dictionary wording as part of that payload contract; later wording revisions require reviewing retry compatibility.
5. Update model guidance to select categories and the requester's English/Korean language, use `request` when no specific field fits, and ask one unresolved question at a time. Category choice itself does not establish missing facts, verification or consent.

## Risks / Trade-offs

- A category may be too broad for a nuanced question → use the authored general request question in the card and continue clarification in conversation; never insert unchecked prose into the card.
- Existing tool calls contain prose → reject safely before RPC; normal model recovery can use the new schema without manufacturing an outcome.
- A valid category is semantically wrong → retain explicit review and live interpretation acceptance; do not claim model-quality guarantees from structural validation.
- Ordinary chat or external agent text still asserts a false status → keep that broader narration obligation explicit; this restores the retired application extractor's clarification guarantee only.

## Migration Plan

No SQL migration or browser component edit. Implement and verify schema/adapter bilingual and malicious-prose tests, actual Responses fixtures and real review/retry/non-application acceptance. Run runtime regressions, post-fixture SQL, checks/builds and smoke. Deploy a scanned committed archive to the verified release target, verify exact Ready alias and HTTP guards, then sync/archive with scope limits recorded.
