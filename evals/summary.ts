// Summarizes regression eval runs for a pull request comment (documentation 13,
// "Regression evals on pull requests"): pass rate per set and category, the
// failing cases with the tag that reruns them, and the assistant's tokens.
// Pure functions over what `eve eval` writes under .eve/evals/<time>/; the
// file reading lives in scripts/agent-evals.ts.

export type EvalResult = { readonly id: string; readonly verdict: string; readonly failed: readonly string[] };

export type Usage = { inputTokens: number; cachedInputTokens: number; outputTokens: number };

export type CaseRef = { readonly caseId: string; readonly category: string; readonly trial: number };

export type EvalSet = {
  readonly name: string;
  // eve eval ids of the set, each naming its case and run.
  readonly ids: ReadonlyMap<string, CaseRef>;
};

// eve numbers the evals of an entry file that exports an array in order
// (`<prefix>0000`, `<prefix>0001`, ...): here, each case `trials` times.
export function evalIds(
  cases: readonly { readonly id: string; readonly category: string; readonly trials?: number }[],
  prefix: string,
  trials: (declared: number | undefined) => number,
) {
  const ids = new Map<string, CaseRef>();
  let index = 0;
  for (const entry of cases) {
    const count = trials(entry.trials);
    for (let trial = 1; trial <= count; trial++) {
      ids.set(`${prefix}${String(index++).padStart(4, "0")}`, { caseId: entry.id, category: entry.category, trial });
    }
  }
  return ids;
}

const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

// AI SDK usage as eve's step.completed events carry it: plain counts, or, from
// newer providers, objects with a total and cache reads.
function tokens(value: unknown): { total: number; cached: number } {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return { cached: number(record.cacheRead), total: number(record.total) };
  }
  return { cached: 0, total: number(value) };
}

// The assistant's tokens in one eval's events (one JSON object per line). Only
// step.completed events count: the grader and simulator call the model from
// the eval process, outside the session, and are not included.
export function usageOf(ndjson: string): Usage {
  const usage: Usage = { cachedInputTokens: 0, inputTokens: 0, outputTokens: 0 };
  for (const line of ndjson.split("\n")) {
    if (!line.trim()) continue;
    let event: { type?: string; data?: { usage?: Record<string, unknown> } };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== "step.completed" || !event.data?.usage) continue;
    const input = tokens(event.data.usage.inputTokens);
    usage.inputTokens += input.total;
    usage.cachedInputTokens += number(event.data.usage.cachedInputTokens) || input.cached;
    usage.outputTokens += tokens(event.data.usage.outputTokens).total;
  }
  return usage;
}

export function addUsage(into: Usage, more: Usage) {
  into.inputTokens += more.inputTokens;
  into.cachedInputTokens += more.cachedInputTokens;
  into.outputTokens += more.outputTokens;
}

const percent = (passed: number, total: number) => (total === 0 ? "n/a" : `${Math.round((passed / total) * 100)}%`);
const count = (value: number) => value.toLocaleString("en-US");

// The comment body. Runs are pass^1 when CI caps trials at one, so a failed run
// is a signal to rerun, not yet a regression (documentation 13).
export function summaryMarkdown(options: {
  readonly sets: readonly EvalSet[];
  readonly results: ReadonlyMap<string, EvalResult>;
  readonly usage: Usage;
  readonly commit: string;
  readonly runUrl: string | null;
}) {
  const lines: string[] = ["## Regression evals", ""];
  lines.push(`Commit \`${options.commit}\`${options.runUrl ? `, [workflow run](${options.runUrl})` : ""}. One run per case (pass^1); official runs keep pass^3.`, "");
  lines.push("| Set | Category | Runs passed |", "|---|---|---|");

  const failing: string[] = [];
  let missing = 0;
  for (const set of options.sets) {
    const byCategory = new Map<string, { passed: number; total: number }>();
    for (const [id, ref] of set.ids) {
      const result = options.results.get(id);
      if (!result) {
        missing++;
        continue;
      }
      const row = byCategory.get(ref.category) ?? { passed: 0, total: 0 };
      row.total++;
      if (result.verdict === "passed") row.passed++;
      else failing.push(`- ${set.name} ${ref.caseId} run ${ref.trial} (\`--tag case:${ref.caseId}\`): ${result.failed.join("; ") || result.verdict}`);
      byCategory.set(ref.category, row);
    }
    const all = [...byCategory.values()].reduce((sum, row) => ({ passed: sum.passed + row.passed, total: sum.total + row.total }), { passed: 0, total: 0 });
    for (const [category, row] of byCategory) lines.push(`| ${set.name} | ${category} | ${row.passed}/${row.total} (${percent(row.passed, row.total)}) |`);
    lines.push(`| **${set.name}** | **all** | **${all.passed}/${all.total} (${percent(all.passed, all.total)})** |`);
  }

  lines.push("", `Assistant tokens: ${count(options.usage.inputTokens)} input (${count(options.usage.cachedInputTokens)} cached), ${count(options.usage.outputTokens)} output. Grader tokens are not included.`);
  if (missing > 0) lines.push("", `${missing} expected runs have no result (the set did not finish).`);
  if (failing.length > 0) {
    lines.push("", "<details><summary>Failed runs</summary>", "", ...failing, "", "</details>");
    lines.push("", "A single run can fail without a change. Rerun a failed case two more times before calling it a regression.");
  }
  return `${lines.join("\n")}\n`;
}
