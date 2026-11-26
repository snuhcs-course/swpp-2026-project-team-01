import type { EveEvalContext } from "eve/evals";
import { defineEval } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";
import { CAPABILITY, evalTrials } from "../tags";
import { accountSession, prepareSavedHost } from "../account-assistant/support";
import { nextWeek } from "./fixtures";
import { grade, NO_DECISION_CRITERION } from "./grader";
import { type EvalContext, type EvalTurn, guestSession, type HostChannel, hostReviewSession, linkHost } from "./sessions";
import { buildState } from "./states";
import { snapshot, type StoryView, view } from "./state";
import type { Check, StoryCase, StoryContext, ToolCall } from "./types";

// Runs story cases against the real assistant, with every tool running for
// real against the local database and the fake Google (runtime.ts). Each case
// runs `trials` times as separate evals, so pass^3 is the share of cases whose
// every run passed and pass^1 the share of runs that passed.

export const DEFAULT_TRIALS = 3;

const HANGUL = /[가-힣]/;
// Korean names, places and purposes the fixtures write (fixtures.ts, states.ts)
// and quoted text: an English reply may name them as they are.
const QUOTED = /"[^"]*"|“[^”]*”|'[^']*'|‘[^’]*’/g;
const FIXTURE_NAMES = /서울대입구역|강남역|성수|지원|김민지|박도현|컴파일러 이야기 커피챗|투자 상담|채용 상담/g;

function fill(message: string, context: StoryContext) {
  return message.replace(/\{(mon|tue|wed|thu|fri|sat|sun)\.(ko|en|iso)\}/g, (_, day: keyof StoryContext["dates"], form: "ko" | "en" | "iso") => context.dates[day][form]);
}

// The decision state a conversation may or may not change: what the guest and
// the host see and decide on. Lookups write evaluations and jobs; those are not
// decisions, and a question note (a review of intent question or unknown with no
// details) only records that the assistant asked something (team, 2026-11-03).
function decisions(state: StoryView) {
  return {
    approvals: state.approvals.length,
    bookings: state.bookings.map((row) => row.state),
    details: state.details,
    proposals: state.proposals.map((row) => row.version),
    reviews: state.reviews.filter((row) => !((row.intent === "question" || row.intent === "unknown") && row.patch === null)).map((row) => [row.id, row.state]),
    selected: state.selected,
    settings: state.settings,
    state: state.state,
    suggestions: state.suggestions.map((row) => [row.id, row.state]),
  };
}

async function applyCheck(t: EveEvalContext, check: Check, transcript: string, reply: string, label: string, context: StoryContext) {
  switch (check.kind) {
    case "noDecisionClaim":
    case "judge": {
      const criterion = check.kind === "judge" ? check.criterion : NO_DECISION_CRITERION;
      const verdict = await grade(criterion, transcript, reply);
      t.log(`${label} judge: ${verdict.pass ? "pass" : "fail"}: ${verdict.reason}`);
      t.check(verdict.pass, satisfies((pass: boolean) => pass, criterion)).label(`${label}: ${check.kind === "judge" ? criterion : "claims no decision"}`);
      return;
    }
    case "excludes":
      t.check(reply, satisfies((text: string) => !check.pattern.test(text), check.label)).label(`${label}: ${check.label}`);
      return;
    case "includes":
      t.check(reply, includes(typeof check.pattern === "function" ? check.pattern(context) : check.pattern)).label(`${label}: ${check.label}`);
      return;
    case "language": {
      const korean = HANGUL.test(reply.replace(QUOTED, "").replace(FIXTURE_NAMES, ""));
      t.check(check.language === "ko" ? korean : !korean, satisfies((ok: boolean) => ok, `replies in ${check.language}`)).label(`${label}: replies in ${check.language}`);
      return;
    }
  }
}

type Conversation = { send(text: string): Promise<EvalTurn> };

export function storyEval(entry: StoryCase, trial: number, set: string) {
  return defineEval({
    description: `${entry.id} (${entry.category}, ${entry.shape}) run ${trial}`,
    metadata: { caseId: entry.id, category: entry.category, group: entry.group ?? null, shape: entry.shape, source: entry.source, trial },
    tags: [entry.conversation, "live-model", CAPABILITY, set, entry.category, entry.shape, `case:${entry.id}`],
    timeoutMs: 120_000 + 90_000 * (entry.turns.length + (entry.prelude?.length ?? 0)),
    async test(t) {
      const language = entry.language === "en" ? "en" : "ko";
      const built = await buildState(entry.state, language);
      const { request } = built;
      if (entry.conversation === "host_setup") await prepareSavedHost(request);
      const context: StoryContext = { dates: nextWeek(), facts: built.facts, hostAccountId: request.hostAccountId, requestId: request.requestId };
      const session = t as unknown as EvalContext;

      // The host's linked messenger selects this request, as the approval
      // summary does; the web chat needs no link.
      const hostChannel = entry.conversation === "host_review" && entry.channel !== "web" ? (entry.channel as HostChannel) : null;
      if (hostChannel) await linkHost(request.hostAccountId, hostChannel, request.requestId);

      const open = (requestId: string): Promise<Conversation> =>
        entry.conversation === "host_setup"
          ? accountSession(t, request.hostAccountId)
          : entry.conversation === "requester"
          ? guestSession(session, requestId, entry.channel as "web" | "imessage" | "email")
          : hostReviewSession(session, request.hostAccountId, requestId, hostChannel);
      let conversationRequest = request.requestId;
      let conversation = await open(conversationRequest);

      const transcript: string[] = [];
      for (const text of entry.prelude ?? []) {
        const turn = await conversation.send(fill(text, context));
        transcript.push(`User: ${fill(text, context)}`, `Assistant: ${String(turn.message ?? "")}`);
      }

      const before = view(await snapshot(request.requestId, request.hostAccountId));
      const called: ToolCall[] = [];

      for (const [index, turn] of entry.turns.entries()) {
        const label = `turn ${index + 1}`;
        const message = fill(turn.message, context);
        const result = await conversation.send(message);
        const reply = String(result.message ?? "");
        const calls = result.toolCalls.map((call) => ({ input: call.input, name: call.name, output: call.output }));
        called.push(...calls);
        const context_ = [...transcript, `User: ${message}`, `(Tools the assistant called this turn: ${calls.map((call) => call.name).join(", ") || "none"})`].join("\n\n");

        if (!turn.replyOptional && turn.checks.length > 0) {
          t.check(reply, satisfies((text: string) => text.trim().length > 0, "replies")).label(`${label}: replies`);
        }
        if (!turn.replyOptional || reply.trim()) {
          for (const check of turn.checks) await applyCheck(t, check, context_, reply, label, context);
        }
        for (const expected of turn.calls ?? []) {
          const names: readonly string[] = typeof expected.name === "string" ? [expected.name] : expected.name;
          const matched = calls.some((call) => names.includes(call.name) && (!expected.input || expected.input((call.input ?? {}) as Record<string, unknown>, context)));
          t.check(matched, satisfies((ok: boolean) => ok, `calls ${names.join(" or ")}`)).label(`${label}: calls ${expected.label ?? names.join(" or ")}`);
        }
        for (const name of turn.forbid ?? []) {
          t.check(calls.some((call) => call.name === name), satisfies((hit: boolean) => !hit, `does not call ${name}`)).label(`${label}: does not call ${name}`);
        }
        transcript.push(`User: ${message}`, `Assistant: ${reply}`);


      }

      // A request closed in a turn runs no more model work, so the reply step after
      // the closing tool fails by design (model-limits.ts, authority_expired);
      // such a case is graded by its tool calls and state, not by run success.
      if (entry.turns.some((turn) => turn.replyOptional)) t.log("run success not graded: the request closes in this conversation");
      else t.succeeded();
      const allowed = new Set(entry.allowed);
      const unexpected = [...new Set(called.map((call) => call.name).filter((name) => !allowed.has(name)))];
      t.check(unexpected, satisfies((tools: string[]) => tools.length === 0, "calls only allowed tools")).label(
        `calls only allowed tools${unexpected.length ? ` (also called: ${unexpected.join(", ")})` : ""}`,
      );

      const after = view(await snapshot(request.requestId, request.hostAccountId));
      if (entry.database === "unchanged") {
        const same = JSON.stringify(decisions(before)) === JSON.stringify(decisions(after));
        t.check(same, satisfies((ok: boolean) => ok, "leaves the decision state unchanged")).label("database: decision state unchanged");
      } else {
        for (const expectation of entry.database) {
          let holds = false;
          try {
            holds = expectation.holds(after, before, context);
          } catch (error) {
            t.log(`database check ${expectation.label} threw: ${String(error)}`);
          }
          t.check(holds, satisfies((ok: boolean) => ok, expectation.label)).label(`database: ${expectation.label}`);
        }
      }
      t.log(`turns: ${entry.turns.length}; tools: ${called.map((call) => call.name).join(", ") || "none"}`);
    },
  });
}

export function storyEvals(cases: readonly StoryCase[], set: string) {
  return cases.flatMap((entry) => Array.from({ length: evalTrials(entry.trials ?? DEFAULT_TRIALS) }, (_, index) => storyEval(entry, index + 1, set)));
}
