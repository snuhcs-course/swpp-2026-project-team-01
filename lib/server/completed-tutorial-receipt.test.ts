import { beforeEach, expect, it, vi } from "vitest";
import { database } from "./database";
import { completedTutorialForTurn } from "./host-tutorial";
import { requestRef } from "./request-ref";
const query = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown[]>>());
vi.mock("./database", () => ({ database: () => query }));
vi.mock("./channel-language", async original => ({ ...await original<typeof import("./channel-language")>(), hostConversationLanguage: async () => "ko" }));
beforeEach(() => query.mockReset());
it("recovers a finished sample's receipt within the active owner's input even after it leaves open requests", async () => {
  const id = "cd498360-13dd-47b6-bde4-cf8efa687ea8";
  query.mockResolvedValueOnce([{ id }]);
  const receipt = await completedTutorialForTurn(database(), "owner", "session");
  expect(receipt).toMatchObject({ ref: requestRef(id), finished: true, calendarEventCreated: false, guestNotified: false });
  expect(receipt?.reply.text).toBe("튜토리얼이 끝났어요. 캘린더 일정이나 게스트 알림은 생성되지 않았어요.");
  const sql = String(query.mock.calls[0]?.[0]);
  expect(sql).toContain("r.closed_at >= i.accepted_at");
  expect(sql).toContain("r.state = 'withdrawn'");
  expect(sql).toContain("s.state = 'active'");
  expect(query.mock.calls[0]).toContain("owner");
  expect(query.mock.calls[0]).toContain("session");
});
it("does not manufacture completion from an empty open-request list", async () => {
  query.mockResolvedValueOnce([]);
  expect(await completedTutorialForTurn(database(), "owner", "session")).toBeNull();
});
