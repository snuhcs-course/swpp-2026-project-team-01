import { describe, expect, it } from "vitest";
import { evalIds, summaryMarkdown, usageOf } from "./summary";

const cases = [
  { category: "attack", id: "G-E01" },
  { category: "attack", id: "G-M06", trials: 1 },
  { category: "over-refusal", id: "G-E17" },
];

describe("evalIds", () => {
  it("numbers each case's runs in order, as eve numbers an exported array", () => {
    const ids = evalIds(cases, "requester/defense/", (declared) => declared ?? 3);

    expect([...ids.keys()]).toEqual(["0000", "0001", "0002", "0003", "0004", "0005", "0006"].map((n) => `requester/defense/${n}`));
    expect(ids.get("requester/defense/0003")).toEqual({ caseId: "G-M06", category: "attack", trial: 1 });
    expect(ids.get("requester/defense/0006")).toEqual({ caseId: "G-E17", category: "over-refusal", trial: 3 });
  });

  it("maps one run per case when the runs are capped", () => {
    const ids = evalIds(cases, "requester/defense/", () => 1);

    expect([...ids.values()].map((ref) => ref.caseId)).toEqual(["G-E01", "G-M06", "G-E17"]);
  });
});

describe("usageOf", () => {
  it("sums the assistant's step usage in plain and structured forms and skips other events", () => {
    const events = [
      { data: { usage: { cachedInputTokens: 50, inputTokens: 100, outputTokens: 10 } }, type: "step.completed" },
      { data: { usage: { inputTokens: { cacheRead: 30, total: 200 }, outputTokens: { total: 20 } } }, type: "step.completed" },
      { data: { usage: { inputTokens: 999, outputTokens: 999 } }, type: "model.call.completed" },
      { data: { message: "hi" }, type: "message.completed" },
    ];
    const ndjson = `${events.map((event) => JSON.stringify(event)).join("\n")}\nnot json\n`;

    expect(usageOf(ndjson)).toEqual({ cachedInputTokens: 80, inputTokens: 300, outputTokens: 30 });
  });
});

describe("summaryMarkdown", () => {
  it("reports runs passed per category, the failed runs with their rerun tag, and missing runs", () => {
    const ids = evalIds(cases, "requester/defense/", () => 1);
    const results = new Map([
      ["requester/defense/0000", { failed: [], id: "requester/defense/0000", verdict: "passed" }],
      ["requester/defense/0001", { failed: ["turn 1: claims no decision"], id: "requester/defense/0001", verdict: "failed" }],
    ]);
    const body = summaryMarkdown({
      commit: "abc12345",
      results,
      runUrl: "https://example.test/run",
      sets: [{ ids, name: "guest defense" }],
      usage: { cachedInputTokens: 1000, inputTokens: 12345, outputTokens: 678 },
    });

    expect(body).toContain("| guest defense | attack | 1/2 (50%) |");
    expect(body).toContain("| **guest defense** | **all** | **1/2 (50%)** |");
    expect(body).not.toContain("over-refusal |");
    expect(body).toContain("G-M06 run 1 (`--tag case:G-M06`): turn 1: claims no decision");
    expect(body).toContain("1 expected runs have no result");
    expect(body).toContain("12,345 input (1,000 cached), 678 output");
  });
});
