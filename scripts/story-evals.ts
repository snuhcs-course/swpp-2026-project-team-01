// Reads and compares story path eval runs (documentation 13) from the
// artifacts `eve eval` writes under .eve/evals/<time>/.
//
//   npx tsx scripts/story-evals.ts report [--transcripts] <artifact dir>...
//     Per case: runs passed and failing checks; with --transcripts, each failed
//     run's messages, tool calls and replies. A later directory overrides an
//     earlier one for the same eval, so a rerun can be laid over a full run.
//
//   npx tsx scripts/story-evals.ts compare <git ref>...
//     Runs every story case once under each ref's agent/instructions/, the rest
//     of the code as checked out, then lists the cases whose result differs.
//     agent/instructions/ is restored from HEAD afterwards. Needs the local
//     stack and the model environment of documentation 13's run settings.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOST_REVIEW_STORY_CASES } from "../evals/host-review/story-cases";
import { GUEST_STORY_CASES } from "../evals/requester/story-cases";
import { DEFAULT_TRIALS } from "../evals/story/runner";
import { type EvalRun, evalIds as evalIdsOf, readRuns } from "../evals/comparison/metrics";
import type { StoryCase } from "../evals/story/types";

const root = fileURLToPath(new URL("../", import.meta.url));
const SETS = [
  { audience: "requester", cases: GUEST_STORY_CASES, name: "guest", prefix: "requester/story/" },
  { audience: "host_review", cases: HOST_REVIEW_STORY_CASES, name: "host review", prefix: "host-review/story/" },
] as const;
const PROMPTS = "agent/instructions";

type Run = EvalRun;

function evalIds(cases: readonly StoryCase[], prefix: string) {
  return evalIdsOf(cases, prefix, DEFAULT_TRIALS);
}

function transcript(file: string) {
  if (!existsSync(file)) return ["    (no events file)"];
  const lines: string[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const event = JSON.parse(line) as { type: string; data: Record<string, unknown> };
    if (event.type === "message.received") lines.push(`    user: ${String(event.data.message)}`);
    if (event.type === "actions.requested") {
      for (const action of event.data.actions as { toolName: string; input: unknown }[]) lines.push(`    tool: ${action.toolName} ${JSON.stringify(action.input)}`);
    }
    if (event.type === "message.completed") lines.push(`    reply: ${String(event.data.message).replace(/\n+/g, " / ")}`);
  }
  return lines;
}

function report(directories: readonly string[], transcripts: boolean) {
  const runs = readRuns(directories);
  for (const set of SETS) {
    const byCase = new Map<string, { entry: StoryCase; runs: (Run & { trial: number })[] }>();
    for (const [id, { case: entry, trial }] of evalIds(set.cases, set.prefix)) {
      const run = runs.get(id);
      if (!run) continue;
      const row = byCase.get(entry.id) ?? { entry, runs: [] };
      row.runs.push({ ...run, trial });
      byCase.set(entry.id, row);
    }
    if (byCase.size === 0) continue;
    const rows = [...byCase.values()];
    const total = rows.reduce((sum, row) => sum + row.runs.length, 0);
    const passed = rows.reduce((sum, row) => sum + row.runs.filter((run) => run.passed).length, 0);
    const complete = rows.filter((row) => row.runs.length === (row.entry.trials ?? DEFAULT_TRIALS));
    console.log(`\n${set.name}: runs ${passed}/${total}; cases passing every run ${complete.filter((row) => row.runs.every((run) => run.passed)).length}/${complete.length} (of ${rows.length} with results)`);
    for (const row of rows.filter((row) => row.runs.some((run) => !run.passed))) {
      console.log(`  ${row.entry.id} (${row.entry.category}, ${row.entry.shape}): ${row.runs.filter((run) => run.passed).length}/${row.runs.length}`);
      for (const run of row.runs.filter((run) => !run.passed)) {
        console.log(`   run ${run.trial}: ${run.failed.join(" | ")}`);
        if (transcripts) console.log(transcript(run.events).join("\n"));
      }
    }
  }
}

function newestArtifact(after: number) {
  const base = path.join(root, ".eve/evals");
  const found = readdirSync(base)
    .map((name) => path.join(base, name))
    .filter((directory) => existsSync(path.join(directory, "results.jsonl")))
    .map((directory) => ({ directory, started: Date.parse(JSON.parse(readFileSync(path.join(directory, "summary.json"), "utf8")).startedAt) }))
    .filter((entry) => entry.started >= after)
    .sort((a, b) => b.started - a.started);
  if (!found[0]) throw new Error("eve eval left no artifact directory");
  return found[0].directory;
}

function git(...args: string[]) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function compare(refs: readonly string[]) {
  if (git("status", "--porcelain", "--", PROMPTS).trim()) throw new Error(`${PROMPTS} has local changes; commit or restore them first`);
  const artifacts = new Map<string, string[]>();
  try {
    for (const ref of refs) {
      git("restore", `--source=${ref}`, "--worktree", "--", PROMPTS);
      if (git("diff", "--name-only", ref, "--", PROMPTS).trim()) throw new Error(`${PROMPTS} does not match ${ref}`);
      for (const set of SETS) {
        const ids = [...evalIds(set.cases, set.prefix)].filter(([, run]) => run.trial === 1).map(([id]) => id);
        const started = Date.now();
        console.log(`${ref}: ${set.name}, ${ids.length} cases once`);
        // eve starts one dev server per checkout, so the sets run one after the other.
        spawnSync("npx", ["eve", "eval", ...ids, "--max-concurrency", "8"], { cwd: root, env: { ...process.env, FMAT_EVAL_AUDIENCE: set.audience }, stdio: "inherit" });
        artifacts.set(ref, [...(artifacts.get(ref) ?? []), newestArtifact(started)]);
      }
    }
  } finally {
    git("restore", "--source=HEAD", "--worktree", "--", PROMPTS);
  }

  const results = new Map([...artifacts].map(([ref, directories]) => [ref, readRuns(directories)]));
  for (const set of SETS) {
    const ids = [...evalIds(set.cases, set.prefix)].filter(([, run]) => run.trial === 1);
    console.log(`\n${set.name}: ${refs.map((ref) => `${ref} ${ids.filter(([id]) => results.get(ref)?.get(id)?.passed).length}/${ids.length}`).join(", ")}`);
    for (const [id, { case: entry }] of ids) {
      const outcomes = refs.map((ref) => results.get(ref)?.get(id));
      if (new Set(outcomes.map((run) => run?.passed)).size > 1) {
        console.log(`  ${entry.id}: ${refs.map((ref, index) => `${ref} ${outcomes[index]?.passed ? "pass" : "fail"}`).join(", ")}`);
      }
    }
  }
  console.log(`\nArtifacts: ${[...artifacts].map(([ref, directories]) => `${ref}: ${directories.join(", ")}`).join("; ")}`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "report" && rest.some((arg) => arg !== "--transcripts")) report(rest.filter((arg) => arg !== "--transcripts"), rest.includes("--transcripts"));
else if (command === "compare" && rest.length > 0) compare(rest);
else {
  console.error("usage: story-evals.ts report [--transcripts] <artifact dir>... | compare <git ref>...");
  process.exitCode = 1;
}
