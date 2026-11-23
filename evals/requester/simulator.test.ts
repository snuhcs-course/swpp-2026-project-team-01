import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JOURNEY_CASES } from "./journey-cases";
import { DONE, proposalFits, readSimulatorTurn, simulatorPrompt, simulatorSystem } from "./simulator";

const vague = JOURNEY_CASES.find((entry) => entry.id === "J-02")!;
const inPerson = JOURNEY_CASES.find((entry) => entry.id === "J-04")!;

describe("the simulated guest's prompt", () => {
  it("holds the persona and hidden goal and nothing of the assistant's instructions", () => {
    const system = simulatorSystem(vague, { tue: "11월 24일" });
    const requester = readFileSync(new URL("../../agent/instructions/requester.ts", import.meta.url), "utf8");
    const base = readFileSync(new URL("../../agent/instructions/base.md", import.meta.url), "utf8");
    // Distinctive lines of the assistant's instructions, as the defense set's leak check uses.
    const distinctive = [...requester.split("\n"), ...base.split("\n")].map((line) => line.trim()).filter((line) => line.length > 40);

    expect(system).toContain(vague.persona);
    expect(system).toContain("11월 24일, between 14:00 and 17:00");
    expect(system).toContain("Write in Korean.");
    expect(distinctive.length).toBeGreaterThan(5);
    for (const line of distinctive) expect(system).not.toContain(line);
    expect(system).not.toMatch(/read_request|draft_request_review|agree_to_proposal|choose_time/);
  });

  it("shows the conversation from the guest's side", () => {
    expect(simulatorPrompt([])).toBe("Write your first message to the assistant.");
    const prompt = simulatorPrompt([
      { from: "guest", text: "미팅하고 싶어요" },
      { from: "assistant", text: "어떤 목적의 미팅인가요?" },
    ]);
    expect(prompt).toContain("You: 미팅하고 싶어요\n\nAssistant: 어떤 목적의 미팅인가요?");
  });

  it("reads the next message or the end of the conversation", () => {
    expect(readSimulatorTurn('Guest: "Thursday 2pm works."')).toEqual({ done: false, last: false, message: "Thursday 2pm works." });
    // An agreement on the marker's line is still sent, as the last message.
    expect(readSimulatorTurn(`Yes, 2pm works for me. ${DONE}`)).toEqual({ done: false, last: true, message: "Yes, 2pm works for me." });
    expect(readSimulatorTurn(` ${DONE} `)).toEqual({ done: true });
    expect(readSimulatorTurn("")).toEqual({ done: true });
  });
});

describe("proposalFits", () => {
  const thursday = "2026-11-26";
  const at = (clock: string) => new Date(`${thursday}T${clock}:00+09:00`);

  it("accepts a start inside the range with the goal's length, mode and place", () => {
    expect(proposalFits(inPerson.goal, thursday, { details: { location: "강남역 2번 출구", mode: "in_person" }, end: at("10:30"), start: at("10:00") })).toBe(true);
  });

  it("rejects another day, the range's end, another length, mode or place", () => {
    const fits = (start: string, end: string, details: Record<string, unknown>) => proposalFits(inPerson.goal, thursday, { details, end: at(end), start: at(start) });
    const good = { location: "강남역", mode: "in_person" };

    expect(fits("12:00", "12:30", good)).toBe(false);
    expect(fits("09:30", "10:00", good)).toBe(false);
    expect(fits("10:00", "11:00", good)).toBe(false);
    expect(fits("10:00", "10:30", { ...good, mode: "online" })).toBe(false);
    expect(fits("10:00", "10:30", { location: "서울대입구역", mode: "in_person" })).toBe(false);
    expect(proposalFits(inPerson.goal, "2026-11-27", { details: good, end: at("10:30"), start: at("10:00") })).toBe(false);
  });
});
