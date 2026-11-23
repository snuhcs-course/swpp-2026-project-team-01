// Summarizes regression eval runs (documentation 13, "Regression evals on pull
// requests") from the artifacts `eve eval` writes under .eve/evals/<time>/.
//
//   npx tsx scripts/agent-evals.ts summary <artifact dir>...
//     Prints the pull request comment: runs passed per set and category, the
//     failed runs with the tag that reruns each case, and the assistant's
//     tokens. Exits 1 when a run failed or is missing. Reads FMAT_EVAL_TRIALS
//     as the runs did, so eval ids map back to cases; GITHUB_SHA and
//     EVAL_RUN_URL name the commit and the workflow run.
//
//   npx tsx scripts/agent-evals.ts journey <artifact dir>...
//     The simulated guest journeys: per case, pass^3 and pass@1, and per run
//     the guest turns and the assistant's tokens.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { APPROVAL_CASES } from "../evals/host-review/approval-cases";
import { DEFAULT_TRIALS as APPROVAL_TRIALS } from "../evals/host-review/approval-runner";
import { DEFENSE_CASES } from "../evals/requester/defense-cases";
import { DEFAULT_TRIALS as DEFENSE_TRIALS } from "../evals/requester/defense-runner";
import { JOURNEY_CASES } from "../evals/requester/journey-cases";
import { DEFAULT_TRIALS as JOURNEY_TRIALS } from "../evals/requester/journey-runner";
import { addUsage, type EvalResult, type EvalSet, evalIds, summaryMarkdown, type Usage, usageOf } from "../evals/summary";
import { evalTrials } from "../evals/tags";

const SETS: EvalSet[] = [
  { ids: evalIds(DEFENSE_CASES, "requester/defense/", (declared) => evalTrials(declared ?? DEFENSE_TRIALS)), name: "guest defense" },
  { ids: evalIds(APPROVAL_CASES, "host-review/approval/", (declared) => evalTrials(declared ?? APPROVAL_TRIALS)), name: "host approval" },
];

function read(directories: readonly string[]) {
  const results = new Map<string, EvalResult>();
  const usage: Usage = { cachedInputTokens: 0, inputTokens: 0, outputTokens: 0 };
  for (const directory of directories) {
    const file = path.join(directory, "results.jsonl");
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const result = JSON.parse(line) as { id: string; verdict: string; assertions?: { key: string; passed: boolean }[] };
      results.set(result.id, {
        failed: (result.assertions ?? []).filter((assertion) => !assertion.passed).map((assertion) => assertion.key),
        id: result.id,
        verdict: result.verdict,
      });
      const events = artifactPath(directory, result.id, ".events.ndjson");
      if (existsSync(events)) addUsage(usage, usageOf(readFileSync(events, "utf8")));
    }
  }
  return { results, usage };
}

const artifactPath = (directory: string, id: string, suffix: string) =>
  path.join(directory, "evals", `${id.split("/").map((part) => part.replace(/[^a-zA-Z0-9_-]/g, "_")).join("/")}${suffix}`);

function journey(directories: readonly string[]) {
  const ids = evalIds(JOURNEY_CASES.map((entry) => ({ ...entry, category: entry.style })), "requester/journey/", (declared) => evalTrials(declared ?? JOURNEY_TRIALS));
  const { results } = read(directories);
  const byCase = new Map<string, { passed: number; runs: string[]; total: number }>();
  for (const [id, ref] of ids) {
    const result = results.get(id);
    if (!result) continue;
    const directory = directories.find((candidate) => existsSync(artifactPath(candidate, id, ".json")));
    const logs = directory ? readFileSync(artifactPath(directory, id, ".json"), "utf8") : "";
    const turns = /guest turns: (\d+)/.exec(logs)?.[1] ?? "?";
    const usage = directory && existsSync(artifactPath(directory, id, ".events.ndjson")) ? usageOf(readFileSync(artifactPath(directory, id, ".events.ndjson"), "utf8")) : null;
    const row = byCase.get(ref.caseId) ?? { passed: 0, runs: [], total: 0 };
    row.total++;
    if (result.verdict === "passed") row.passed++;
    row.runs.push(`run ${ref.trial}: ${result.verdict}, ${turns} guest turns, ${usage ? `${usage.inputTokens} input (${usage.cachedInputTokens} cached) and ${usage.outputTokens} output tokens` : "no events"}${result.failed.length ? `; failed: ${result.failed.join(" | ")}` : ""}`);
    byCase.set(ref.caseId, row);
  }
  const rows = [...byCase.values()];
  const runs = rows.reduce((sum, row) => sum + row.total, 0);
  const passedRuns = rows.reduce((sum, row) => sum + row.passed, 0);
  console.log(`journeys: pass^3 ${rows.filter((row) => row.passed === row.total).length}/${rows.length} cases; pass@1 ${passedRuns}/${runs} runs`);
  for (const [caseId, row] of byCase) {
    console.log(`  ${caseId}: ${row.passed}/${row.total}`);
    for (const run of row.runs) console.log(`    ${run}`);
  }
}

const [command, ...directories] = process.argv.slice(2);
if ((command !== "summary" && command !== "journey") || directories.length === 0) {
  console.error("usage: agent-evals.ts summary|journey <artifact dir>...");
  process.exit(1);
}

if (command === "journey") {
  journey(directories);
} else {
  const { results, usage } = read(directories);
  process.stdout.write(
    summaryMarkdown({
      commit: (process.env.GITHUB_SHA ?? "local").slice(0, 8),
      results,
      runUrl: process.env.EVAL_RUN_URL ?? null,
      sets: SETS,
      usage,
    }),
  );
  const expected = SETS.flatMap((set) => [...set.ids.keys()]);
  if (expected.some((id) => results.get(id)?.verdict !== "passed")) process.exitCode = 1;
}
