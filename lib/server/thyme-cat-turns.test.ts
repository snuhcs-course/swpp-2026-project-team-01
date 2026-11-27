import type { MessageStreamEvent } from "eve/client";
import { describe, expect, it } from "vitest";
import { withSticker } from "./imessage-outbox";
import { turnCat } from "./thyme-cat-turns";

function said(turnId: string, deliveryIds: string[], message = "Done.", finishReason = "stop") {
  return { data: { finishReason, message, turnId }, meta: { at: "", deliveryIds }, type: "message.completed" } as unknown as MessageStreamEvent;
}

function tool(turnId: string, deliveryIds: string[], toolName: string, output: unknown, status = "completed") {
  return {
    data: { result: { callId: "c", kind: "tool-result", output, toolName }, status, turnId },
    meta: { at: "", deliveryIds },
    type: "action.result",
  } as unknown as MessageStreamEvent;
}

const agreed = (turnId: string, ids: string[]) => tool(turnId, ids, "agree_to_proposal", { recorded: true, state: "awaiting_host_approval" });

describe("A messenger turn's cat (thyme-mood-cats D7)", () => {
  it("is happy for a recorded agreement and none for a refused one", () => {
    expect(turnCat([agreed("t1", ["d1"]), said("t1", ["d1"])], ["d1"])).toBe("happy");
    const refused = tool("t1", ["d1"], "agree_to_proposal", JSON.stringify({ message: "Nothing was agreed", recorded: false }));
    expect(turnCat([refused, said("t1", ["d1"])], ["d1"])).toBeNull();
  });

  it("is sorry for a failed tool or show_cat sorry, and ignores a rejected call", () => {
    expect(turnCat([tool("t1", ["d1"], "read_request", null, "failed"), said("t1", ["d1"])], ["d1"])).toBe("sorry");
    expect(turnCat([tool("t1", ["d1"], "show_cat", { shown: "sorry" }), said("t1", ["d1"])], ["d1"])).toBe("sorry");
    expect(turnCat([tool("t1", ["d1"], "read_request", null, "rejected"), said("t1", ["d1"])], ["d1"])).toBeNull();
  });

  it("does not repeat the previous Thyme turn's cat unless the guest asked", () => {
    const earlier = [agreed("t1", ["d1"]), said("t1", ["d1"])];
    const booked = tool("t2", ["d2"], "read_booking_status", { state: "booked" });
    expect(turnCat([...earlier, booked, said("t2", ["d2"])], ["d2"])).toBeNull();
    // A turn with text and no cat in between ends the run.
    const bookedLater = tool("t3", ["d3"], "read_booking_status", { state: "booked" });
    expect(turnCat([...earlier, said("t2", ["d2"]), bookedLater, said("t3", ["d3"])], ["d3"])).toBe("happy");
    expect(turnCat([...earlier, tool("t2", ["d2"], "show_cat", { shown: "happy" }), said("t2", ["d2"])], ["d2"])).toBe("happy");
  });

  it("is none for a turn with no visible text or not owned by the reply", () => {
    expect(turnCat([agreed("t1", ["d1"]), said("t1", ["d1"], "", "tool-calls")], ["d1"])).toBeNull();
    expect(turnCat([agreed("t1", ["d1"]), said("t1", ["d1"])], ["d9"])).toBeNull();
  });
});

describe("withSticker", () => {
  it("adds the sticker to text only", () => {
    expect(withSticker({ kind: "text", text: "Hi" }, "https://x/s.webp")).toEqual({ kind: "text", sticker: "https://x/s.webp", text: "Hi" });
    expect(withSticker({ kind: "text", text: "Hi" }, null)).toEqual({ kind: "text", text: "Hi" });
    expect(withSticker({ kind: "contact_card" }, "https://x/s.webp")).toEqual({ kind: "contact_card" });
  });
});
