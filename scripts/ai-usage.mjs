#!/usr/bin/env node
// Records Claude Code and Codex token usage per Git branch.
//
//   node scripts/ai-usage.mjs record [--stage]   update ai-usage/<branch>/<user>.json from local agent logs
//   node scripts/ai-usage.mjs report [branch]    print a Markdown usage table for a branch
//
// Only token counts and agent working time are stored, never prompts or responses.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// USD per 1M tokens, API list prices checked 2026-10-07:
// https://platform.claude.com/docs/en/about-claude/pricing
// https://developers.openai.com/api/docs/pricing
// Claude cache writes are 1.25x input (5m TTL) and 2x input (1h TTL).
const PRICES = {
  "claude-fable-5-1": { input: 10, cache_read: 0.25, output: 50 },
  "claude-fable-5": { input: 10, cache_read: 1, output: 50 },
  "claude-opus-5-5": { input: 4, cache_read: 0.2, output: 20 },
  "claude-opus-5": { input: 5, cache_read: 0.5, output: 25 },
  "claude-opus-4-8": { input: 5, cache_read: 0.5, output: 25 },
  "claude-opus-4-7": { input: 5, cache_read: 0.5, output: 25 },
  "claude-opus-4-6": { input: 5, cache_read: 0.5, output: 25 },
  "claude-sonnet-5-5": { input: 2, cache_read: 0.2, output: 10 },
  "claude-sonnet-5": { input: 2, cache_read: 0.2, output: 10 },
  "claude-sonnet-4-6": { input: 3, cache_read: 0.3, output: 15 },
  "claude-haiku-4-5": { input: 1, cache_read: 0.1, output: 5 },
  "gpt-6-astra": { input: 10, cache_read: 1, cache_write: 12.5, output: 50 },
  "gpt-6.1-sol": { input: 2, cache_read: 0.1, cache_write: 2.5, output: 10 },
  "gpt-6-sol": { input: 2, cache_read: 0.2, cache_write: 2.5, output: 10 },
  "gpt-6-luna": { input: 0.1, cache_read: 0.01, cache_write: 0.125, output: 0.5 },
  "gpt-5.6-sol": { input: 4, cache_read: 0.4, cache_write: 5, output: 20 },
  "gpt-5.6-terra": { input: 2, cache_read: 0.2, cache_write: 2.5, output: 12 },
  "gpt-5.6-luna": { input: 0.2, cache_read: 0.02, cache_write: 0.25, output: 1.2 },
  "gpt-5.5": { input: 5, cache_read: 0.5, output: 30 },
  "gpt-5.3-codex": { input: 1.75, cache_read: 0.175, output: 14 },
};

// All buckets are disjoint, so they can be summed. `reasoning` is a subset of `output`.
const FIELDS = ["input", "cache_read", "cache_write_5m", "cache_write_1h", "output", "reasoning"];
const USAGE_DIR = "ai-usage";

// Git hooks export GIT_DIR and friends for the worktree that is committing; they would override `cwd`
// when inspecting other worktrees. Only staging keeps them, so that `git commit <paths>` sees the change.
const inspectEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX|COMMON_DIR)$/.test(k)));
const git = (args, cwd, env = inspectEnv) =>
  execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const tryGit = (args, cwd) => {
  try {
    return git(args, cwd);
  } catch {
    return "";
  }
};
// macOS may store Korean paths decomposed (NFD) while logs hold them composed (NFC); compare in NFC.
const realpath = (p) => {
  try {
    return fs.realpathSync(p).normalize("NFC");
  } catch {
    return path.resolve(p).normalize("NFC");
  }
};
const emptyUsage = () => Object.fromEntries(FIELDS.map((f) => [f, 0]));
const userSlug = (email) => email.replace(/[^A-Za-z0-9._-]/g, "_");
const normalizeRemote = (url) => url.replace(/\.git$/, "").replace(/^git@([^:]+):/, "https://$1/").toLowerCase();

function* jsonlFiles(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* jsonlFiles(p);
    else if (entry.name.endsWith(".jsonl")) yield p;
  }
}

function* jsonLines(text) {
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // A line may be partially written while the agent is running.
    }
  }
}

const LEDGER = "ai-usage-branches.log";

// Reads a worktree's HEAD reflog into [{ ts, branch }] switch points.
function reflogPoints(worktree) {
  const logFile = path.resolve(worktree, git(["rev-parse", "--git-path", "logs/HEAD"], worktree));
  const points = [];
  if (!fs.existsSync(logFile)) return points;
  for (const line of fs.readFileSync(logFile, "utf8").split("\n")) {
    const m = line.match(/> (\d+) [+-]\d{4}\t(.*)$/);
    if (!m) continue;
    const ts = Number(m[1]) * 1000;
    const checkout = m[2].match(/^checkout: moving from (.+) to (.+)$/);
    const rebased = m[2].match(/^rebase.*\(finish\): returning to refs\/heads\/(.+)$/);
    if (checkout) {
      if (points.length === 0) points.push({ ts: 0, branch: checkout[1] });
      points.push({ ts, branch: checkout[2] });
    } else if (rebased) points.push({ ts, branch: rebased[1] });
  }
  return points;
}

function branchAt(points, ts) {
  let branch;
  for (const p of points) {
    if (p.ts > ts) break;
    branch = p.branch;
  }
  return branch;
}

// Branch switch points per worktree path, from the post-checkout ledger in the common .git directory
// (which outlives deleted worktrees) and from the HEAD reflog of worktrees that still exist.
function repoContext(cwd) {
  const timelines = new Map();
  const at = (w) => (timelines.has(w) || timelines.set(w, []), timelines.get(w));
  const ledger = path.resolve(cwd, git(["rev-parse", "--git-common-dir"], cwd), LEDGER);
  if (fs.existsSync(ledger)) {
    for (const line of fs.readFileSync(ledger, "utf8").split("\n")) {
      const [ts, worktree, branch] = line.split("\t");
      if (branch) at(worktree.normalize("NFC")).push({ ts: Number(ts) * 1000, branch });
    }
  }
  // -z keeps non-ASCII paths unquoted.
  for (const line of git(["worktree", "list", "--porcelain", "-z"], cwd).split("\0")) {
    // Worktrees deleted without `git worktree remove` stay listed until pruned; the ledger covers them.
    if (!line.startsWith("worktree ") || !fs.existsSync(line.slice(9))) continue;
    const w = realpath(line.slice(9));
    const points = at(w);
    points.push(...reflogPoints(w));
    if (points.length === 0) points.push({ ts: 0, branch: tryGit(["branch", "--show-current"], w) || "HEAD" });
  }
  for (const points of timelines.values()) points.sort((a, b) => a.ts - b.ts);
  const worktrees = [...timelines.keys()].sort((a, b) => b.length - a.length);
  const remote = tryGit(["remote", "get-url", "origin"], cwd);
  return {
    worktrees,
    needles: [...worktrees.flatMap((w) => [w, w.normalize("NFD")]), remote && normalizeRemote(remote)].filter(Boolean),
    remote: remote && normalizeRemote(remote),
    // Returns the branch checked out at `ts` in the worktree containing `dir`, if any.
    branchOf(dir, ts) {
      if (!dir) return undefined;
      const p = realpath(dir);
      const w = worktrees.find((w) => p === w || p.startsWith(w + path.sep));
      return w && branchAt(timelines.get(w), ts);
    },
  };
}

// Claude Code CLI and desktop app both write ~/.claude/projects/<encoded cwd>/<session>.jsonl.
function collectClaude(repo, since, emit, touch) {
  // Several accounts can each have their own config dir (CLAUDE_CONFIG_DIR=~/.claude2 and so on).
  const home = os.homedir();
  const dotClaude = fs.readdirSync(home).filter((d) => d.startsWith(".claude")).map((d) => path.join(home, d));
  const roots = [...new Set([process.env.CLAUDE_CONFIG_DIR, ...dotClaude].filter(Boolean).map(realpath))];
  const seen = new Set();
  for (const root of roots) {
    const projects = path.join(root, "projects");
    // A session started elsewhere can cd into the repo, so files are matched by content, not by project dir.
    // Sorted so a message duplicated into a subagent file is always counted under the parent session.
    const files = [...jsonlFiles(projects)].filter((f) => fs.statSync(f).mtimeMs >= since).sort();
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      if (!repo.needles.some((n) => text.includes(n))) continue;
      const rel = path.relative(projects, f).split(path.sep).slice(1);
      const id = "claude:" + rel.join("/").replace(/\/subagents\//, "/").replace(/\.jsonl$/, "");
      touch(id);
      for (const d of jsonLines(text)) {
        const msg = d.message;
        const isUsage = d.type === "assistant" && msg?.usage && msg.model && msg.model !== "<synthetic>";
        // turn_duration closes each user request; subagents run inside it, so their files have none.
        const isTurn = d.type === "system" && d.subtype === "turn_duration";
        if (!isUsage && !isTurn) continue;
        const key = isUsage ? `${msg.id}:${d.requestId}` : d.uuid;
        if (seen.has(key)) continue;
        seen.add(key);
        // gitBranch in the log can be stale or "HEAD" after a mid-session cd, so the timeline decides.
        const ts = Date.parse(d.timestamp);
        const b = repo.branchOf(d.cwd, ts);
        if (b === undefined) continue;
        const e = { agent: "claude-code", client: d.entrypoint, ts, b };
        if (isTurn) {
          emit(id, { ...e, ms: d.durationMs });
          continue;
        }
        const u = msg.usage;
        const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
        emit(id, {
          ...e,
          model: msg.model,
          usage: {
            input: u.input_tokens ?? 0,
            cache_read: u.cache_read_input_tokens ?? 0,
            cache_write_5m: (u.cache_creation_input_tokens ?? 0) - write1h,
            cache_write_1h: write1h,
            output: u.output_tokens ?? 0,
          },
        });
      }
    }
  }
}

// Codex CLI and desktop app both write ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl.
// Codex records the branch only at session start; like Claude, the branch is resolved per event from the HEAD reflog.
function collectCodex(repo, since, emit, touch) {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const files = ["sessions", "archived_sessions"]
    .flatMap((d) => [...jsonlFiles(path.join(home, d))])
    .filter((f) => fs.statSync(f).mtimeMs >= since);
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    if (!repo.needles.some((n) => text.includes(n))) continue;
    let id, client, isSubagent, metaGit, cwd, model, prevTotal;
    const started = new Map();
    const branchOf = (ts) => {
      const b = repo.branchOf(cwd, ts);
      if (b !== undefined) return b;
      if (metaGit?.repository_url && normalizeRemote(metaGit.repository_url) === repo.remote) return metaGit.branch;
    };
    for (const d of jsonLines(text)) {
      const p = d.payload ?? {};
      const ts = Date.parse(d.timestamp);
      if (d.type === "session_meta" && !id) {
        // Forked sessions repeat the parent's session_meta after their own; the first one is this session.
        id = "codex:" + p.id;
        touch(id);
        client = p.originator;
        isSubagent = p.source?.subagent !== undefined;
        metaGit = p.git;
        cwd = p.cwd;
      } else if (d.type === "turn_context") {
        cwd = p.cwd ?? cwd;
        model = p.model ?? model;
      } else if (p.type === "task_started") {
        started.set(p.turn_id, p.started_at * 1000);
      } else if ((p.type === "task_complete" || p.type === "turn_aborted") && !isSubagent) {
        // Subagent turns run while a parent turn is waiting on them; counting them would double the time.
        const ms = p.duration_ms ?? ts - started.get(p.turn_id);
        const b = branchOf(ts);
        if (b !== undefined && ms >= 0) emit(id, { agent: "codex", client, ts, b, ms });
      } else if (p.type === "token_count" && p.info) {
        const total = p.info.total_token_usage.total_tokens;
        // token_count is re-emitted with an unchanged total; count each turn once.
        if (total === prevTotal) continue;
        prevTotal = total;
        const b = branchOf(ts);
        if (b === undefined || !model) continue;
        const u = p.info.last_token_usage;
        // OpenAI counts cached and cache-write tokens inside input_tokens; split them out.
        const cached = u.cached_input_tokens ?? 0;
        const written = u.cache_write_input_tokens ?? 0;
        emit(id, {
          agent: "codex",
          client,
          ts,
          b,
          model: model.replace(/^.*\//, ""),
          usage: {
            input: u.input_tokens - cached - written,
            cache_read: cached,
            cache_write_5m: written,
            output: u.output_tokens,
            reasoning: u.reasoning_output_tokens ?? 0,
          },
        });
      }
    }
  }
}

const duration = (ms) => `${Math.floor(ms / 3_600_000)}h ${String(Math.round((ms % 3_600_000) / 60_000)).padStart(2, "0")}m`;
const tokens = (u) => (u.input ?? 0) + (u.cache_read ?? 0) + (u.cache_write_5m ?? 0) + (u.cache_write_1h ?? 0) + (u.output ?? 0);

// A detached HEAD shows up as "HEAD" (ledger) or a commit hash (reflog).
const isDetached = (b) => b === "HEAD" || /^[0-9a-f]{7,40}$/.test(b);

function record(stage) {
  const cwd = process.cwd();
  const top = git(["rev-parse", "--show-toplevel"], cwd);
  const branch = git(["branch", "--show-current"], cwd);
  if (!branch) return console.error("ai-usage: detached HEAD, nothing recorded");
  const email = tryGit(["config", "user.email"], cwd);
  if (!email) return console.error("ai-usage: git user.email is not set, nothing recorded");

  // A branch's reflog survives `git branch -m`, so it lists the names this branch had before.
  const reflog = tryGit(["log", "-g", "--date=unix", "--format=%gd %gs", `refs/heads/${branch}`], cwd).split("\n");
  const names = new Set([branch]);
  for (const line of reflog) {
    const m = line.match(/renamed refs\/heads\/(.+) to refs\/heads\//);
    if (m) names.add(m[1]);
  }
  // Usage cannot predate the branch, so skip log files last written before it was created.
  const created = reflog.at(-1).match(/@\{(\d+)\}/);
  const since = created ? Number(created[1]) * 1000 - 86_400_000 : 0;
  const base = tryGit(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd).replace(/^origin\//, "") || "main";

  const repo = repoContext(cwd);
  const events = {};
  const touched = new Set();
  // Each event carries either token `usage` (with `model`) or the `ms` an agent spent on one user request.
  const emit = (id, e) => (events[id] ??= []).push(e);
  const touch = (id) => touched.add(id);
  collectClaude(repo, since, emit, touch);
  collectCodex(repo, since, emit, touch);

  const local = {};
  let unassigned = 0;
  let unassignedMs = 0;
  for (const [id, list] of Object.entries(events)) {
    list.sort((a, c) => a.ts - c.ts);
    // Work done detached or on the base branch belongs to the branch the same session moves to next, if any.
    let next;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (!isDetached(e.b) && e.b !== base) next = e.b;
      else if (next) e.b = next;
      else if (isDetached(e.b) && e.usage) unassigned += tokens(e.usage);
      else if (isDetached(e.b)) unassignedMs += e.ms;
    }
    for (const e of list) {
      if (!names.has(e.b)) continue;
      const s = (local[id] ??= { agent: e.agent, client: e.client ?? "unknown", agent_ms: 0, models: {}, first: e.ts, last: e.ts });
      if (e.usage) {
        const m = (s.models[e.model] ??= emptyUsage());
        for (const f of FIELDS) m[f] += e.usage[f] ?? 0;
      } else s.agent_ms += e.ms;
      s.first = Math.min(s.first, e.ts);
      s.last = Math.max(s.last, e.ts);
    }
  }
  if (unassigned || unassignedMs) {
    console.error(`ai-usage: ${unassigned.toLocaleString("en-US")} tokens and ${duration(unassignedMs)} of agent time on a detached HEAD could not be assigned to a branch`);
  }

  // Files recorded under this branch's former names are folded into the current one.
  const fileOf = (b) => path.join(USAGE_DIR, b, `${userSlug(email)}.json`);
  const rel = fileOf(branch);
  const sessions = {};
  const renamed = [...names].filter((b) => b !== branch && fs.existsSync(path.join(top, fileOf(b))));
  for (const r of [...renamed.map(fileOf), rel]) {
    if (fs.existsSync(path.join(top, r))) Object.assign(sessions, JSON.parse(fs.readFileSync(path.join(top, r), "utf8")).sessions);
  }
  // Sessions whose logs were read here are recomputed; sessions from other machines or deleted logs are kept as stored.
  for (const id of touched) delete sessions[id];
  for (const [id, s] of Object.entries(local)) {
    sessions[id] = { ...s, first: new Date(s.first).toISOString(), last: new Date(s.last).toISOString() };
  }
  for (const r of renamed) {
    if (stage) git(["rm", "-q", "--", fileOf(r)], top, process.env);
    else fs.rmSync(path.join(top, fileOf(r)));
  }
  if (Object.keys(sessions).length === 0) return;
  const json = JSON.stringify({ branch, user: email, sessions: Object.fromEntries(Object.entries(sessions).sort()) }, null, 2) + "\n";
  const file = path.join(top, rel);
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== json) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, json);
  }
  if (stage) git(["add", "--", rel], top, process.env);
}

function cost(model, u) {
  const p = PRICES[model];
  if (!p) return undefined;
  const write5m = p.cache_write ?? p.input * 1.25;
  const write1h = p.cache_write ?? p.input * 2;
  return (
    (u.input * p.input + u.cache_read * p.cache_read + u.cache_write_5m * write5m + u.cache_write_1h * write1h + u.output * p.output) /
    1e6
  );
}

function report(branchArg) {
  const top = git(["rev-parse", "--show-toplevel"], process.cwd());
  const branch = branchArg || git(["branch", "--show-current"], top);
  const dir = path.join(top, USAGE_DIR, branch);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  if (files.length === 0) {
    console.log(`### AI usage: \`${branch}\`\n\nNo usage recorded in \`${USAGE_DIR}/${branch}/\`.`);
    return;
  }
  const rows = new Map();
  const agentMs = new Map();
  const users = [];
  let sessionCount = 0;
  for (const f of files.sort()) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    users.push(data.user);
    for (const s of Object.values(data.sessions)) {
      sessionCount++;
      agentMs.set(s.agent, (agentMs.get(s.agent) ?? 0) + (s.agent_ms ?? 0));
      for (const [model, u] of Object.entries(s.models)) {
        const key = `${s.agent}\t${model}`;
        const r = (rows.set(key, rows.get(key) ?? emptyUsage()), rows.get(key));
        for (const k of FIELDS) r[k] += u[k];
      }
    }
  }
  const n = (x) => x.toLocaleString("en-US");
  const out = [
    `### AI usage: \`${branch}\``,
    "",
    `Contributors: ${users.join(", ")} · Sessions: ${sessionCount}`,
    "",
    `Agent time: **${duration([...agentMs.values()].reduce((a, b) => a + b, 0))}** (${[...agentMs].sort().map(([a, ms]) => `${a} ${duration(ms)}`).join(", ")})`,
    "",
    "| Agent | Model | Input | Cache read | Cache write | Output (reasoning) | Total | API-equiv. USD |",
    "|---|---|--:|--:|--:|--:|--:|--:|",
  ];
  const sum = emptyUsage();
  let usd = 0;
  let unpriced = false;
  for (const [key, u] of [...rows].sort()) {
    const [agent, model] = key.split("\t");
    const c = cost(model, u);
    if (c === undefined) unpriced = true;
    else usd += c;
    for (const k of FIELDS) sum[k] += u[k];
    const total = u.input + u.cache_read + u.cache_write_5m + u.cache_write_1h + u.output;
    out.push(
      `| ${agent} | ${model} | ${n(u.input)} | ${n(u.cache_read)} | ${n(u.cache_write_5m + u.cache_write_1h)} | ${n(u.output)} (${n(u.reasoning)}) | ${n(total)} | ${c === undefined ? "n/a" : "$" + c.toFixed(2)} |`,
    );
  }
  const total = sum.input + sum.cache_read + sum.cache_write_5m + sum.cache_write_1h + sum.output;
  out.push(
    `| **Total** | | ${n(sum.input)} | ${n(sum.cache_read)} | ${n(sum.cache_write_5m + sum.cache_write_1h)} | ${n(sum.output)} (${n(sum.reasoning)}) | ${n(total)} | **$${usd.toFixed(2)}**${unpriced ? "+" : ""} |`,
    "",
    "Input excludes cached tokens for every agent, so the columns add up to Total. Reasoning is part of Output.",
    "API-equiv. USD is list-price API cost, not what subscriptions actually billed." + (unpriced ? " `n/a`: no price on file for that model." : ""),
    "Agent time adds up the time agents spent working on each request; concurrent sessions add up, subagents are already inside their parent's time.",
  );
  console.log(out.join("\n"));
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "record") record(args.includes("--stage"));
else if (cmd === "report") report(args[0]);
else {
  console.error("usage: ai-usage.mjs record [--stage] | report [branch]");
  process.exit(2);
}
