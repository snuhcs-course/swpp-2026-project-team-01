// Runs the existing evals once per model and reports them side by side (issue
// #375, documentation 13, "Model comparison"). The model under test is chosen by
// FMAT_ASSISTANT_MODEL only; the graders stay fixed (evals/story/grader.ts,
// defense-runner.ts, approval-runner.ts), so every model is graded alike.
//
//   npx tsx scripts/model-comparison.ts run --models <provider/model>,... [--sets story|all|<set>,...] [--max-concurrency 8]
//     For each model, runs each set with `eve eval` (one dev server per
//     checkout, so one set at a time), records the artifact directories in
//     .eve/model-comparison/<time>.json after every set, then prints the table.
//     Needs the local stack (`supabase start`), OPENAI_API_KEY for the graders
//     and the key of every provider named (ANTHROPIC_API_KEY for anthropic/...).
//     Each set runs every case three times; it spends money.
//
//   npx tsx scripts/model-comparison.ts report <manifest.json>
//     Prints the table again from a manifest.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evalIds, type EvalCase, formatTable, readConversation, readRuns, summarize } from "../evals/comparison/metrics";
import { APPROVAL_CASES } from "../evals/host-review/approval-cases";
import { DEFAULT_TRIALS as APPROVAL_TRIALS } from "../evals/host-review/approval-runner";
import { HOST_REVIEW_STORY_CASES } from "../evals/host-review/story-cases";
import { DEFENSE_CASES } from "../evals/requester/defense-cases";
import { DEFAULT_TRIALS as DEFENSE_TRIALS } from "../evals/requester/defense-runner";
import { GUEST_STORY_CASES } from "../evals/requester/story-cases";
import { DEFAULT_TRIALS as STORY_TRIALS } from "../evals/story/runner";
import { ASSISTANT_MODEL_VARIABLE, parseModelChoice } from "../lib/server/model-choice";
import { MODEL_PRICES } from "../lib/server/model-limits";

const root = fileURLToPath(new URL("../", import.meta.url));

type EvalSet = {
  readonly name: string;
  readonly audience: "requester" | "host_review";
  readonly selector: string;
  readonly cases: readonly EvalCase[];
  readonly trials: number;
};

const SETS: readonly EvalSet[] = [
  { audience: "requester", cases: GUEST_STORY_CASES, name: "guest-story", selector: "requester/story", trials: STORY_TRIALS },
  { audience: "host_review", cases: HOST_REVIEW_STORY_CASES, name: "host-review-story", selector: "host-review/story", trials: STORY_TRIALS },
  { audience: "requester", cases: DEFENSE_CASES, name: "guest-defense", selector: "requester/defense", trials: DEFENSE_TRIALS },
  { audience: "host_review", cases: APPROVAL_CASES, name: "host-approval", selector: "host-review/approval", trials: APPROVAL_TRIALS },
];

const API_KEYS = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" } as const;

type Manifest = {
  readonly startedAt: string;
  readonly commit: string;
  readonly runs: { model: string; set: string; artifact: string }[];
};

function selectSets(value: string) {
  if (value === "all") return SETS;
  if (value === "story") return SETS.filter((set) => set.name.endsWith("-story"));
  const names = value.split(",");
  const unknown = names.filter((name) => !SETS.some((set) => set.name === name));
  if (unknown.length) throw new Error(`Unknown set ${unknown.join(", ")}; sets are ${SETS.map((set) => set.name).join(", ")}, story or all.`);
  return SETS.filter((set) => names.includes(set.name));
}

// Whether a key is set, without reading its value out: the process environment
// first, then the env files eve dev loads.
function hasKey(name: string) {
  if (process.env[name]?.trim()) return true;
  return [".env.local", ".env"].some((file) => {
    const full = path.join(root, file);
    return existsSync(full) && readFileSync(full, "utf8").split("\n").some((line) => new RegExp(`^${name}=\\S`).test(line));
  });
}

function newestArtifact(after: number) {
  const base = path.join(root, ".eve/evals");
  const found = readdirSync(base)
    .map((name) => path.join(base, name))
    .filter((directory) => existsSync(path.join(directory, "summary.json")) && existsSync(path.join(directory, "results.jsonl")))
    .map((directory) => ({ directory, started: Date.parse(JSON.parse(readFileSync(path.join(directory, "summary.json"), "utf8")).startedAt) }))
    .filter((entry) => entry.started >= after)
    .sort((a, b) => b.started - a.started);
  if (!found[0]) throw new Error("eve eval left no artifact directory");
  return found[0].directory;
}

function report(manifest: Manifest) {
  const rows = manifest.runs.map((run) => {
    const set = SETS.find((entry) => entry.name === run.set);
    if (!set) throw new Error(`Manifest names unknown set ${run.set}`);
    const ids = evalIds(set.cases, `${set.selector}/`, set.trials);
    const summary = summarize(ids, readRuns([run.artifact]), (evalRun) => readConversation(evalRun.events), MODEL_PRICES, set.trials);
    return { model: run.model, set: run.set, summary };
  });
  console.log(`\nModel comparison at ${manifest.commit}, started ${manifest.startedAt}\n`);
  console.log(formatTable(rows));
}

function flag(args: readonly string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function run(args: readonly string[]) {
  const models = (flag(args, "--models") ?? "").split(",").map((model) => model.trim()).filter(Boolean);
  if (models.length === 0) throw new Error("--models is required, such as --models openai/gpt-5.6-terra,anthropic/claude-sonnet-5-5");
  const sets = selectSets(flag(args, "--sets") ?? "story");
  const concurrency = flag(args, "--max-concurrency") ?? "8";

  const providers = new Set(models.map((model) => parseModelChoice(model).provider));
  const missing = ["OPENAI_API_KEY", ...[...providers].map((provider) => API_KEYS[provider])].filter((name, index, all) => all.indexOf(name) === index && !hasKey(name));
  if (missing.length) throw new Error(`Missing ${missing.join(", ")}; set them in the environment or .env.local (the graders need OPENAI_API_KEY).`);

  const startedAt = new Date().toISOString();
  const manifest: Manifest = { commit: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), runs: [], startedAt };
  const directory = path.join(root, ".eve/model-comparison");
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${startedAt.replace(/[:.]/g, "-")}.json`);

  for (const model of models) {
    for (const set of sets) {
      console.log(`\n${model}: ${set.name}`);
      const started = Date.now();
      const result = spawnSync("npx", ["eve", "eval", set.selector, "--max-concurrency", concurrency], {
        cwd: root,
        env: { ...process.env, [ASSISTANT_MODEL_VARIABLE]: model, FMAT_EVAL_AUDIENCE: set.audience },
        stdio: "inherit",
      });
      if (result.error) throw result.error;
      manifest.runs.push({ artifact: newestArtifact(started), model, set: set.name });
      writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  }

  report(manifest);
  console.log(`\nManifest: ${path.relative(root, file)}`);
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "run") run(rest);
  else if (command === "report" && rest[0]) report(JSON.parse(readFileSync(rest[0], "utf8")) as Manifest);
  else {
    console.error("usage: model-comparison.ts run --models <provider/model>,... [--sets story|all|<set>,...] [--max-concurrency 8] | report <manifest.json>");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
