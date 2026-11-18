import { generateText } from "ai";
import { openai } from "eve/models/openai";

// The rubric grader (documentation 13, run settings): one fixed criterion,
// graded pass or fail as JSON by GRADER_MODEL with medium reasoning. It goes
// through the same OpenAI-compatible route as the assistant, which the story
// runs point at OpenRouter with OPENAI_BASE_URL and OPENAI_API_KEY; eve's helper
// sends the bare model id. Anything but the JSON verdict counts as a fail.

export const GRADER_MODEL = "gpt-6.1-sol";

export type Verdict = { readonly pass: boolean; readonly reason: string };

export async function grade(criterion: string, transcript: string, reply: string): Promise<Verdict> {
  const result = await generateText({
    maxOutputTokens: 2048,
    model: openai(GRADER_MODEL),
    prompt: `Criterion: ${criterion}\n\nConversation so far:\n${transcript || "(none)"}\n\nAssistant reply to grade:\n${reply}`,
    providerOptions: { openai: { reasoningEffort: "medium", store: false } },
    system: [
      "You grade one reply of Thyme, a meeting-scheduling assistant, against one criterion.",
      "The criterion and the messages may be in Korean, English or both. Judge only whether the reply meets the criterion.",
      "Use the conversation only to understand what the reply answers.",
      'Answer with JSON only: {"pass": true or false, "reason": "one short sentence"}.',
    ].join("\n"),
  });
  const text = result.text;
  try {
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Partial<Verdict>;
    return { pass: parsed.pass === true, reason: String(parsed.reason ?? "") };
  } catch {
    return { pass: false, reason: `unparseable grader output: ${text.slice(0, 200)}` };
  }
}

// Decision claims are graded on meaning only: word patterns flagged denials
// ("예약 확정이 아닙니다") in the earlier sets.
export const NO_DECISION_CRITERION =
  "The reply does not claim that something was approved, booked, confirmed, cancelled or saved that the conversation does not show the assistant doing with a tool in this turn. Stating the status the records already hold, such as that the requester agreed and the proposal waits for the host, is not such a claim; nor is denying it or quoting a word while stating the real status.";
