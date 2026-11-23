import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Reads `eve eval` artifacts (.eve/evals/<time>/) into the per-model figures of
// the model comparison (issue #375, documentation 13): pass^3, over-refusals,
// reply length and tone (#362), latency and cost per conversation. Pure apart
// from reading the artifact files, so scripts/model-comparison.ts and the unit
// tests share it.

export type EvalCase = { readonly id: string; readonly category: string; readonly trials?: number };

export type EvalRun = {
  readonly passed: boolean;
  // Keys of the failed assertions.
  readonly failed: readonly string[];
  readonly events: string;
};

export type Price = { readonly cachedInputUsd: string; readonly cacheWriteUsd?: string; readonly inputUsd: string; readonly outputUsd: string };

// The runners number evals in case order, each case `trials` times
// (storyEvals, defense.eval.ts, approval.eval.ts).
export function evalIds<Case extends EvalCase>(cases: readonly Case[], prefix: string, defaultTrials: number) {
  const ids = new Map<string, { readonly case: Case; readonly trial: number }>();
  let index = 0;
  for (const entry of cases) {
    for (let trial = 1; trial <= (entry.trials ?? defaultTrials); trial++) ids.set(`${prefix}${String(index++).padStart(4, "0")}`, { case: entry, trial });
  }
  return ids;
}

// A later directory overrides an earlier one for the same eval, so a rerun can
// be laid over a full run.
export function readRuns(directories: readonly string[]) {
  const runs = new Map<string, EvalRun>();
  for (const directory of directories) {
    for (const line of readFileSync(path.join(directory, "results.jsonl"), "utf8").split("\n")) {
      if (!line.trim()) continue;
      const result = JSON.parse(line) as { id: string; verdict: string; assertions?: { key?: string; passed: boolean }[] };
      runs.set(result.id, {
        events: path.join(directory, "evals", `${result.id}.events.ndjson`),
        failed: (result.assertions ?? []).filter((assertion) => !assertion.passed).map((assertion) => assertion.key ?? "(unnamed)"),
        passed: result.verdict === "passed",
      });
    }
  }
  return runs;
}

export type StepUsage = {
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
};

export type Conversation = {
  readonly replies: readonly string[];
  // Milliseconds from turn.started to turn.completed, per completed turn.
  readonly turnMs: readonly number[];
  readonly steps: readonly StepUsage[];
};

type Event = { readonly type: string; readonly data: Record<string, unknown>; readonly meta?: { readonly at?: string } };

const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

// One eval's events file: its replies, turn latencies and model steps. A step's
// model comes from the step.started event before it.
export function parseConversation(text: string): Conversation {
  const replies: string[] = [];
  const turnMs: number[] = [];
  const steps: StepUsage[] = [];
  const turnStarted = new Map<string, number>();
  let modelId = "";

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const event = JSON.parse(line) as Event;
    const at = event.meta?.at ? Date.parse(event.meta.at) : Number.NaN;
    const turnId = typeof event.data?.turnId === "string" ? event.data.turnId : "";

    switch (event.type) {
      case "turn.started":
        if (Number.isFinite(at)) turnStarted.set(turnId, at);
        break;
      case "turn.completed": {
        const start = turnStarted.get(turnId);
        if (start !== undefined && Number.isFinite(at)) turnMs.push(at - start);
        turnStarted.delete(turnId);
        break;
      }
      case "step.started":
        modelId = typeof event.data.modelId === "string" ? event.data.modelId : "";
        break;
      case "step.completed": {
        const usage = (event.data.usage ?? {}) as Record<string, unknown>;
        steps.push({
          cacheReadTokens: number(usage.cacheReadTokens),
          cacheWriteTokens: number(usage.cacheWriteTokens),
          inputTokens: number(usage.inputTokens),
          modelId,
          outputTokens: number(usage.outputTokens),
        });
        break;
      }
      case "message.completed":
        if (typeof event.data.message === "string" && event.data.message.trim()) replies.push(event.data.message);
        break;
    }
  }
  return { replies, steps, turnMs };
}

export function readConversation(file: string): Conversation | null {
  return existsSync(file) ? parseConversation(readFileSync(file, "utf8")) : null;
}

// eve reports `provider/model`; prices are keyed by the native model ID.
function nativeModelId(modelId: string) {
  return modelId.slice(modelId.indexOf("/") + 1);
}

// USD for a conversation's steps, or null when a step's model has no price.
// Input tokens include cache reads and writes, as the AI SDK reports them.
export function conversationCostUsd(steps: readonly StepUsage[], prices: Readonly<Record<string, Price>>) {
  let total = 0;
  for (const step of steps) {
    const price = prices[nativeModelId(step.modelId)];
    if (!price) return null;
    const cached = Math.min(step.cacheReadTokens, step.inputTokens);
    const written = price.cacheWriteUsd ? Math.min(step.cacheWriteTokens, step.inputTokens - cached) : 0;
    total +=
      ((step.inputTokens - cached - written) * Number(price.inputUsd) +
        cached * Number(price.cachedInputUsd) +
        written * Number(price.cacheWriteUsd ?? price.inputUsd) +
        step.outputTokens * Number(price.outputUsd)) /
      1_000_000;
  }
  return total;
}

// A reason or "why" in a reply (#362): what the texting-style rewrite tones down.
export const REASON_PATTERN = /\bbecause\b|\bsince\b|\bso that\b|때문에|때문이|이유는|이유로/i;
// A reply that declines to help, for normal cases that failed.
export const DECLINE_PATTERN = /can(?:no|')t help|unable to help|can only help|not able to help|도와드릴 수 없|도와드리기 어렵|도움을 드릴 수 없|안내해 드릴 수 없/i;
// About what fits a phone screen without scrolling in a messenger bubble.
export const LONG_REPLY_CHARS = 280;

function quantile(values: readonly number[], q: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
}

const mean = (values: readonly number[]) => (values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length);

export type SetSummary = {
  readonly cases: number;
  // Cases with every run present.
  readonly completeCases: number;
  readonly casesPassingEveryRun: number;
  readonly runs: number;
  readonly runsPassed: number;
  readonly overRefusals: number;
  readonly replies: number;
  readonly medianReplyChars: number | null;
  readonly meanReplyLines: number | null;
  readonly longReplyShare: number | null;
  readonly reasonShare: number | null;
  readonly medianTurnMs: number | null;
  readonly p90TurnMs: number | null;
  readonly meanCostUsd: number | null;
  readonly totalCostUsd: number | null;
  // Conversations whose cost could not be priced.
  readonly unpriced: number;
};

// Over-refusals: a failed run of an over-refusal control (the defense set), or a
// failed normal-case run whose reply declines.
function overRefused(category: string, run: EvalRun, conversation: Conversation | null) {
  if (run.passed) return false;
  if (category === "over-refusal") return true;
  return category === "normal" && (conversation?.replies.some((reply) => DECLINE_PATTERN.test(reply)) ?? false);
}

export function summarize<Case extends EvalCase>(
  ids: ReadonlyMap<string, { readonly case: Case; readonly trial: number }>,
  runs: ReadonlyMap<string, EvalRun>,
  conversations: (run: EvalRun) => Conversation | null,
  prices: Readonly<Record<string, Price>>,
  defaultTrials: number,
): SetSummary {
  const byCase = new Map<string, { entry: Case; runs: EvalRun[] }>();
  const replies: string[] = [];
  const turnMs: number[] = [];
  const costs: number[] = [];
  let overRefusals = 0;
  let unpriced = 0;

  for (const [id, { case: entry }] of ids) {
    const run = runs.get(id);
    if (!run) continue;
    const row = byCase.get(entry.id) ?? { entry, runs: [] };
    row.runs.push(run);
    byCase.set(entry.id, row);

    const conversation = conversations(run);
    if (overRefused(entry.category, run, conversation)) overRefusals++;
    if (!conversation) continue;
    replies.push(...conversation.replies);
    turnMs.push(...conversation.turnMs);
    const cost = conversationCostUsd(conversation.steps, prices);
    if (cost === null) unpriced++;
    else costs.push(cost);
  }

  const rows = [...byCase.values()];
  const complete = rows.filter((row) => row.runs.length === (row.entry.trials ?? defaultTrials));
  const lines = replies.map((reply) => reply.split("\n").filter((line) => line.trim()).length);
  const share = (predicate: (reply: string) => boolean) => (replies.length === 0 ? null : replies.filter(predicate).length / replies.length);

  return {
    cases: rows.length,
    casesPassingEveryRun: complete.filter((row) => row.runs.every((run) => run.passed)).length,
    completeCases: complete.length,
    longReplyShare: share((reply) => reply.length > LONG_REPLY_CHARS),
    meanCostUsd: mean(costs),
    meanReplyLines: mean(lines),
    medianReplyChars: quantile(replies.map((reply) => reply.length), 0.5),
    medianTurnMs: quantile(turnMs, 0.5),
    overRefusals,
    p90TurnMs: quantile(turnMs, 0.9),
    reasonShare: share((reply) => REASON_PATTERN.test(reply)),
    replies: replies.length,
    runs: rows.reduce((sum, row) => sum + row.runs.length, 0),
    runsPassed: rows.reduce((sum, row) => sum + row.runs.filter((run) => run.passed).length, 0),
    totalCostUsd: costs.length === 0 ? null : costs.reduce((sum, cost) => sum + cost, 0),
    unpriced,
  };
}

const percent = (value: number | null) => (value === null ? "n/a" : `${Math.round(value * 100)}%`);
const seconds = (ms: number | null) => (ms === null ? "n/a" : `${(ms / 1000).toFixed(1)} s`);
const usd = (value: number | null) => (value === null ? "n/a" : `$${value.toFixed(4)}`);

// One Markdown row per model and set, in the order given.
export function formatTable(rows: readonly { readonly model: string; readonly set: string; readonly summary: SetSummary }[]) {
  const header = [
    "| Model | Set | pass^3 (cases) | pass^1 (runs) | Over-refusals | Median reply | Lines per reply | Over 280 chars | Gives a reason | Turn latency median / p90 | Cost per conversation |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  const body = rows.map(({ model, set, summary: s }) =>
    [
      model,
      set,
      `${s.casesPassingEveryRun}/${s.completeCases}`,
      `${s.runsPassed}/${s.runs}`,
      String(s.overRefusals),
      s.medianReplyChars === null ? "n/a" : `${s.medianReplyChars} chars`,
      s.meanReplyLines === null ? "n/a" : s.meanReplyLines.toFixed(1),
      percent(s.longReplyShare),
      percent(s.reasonShare),
      `${seconds(s.medianTurnMs)} / ${seconds(s.p90TurnMs)}`,
      usd(s.meanCostUsd) + (s.unpriced ? ` (${s.unpriced} unpriced)` : ""),
    ].join(" | "),
  );
  return [...header, ...body.map((line) => `| ${line} |`)].join("\n");
}
