import type { JourneyCase } from "./journey-cases";

// The simulated guest of the booking journey evaluation (issue #155;
// documentation 13, "Simulated guest journeys"). A language model plays one
// persona with a hidden goal. It sees only its persona and the conversation as
// the guest sees it: the assistant's replies, never the assistant's
// instructions, tools or tool results. These functions build its prompt and
// read its answer; journey-runner.ts calls the model.

// The simulator ends the conversation with this marker once the guest has
// agreed to a time, or has given up.
export const DONE = "[DONE]";

export type Line = { readonly from: "guest" | "assistant"; readonly text: string };

export function simulatorSystem(entry: JourneyCase, dates: Readonly<Record<string, string>>) {
  const goal = entry.goal;
  const day = dates[goal.day] ?? goal.day;
  return [
    "You play a person who wants to book a meeting with someone through their scheduling assistant on a booking page.",
    "Stay in character. Write only the guest's next message, as the guest would type it: no narration, no quotes around it, no labels.",
    `Write in ${entry.language === "ko" ? "Korean" : "English"}.`,
    "",
    `Who you are: ${entry.persona}`,
    "",
    "Your hidden goal (do not paste this list; reveal details as the persona would):",
    `- Purpose: ${goal.purpose}`,
    `- Length: ${goal.durationMinutes} minutes`,
    `- Mode: ${goal.mode === "online" ? "online" : `in person near ${goal.place}`}`,
    `- When: ${day}, between ${goal.from} and ${goal.to} (Asia/Seoul). Any start inside that range is fine.`,
    ...(entry.changeOfMind ? [`- Change of mind: ${entry.changeOfMind}`] : []),
    "",
    "When the assistant offers times, pick one that fits your goal and say so plainly. When it asks you to agree to a proposed time that fits, agree clearly.",
    "If an offered time does not fit, say so and ask for another. Never accept a time outside your goal.",
    `When you have agreed to a time that fits, or the assistant says your agreement is recorded and waits for the host, reply with exactly ${DONE}.`,
    `If you cannot get a fitting time, reply with exactly ${DONE}.`,
  ].join("\n");
}

// The conversation from the guest's side: the guest's own messages are the
// simulator's earlier turns, the assistant's replies are the other party.
export function simulatorPrompt(lines: readonly Line[]) {
  if (lines.length === 0) return "Write your first message to the assistant.";
  const transcript = lines.map((line) => `${line.from === "guest" ? "You" : "Assistant"}: ${line.text}`).join("\n\n");
  return `The conversation so far:\n\n${transcript}\n\nWrite your next message, or ${DONE}.`;
}

// The simulator's answer: the next guest message, or the end of the
// conversation. An empty answer also ends it, so a broken simulator cannot
// loop until the turn limit.
// A message written on the same line as the marker is still sent, and the
// conversation ends after the assistant's reply to it.
export type SimulatorTurn =
  | { readonly done: true }
  | { readonly done: false; readonly message: string; readonly last: boolean };

export function readSimulatorTurn(text: string): SimulatorTurn {
  const last = text.includes(DONE);
  const message = text
    .replaceAll(DONE, "")
    .trim()
    .replace(/^(guest|you|me)\s*:\s*/i, "")
    .replace(/^"(.*)"$/s, "$1")
    .trim();
  if (!message) return { done: true };
  return { done: false, last, message };
}

// Whether an agreed proposal fits the hidden goal: on the goal's day in
// Asia/Seoul, starting inside its range, the goal's length and mode, and for in
// person at its place. `dayIso` is the goal day's date (YYYY-MM-DD).
export function proposalFits(
  goal: JourneyCase["goal"],
  dayIso: string,
  proposal: { readonly start: Date; readonly end: Date; readonly details: Readonly<Record<string, unknown>> },
) {
  const from = new Date(`${dayIso}T${goal.from}:00+09:00`).getTime();
  const to = new Date(`${dayIso}T${goal.to}:00+09:00`).getTime();
  const start = proposal.start.getTime();
  const minutes = (proposal.end.getTime() - start) / 60_000;
  const mode = proposal.details.mode;
  const place = goal.place === undefined || JSON.stringify(proposal.details.location ?? null).includes(goal.place);
  return start >= from && start < to && minutes === goal.durationMinutes && mode === goal.mode && place;
}
