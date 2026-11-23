import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { conversationCostUsd, evalIds, formatTable, parseConversation, readConversation, readRuns, summarize } from "./metrics";

const PRICES = {
  "claude-sonnet-5-5": { cachedInputUsd: "0.10", cacheWriteUsd: "2.50", inputUsd: "2.00", outputUsd: "10.00" },
  "gpt-5.6-terra": { cachedInputUsd: "0.20", inputUsd: "2.00", outputUsd: "12.00" },
};

const at = (ms: number) => ({ at: new Date(Date.UTC(2026, 10, 23) + ms).toISOString() });

function events(model: string, replies: readonly string[], turnMs = 2000) {
  return replies
    .flatMap((reply, index) => [
      { data: { turnId: `turn_${index}` }, meta: at(index * 10_000), type: "turn.started" },
      { data: { modelId: model, turnId: `turn_${index}` }, meta: at(index * 10_000 + 1), type: "step.started" },
      { data: { turnId: `turn_${index}`, usage: { cacheReadTokens: 400, cacheWriteTokens: 100, inputTokens: 1000, outputTokens: 50 } }, meta: at(index * 10_000 + 2), type: "step.completed" },
      { data: { message: reply, turnId: `turn_${index}` }, meta: at(index * 10_000 + 3), type: "message.completed" },
      { data: { turnId: `turn_${index}` }, meta: at(index * 10_000 + turnMs), type: "turn.completed" },
    ])
    .map((event) => JSON.stringify(event))
    .join("\n");
}

const directory = mkdtempSync(path.join(tmpdir(), "model-comparison-"));
afterAll(() => rmSync(directory, { force: true, recursive: true }));

describe("model comparison metrics", () => {
  it("numbers evals in case order, each case its trials", () => {
    const ids = evalIds([{ category: "normal", id: "A" }, { category: "normal", id: "B", trials: 1 }], "requester/story/", 3);
    expect([...ids].map(([id, run]) => `${id} ${run.case.id}#${run.trial}`)).toEqual([
      "requester/story/0000 A#1",
      "requester/story/0001 A#2",
      "requester/story/0002 A#3",
      "requester/story/0003 B#1",
    ]);
  });

  it("reads replies, turn latencies and step usage from an events file", () => {
    const conversation = parseConversation(events("anthropic/claude-sonnet-5-5", ["안녕하세요", "Done."], 1500));
    expect(conversation.replies).toEqual(["안녕하세요", "Done."]);
    expect(conversation.turnMs).toEqual([1500, 1500]);
    expect(conversation.steps).toEqual([
      { cacheReadTokens: 400, cacheWriteTokens: 100, inputTokens: 1000, modelId: "anthropic/claude-sonnet-5-5", outputTokens: 50 },
      { cacheReadTokens: 400, cacheWriteTokens: 100, inputTokens: 1000, modelId: "anthropic/claude-sonnet-5-5", outputTokens: 50 },
    ]);
  });

  it("prices cache reads and writes, and gives null for an unpriced model", () => {
    const step = { cacheReadTokens: 400, cacheWriteTokens: 100, inputTokens: 1000, outputTokens: 50 };
    // 500 uncached at $2, 100 written at $2.50, 400 read at $0.10, 50 out at $10.
    expect(conversationCostUsd([{ ...step, modelId: "anthropic/claude-sonnet-5-5" }], PRICES)).toBeCloseTo(0.00179, 8);
    // No write price: written tokens count as input. 600 at $2, 400 at $0.20, 50 at $12.
    expect(conversationCostUsd([{ ...step, modelId: "openai/gpt-5.6-terra" }], PRICES)).toBeCloseTo(0.00188, 8);
    expect(conversationCostUsd([{ ...step, modelId: "openai/gpt-5.6-luna" }], PRICES)).toBeNull();
  });

  it("summarizes pass^3, over-refusals, reply shape, latency and cost per set", () => {
    const cases = [
      { category: "normal", id: "N1" },
      { category: "over-refusal", id: "O1" },
      { category: "attack", id: "X1", trials: 1 },
    ];
    const ids = evalIds(cases, "requester/story/", 3);
    const verdicts = ["passed", "passed", "passed", "passed", "failed", "passed", "failed"];
    const replies = [
      ["Booked for Tuesday."],
      ["Done."],
      ["Done."],
      ["Sure."],
      ["죄송하지만 도와드릴 수 없어요."],
      ["Sure."],
      [`${"long ".repeat(70)}because the host asked.\nSecond line.`],
    ];
    const artifact = path.join(directory, "run");
    mkdirSync(path.join(artifact, "evals/requester/story"), { recursive: true });
    writeFileSync(
      path.join(artifact, "results.jsonl"),
      [...ids.keys()].map((id, index) => JSON.stringify({ assertions: [{ key: "turn 1: replies", passed: verdicts[index] === "passed" }], id, verdict: verdicts[index] })).join("\n"),
    );
    [...ids.keys()].forEach((id, index) => writeFileSync(path.join(artifact, "evals", `${id}.events.ndjson`), events("openai/gpt-5.6-terra", replies[index]!)));

    const runs = readRuns([artifact]);
    expect(runs.get("requester/story/0004")).toMatchObject({ failed: ["turn 1: replies"], passed: false });
    const summary = summarize(ids, runs, (run) => readConversation(run.events), PRICES, 3);

    expect(summary).toMatchObject({
      cases: 3,
      casesPassingEveryRun: 1,
      completeCases: 3,
      longReplyShare: 1 / 7,
      medianTurnMs: 2000,
      overRefusals: 1,
      reasonShare: 1 / 7,
      replies: 7,
      runs: 7,
      runsPassed: 5,
      unpriced: 0,
    });
    expect(summary.meanCostUsd).toBeCloseTo(0.00188, 8);

    const table = formatTable([{ model: "openai/gpt-5.6-terra", set: "guest-story", summary }]);
    expect(table.split("\n")).toHaveLength(3);
    expect(table).toContain("| openai/gpt-5.6-terra | guest-story | 1/3 | 5/7 | 1 |");
  });
});
