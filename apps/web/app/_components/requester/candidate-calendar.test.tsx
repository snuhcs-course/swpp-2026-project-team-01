import type { RequesterCandidate } from "@lib/contracts/request";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CandidateCalendar, candidateLabel, sharedDetails } from "./candidate-calendar";

const SEOUL = "Asia/Seoul";
const candidate = (id: string, start: string, overrides: Partial<RequesterCandidate> = {}): RequesterCandidate => ({
  displayTimezone: SEOUL,
  durationMinutes: 30,
  end: new Date(Date.parse(start) + 30 * 60_000).toISOString(),
  id,
  linkPlan: null,
  location: "서울대입구",
  mode: "in_person",
  start,
  unresolvedRequesterLeg: null,
  ...overrides,
});

const a = candidate("a", "2026-12-01T01:00:00.000Z");
const b = candidate("b", "2026-12-02T05:00:00.000Z");

describe("the Choose a time calendar", () => {
  it("says shared details once and leaves them out of each time", () => {
    const shared = sharedDetails([a, b], SEOUL);
    expect(shared).toEqual({ duration: "30 minutes", place: "서울대입구", zone: "Asia/Seoul (GMT+9)" });
    expect(candidateLabel(a, SEOUL, shared)).toBe("Tuesday 1 Dec, 10:00–10:30");
  });

  it("names a detail that differs on the time itself", () => {
    const online = candidate("c", "2026-12-03T01:00:00.000Z", { location: null, mode: "online" });
    const shared = sharedDetails([a, online], SEOUL);
    expect(shared?.place).toBeNull();
    expect(candidateLabel(online, SEOUL, shared)).toBe("Thursday 3 Dec, 10:00–10:30, Online");
  });

  it("draws offered times as choose buttons and trip-dependent times apart", () => {
    const trip = candidate("t", "2026-12-04T01:00:00.000Z", { unresolvedRequesterLeg: "inbound" });
    const html = renderToStaticMarkup(
      <CandidateCalendar bookingId="x" busy={false} linkMissing={() => false} offered={[a, b]} onChoose={() => {}} onTrip={() => {}} timeZone={SEOUL} trips={[trip]} />,
    );
    expect(html).toContain("Asia/Seoul (GMT+9) · 30 minutes · 서울대입구");
    expect(html).toContain('aria-label="Choose this time: Tuesday 1 Dec, 10:00–10:30"');
    expect(html).toContain('aria-label="Depends on your trip: Friday 4 Dec, 10:00–10:30. Estimate your trip"');
    expect(html).toContain("cw-mark cw-trip");
    expect(html).toContain("Dashed times depend on your trip");
  });

  it("tags a ticked time and names its notes", () => {
    const noted = { ...a, notes: ["Inside your usual Tuesday hours 09:00–12:00."] };
    const html = renderToStaticMarkup(
      <CandidateCalendar bookingId="x" busy={false} linkMissing={() => false} marked={["a"]} offered={[noted, b]} onChoose={() => {}} onTrip={() => {}} timeZone={SEOUL} trips={[]} />,
    );
    expect(html).toContain('aria-label="Choose this time: Tuesday 1 Dec, 10:00–10:30, ticked as also working. Inside your usual Tuesday hours 09:00–12:00."');
    expect(html).toContain("✓ Also works");
  });
});
