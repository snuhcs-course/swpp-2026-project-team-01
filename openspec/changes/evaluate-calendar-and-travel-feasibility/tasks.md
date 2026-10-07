# Tasks

Tasks describe replacement implementation and verification. Completed pure-core tasks do not establish live provider compatibility or full request/booking acceptance.


## 1. Deterministic availability

- [x] 1.1 Implement half-open interval checks, daily IANA-timezone rules, focus/busy/buffers, duration, and requester intersections; verify DST, ambiguous/nonexistent input, boundary overlaps, and both parties' busy cases.
- [x] 1.2 Implement typed Calendar reads that distinguish denied/revoked/failed reads from empty results; verify dependent evaluation pauses and explicit manual replacement restores only authorized availability.
- [ ] 1.3 Persist candidate context/rule versions and protect asynchronous saves; verify request/rule changes reject stale candidates.
- [x] 1.4 Document hard versus preference rules and timezone semantics; verify documented examples against deterministic tests.

## 2. Travel and private exceptions

- [x] 2.1 Implement Google Routes adapter with selected travel mode, departure context, deadlines, and explicit no-route/failure outputs; verify unsupported geography/mode routes remain unresolved.
- [ ] 2.2 Implement previous-to-candidate and candidate-to-next travel with margins and context freshness; verify each direction independently excludes insufficient gaps and changed context requires recomputation.
- [ ] 2.3 Add explicit authenticated manual leg allowances and private preference exceptions bound to current details/rules; verify no hard-conflict waiver, no implicit model exception, and guest redaction.
- [ ] 2.4 Add desired SQL/migration for evaluation context and exception records; verify local reset, constraints, and service-only access.
- [ ] 2.5 Document supported tested modes/geography and manual resolution behavior; verify coverage claims match actual probes and unknown locations remain clarification.

## 3. Ranking and proposal integration

- [ ] 3.1 Implement structured ranking over already-valid candidate IDs; verify model suggestions cannot invent intervals, waive constraints, or overwrite stale results.
- [ ] 3.2 Wire evaluation/no-match clarification and private host exception UI to request lifecycle; verify account-free requester can select a feasible current proposal without seeing private rules.
- [ ] 3.3 Record AC-02/AC-03/AC-12/AC-27 integration evidence and expose the same evaluator for booking revalidation; verify changed requester availability and travel context block later dispatch.
