import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "./database";
import { readGuestThread } from "./guest-thread";

const started = new Date("2026-11-25T03:00:00.000Z");
const searched = new Date("2026-11-25T03:01:00.000Z");
const agreed = new Date("2026-11-25T03:02:00.000Z");
const changed = new Date("2026-11-25T03:10:00.000Z");

function database(updatedAt = changed) {
  return vi.fn()
    .mockResolvedValueOnce([{
      state: "negotiating", created_at: started, updated_at: updatedAt,
      identified_at: started, identity_requested_at: null, identity_google: false,
      calendar_settled_at: started, calendar_grant: false,
      requester_name: "Alex", contact_email: null, purpose: "Coffee chat",
      latest_applied: null, latest_evaluation: searched, agreed_at: agreed,
      profile_at: null, profile_decided_at: null, profile_items: null, profile_messenger: false,
    }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: "old-search", created_at: searched }])
    .mockResolvedValueOnce([{
      version: 1, evaluation_id: "old-search", created_at: searched,
      agreed_at: agreed, start_at: started, end_at: searched,
      picked_from: null, time_count: 1,
    }]) as unknown as Queryable;
}

const reopened = { evaluationId: null, proposalVersion: null, agreedVersion: null, pendingReviewId: null };

describe("Find times thread position", () => {
  it("places the card reopened by Change meeting after the previous agreement and intervening conversation", async () => {
    const cards = await readGuestThread(database(), "request", reopened);
    const find = cards.find((card) => card.id === "times:find")!;
    const previousMessage = new Date("2026-11-25T03:09:00.000Z");

    expect(find.status).toBe("open");
    expect(Date.parse(find.at)).toBeGreaterThan(previousMessage.getTime());
    expect(cards.at(-1)?.id).toBe("times:find");
  });

  it("uses the later details change even when no review was applied, and stays stable on reload", async () => {
    const detailsChanged = new Date("2026-11-25T03:15:00.000Z");
    const read = () => readGuestThread(database(detailsChanged), "request", reopened);
    const first = (await read()).find((card) => card.id === "times:find")!;
    const reloaded = (await read()).find((card) => card.id === "times:find")!;

    expect(Date.parse(first.at)).toBeGreaterThan(detailsChanged.getTime());
    expect(reloaded.at).toBe(first.at);
  });

  it("keeps an existing current search anchored to when it was requested", async () => {
    const cards = await readGuestThread(database(), "request", { ...reopened, evaluationId: "old-search" });
    expect(cards.find((card) => card.id === "times:old-search")).toMatchObject({ at: searched.toISOString(), status: "open" });
    expect(cards.some((card) => card.id === "times:find")).toBe(false);
  });
});
