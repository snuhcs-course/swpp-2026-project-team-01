import { generateText } from "ai";
import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { openai } from "eve/models/openai";
import { GUEST_OFFER, nextWeek, seedHost, seedRequest } from "../story/fixtures";
import { grade, GRADER_MODEL } from "../story/grader";
import { storyRuntime } from "../story/runtime";
import { type EvalContext, guestSession } from "../story/sessions";
import { CAPABILITY } from "../tags";
import type { JourneyCase } from "./journey-cases";
import { type Line, proposalFits, readSimulatorTurn, simulatorPrompt, simulatorSystem } from "./simulator";

// Runs simulated guest journeys (journey.eval.ts; documentation 13, "Simulated
// guest journeys"). The guest assistant runs with every guest tool for real
// against the local database and the fake Google Calendar that
// evals.config.ts starts (story/runtime.ts); only the guest is simulated. Each
// case runs `trials` times as separate evals: pass^3 is the share of cases
// whose every run passed, pass@1 the share of runs that passed.

export const DEFAULT_TRIALS = 3;

// The simulator is not the assistant's model, so the guest does not share the
// assistant's habits; it uses the grader's route and model.
export const SIMULATOR_MODEL = GRADER_MODEL;

// The guest tools a booking journey may call; host tools are never among them.
const GUEST_TOOLS = new Set([
  "read_request",
  "draft_request_review",
  "apply_request_review",
  "evaluate_candidates",
  "read_booking_status",
  "choose_time",
  "agree_to_proposal",
  "change_agreement",
]);

const TONE_CRITERION =
  "Across the whole conversation, the assistant is polite and plain, writes in the language the guest writes in, and keeps each reply short enough for a booking page; it never lectures, repeats itself at length or uses internal terms such as tool names.";

const NO_FALSE_BOOKING_CRITERION =
  "The assistant never tells the guest the meeting is booked, confirmed or approved by the host; saying the guest's agreement is recorded and waits for the host's approval is correct.";

async function simulate(system: string, lines: readonly Line[]) {
  const result = await generateText({
    maxOutputTokens: 1024,
    model: openai(SIMULATOR_MODEL),
    prompt: simulatorPrompt(lines),
    providerOptions: { openai: { reasoningEffort: "low", store: false } },
    system,
  });
  return { text: result.text, tokens: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0) };
}

async function endState(requestId: string) {
  const { db } = storyRuntime();
  const [request] = await db<{ state: string }[]>`select state from app.requests where id = ${requestId}`;
  const [agreed] = await db<{ start_at: Date; end_at: Date; details: Record<string, unknown> }[]>`
    select p.start_at, p.end_at, p.details from app.proposals p
    join app.agreements a on a.proposal_id = p.id
    where p.request_id = ${requestId}
    order by p.version desc limit 1
  `;
  return { agreed: agreed ?? null, state: request?.state ?? null };
}

export function journeyEval(entry: JourneyCase, trial: number) {
  return defineEval({
    description: `${entry.id} (${entry.style}, ${entry.language}) run ${trial}`,
    metadata: { caseId: entry.id, language: entry.language, style: entry.style, trial },
    tags: ["requester", "live-model", CAPABILITY, "journey", entry.style, `case:${entry.id}`],
    timeoutMs: 120_000 + 90_000 * entry.turnLimit,
    async test(t) {
      const week = nextWeek();
      // The host offer most guest story cases start from, and a request that
      // knows nothing yet but its length: the guest gives the rest.
      const host = await seedHost({ settings: GUEST_OFFER });
      const request = await seedRequest(host, { details: { durationMinutes: 30 }, language: entry.language });
      const guest = await guestSession(t as unknown as EvalContext, request.requestId, "web");
      const dates = Object.fromEntries(Object.entries(week).map(([day, date]) => [day, entry.language === "ko" ? date.ko : `${date.en} (${day})`]));
      const system = simulatorSystem(entry, dates);

      const lines: Line[] = [];
      const called = new Set<string>();
      let guestTurns = 0;
      let simulatorTokens = 0;
      let finished = false;

      while (guestTurns < entry.turnLimit) {
        const next = await simulate(system, lines);
        simulatorTokens += next.tokens;
        const turn = readSimulatorTurn(next.text);
        if (turn.done) {
          finished = true;
          break;
        }
        guestTurns++;
        const result = await guest.send(turn.message);
        for (const call of result.toolCalls) called.add(call.name);
        lines.push({ from: "guest", text: turn.message }, { from: "assistant", text: String(result.message ?? "") });
      }

      const transcript = lines.map((line) => `${line.from === "guest" ? "Guest" : "Assistant"}: ${line.text}`).join("\n\n");
      t.log(`guest turns: ${guestTurns}; simulator finished: ${finished}; simulator tokens: ${simulatorTokens}`);
      t.log(`tools: ${[...called].join(", ") || "none"}`);

      t.succeeded();
      t.check(finished, satisfies((ok: boolean) => ok, `ends within ${entry.turnLimit} guest messages`)).label(`turn limit: ends within ${entry.turnLimit} guest messages`);

      const unexpected = [...called].filter((name) => !GUEST_TOOLS.has(name));
      t.check(unexpected, satisfies((tools: string[]) => tools.length === 0, "calls only guest booking tools")).label(
        `calls only guest booking tools${unexpected.length ? ` (also called: ${unexpected.join(", ")})` : ""}`,
      );

      const state = await endState(request.requestId);
      t.check(state.state, satisfies((value: string | null) => value === "awaiting_host_approval", "waits for the host's approval")).label(
        `end state: awaiting_host_approval (was ${state.state})`,
      );
      const fits = state.agreed !== null && proposalFits(entry.goal, week[entry.goal.day].iso, { details: state.agreed.details, end: state.agreed.end_at, start: state.agreed.start_at });
      t.check(fits, satisfies((ok: boolean) => ok, "the agreed proposal fits the hidden goal")).label("end state: the agreed proposal fits the hidden goal");

      const lastReply = lines.at(-1)?.text ?? "";
      for (const [label, criterion] of [
        ["tone", TONE_CRITERION],
        ["no false booking", NO_FALSE_BOOKING_CRITERION],
      ] as const) {
        const verdict = await grade(criterion, transcript, lastReply);
        t.log(`${label} judge: ${verdict.pass ? "pass" : "fail"}: ${verdict.reason}`);
        t.check(verdict.pass, satisfies((pass: boolean) => pass, criterion)).label(`rubric: ${label}`);
      }
    },
  });
}
