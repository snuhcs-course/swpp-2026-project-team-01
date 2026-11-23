import type { EveEvalContext } from "eve/evals";
import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { grade } from "../story/grader";
import { type Check, FORBIDDEN_TOOLS, type SetupCase } from "./setup-cases";
import { hostSetupSession, readDraft, settingsSaved } from "./support";

// Runs host setup cases (setup.eval.ts; documentation 14). Every setup tool
// runs for real against the local database and the fake Google. A case is
// graded on the setup draft the conversation leaves, a rubric where wording
// matters, and the tools that must not run; never on the order of tool calls.
// Each case runs `trials` times as separate evals (pass^3).

export const DEFAULT_TRIALS = 3;

async function applyCheck(t: EveEvalContext, check: Check, transcript: string, reply: string, label: string) {
  if (check.kind === "excludes") {
    t.check(reply, satisfies((text: string) => !check.pattern.test(text), check.label)).label(`${label}: ${check.label}`);
    return;
  }
  const verdict = await grade(check.criterion, transcript, reply);
  t.log(`${label} judge: ${verdict.pass ? "pass" : "fail"}: ${verdict.reason}`);
  t.check(verdict.pass, satisfies((pass: boolean) => pass, check.criterion)).label(`${label}: ${check.criterion}`);
}

export function setupEval(entry: SetupCase, trial: number) {
  return defineEval({
    description: `${entry.id} (${entry.category}, ${entry.language}) run ${trial}`,
    metadata: { caseId: entry.id, category: entry.category, owasp: entry.owasp, trial },
    tags: ["host-setup", "live-model", "capability", entry.category, `case:${entry.id}`],
    timeoutMs: 120_000 + 90_000 * entry.turns.length,
    async test(t) {
      const { hostAccountId, send } = await hostSetupSession(t as never);
      const before = await readDraft(hostAccountId);
      const transcript: string[] = [];
      const called = new Set<string>();

      for (const [index, turn] of entry.turns.entries()) {
        const label = `turn ${index + 1}`;
        const result = await send(turn.message);
        const reply = String(result.message ?? "");
        for (const call of result.toolCalls) called.add(call.name);
        t.check(reply, satisfies((text: string) => text.trim().length > 0, "replies")).label(`${label}: replies`);
        const context = [...transcript, `Host: ${turn.message}`].join("\n\n");
        for (const check of turn.checks) await applyCheck(t, check, context, reply, label);
        transcript.push(`Host: ${turn.message}`, `Assistant: ${reply}`);
      }

      t.succeeded();
      const forbidden = FORBIDDEN_TOOLS.filter((tool) => called.has(tool));
      t.check(forbidden, satisfies((tools: string[]) => tools.length === 0, "calls no tool that saves or leaves setup")).label(
        `calls no tool that saves or leaves setup${forbidden.length ? ` (called: ${forbidden.join(", ")})` : ""}`,
      );
      t.check(await settingsSaved(hostAccountId), satisfies((saved: boolean) => !saved, "saves no settings")).label("database: saves no settings");

      const after = await readDraft(hostAccountId);
      for (const expectation of entry.draft) {
        let holds = false;
        try {
          holds = expectation.holds(after, before);
        } catch (error) {
          t.log(`draft check ${expectation.label} threw: ${String(error)}`);
        }
        t.check(holds, satisfies((ok: boolean) => ok, expectation.label)).label(`draft: ${expectation.label}`);
      }
      t.log(`tools: ${[...called].join(", ") || "none"}`);
    },
  });
}
