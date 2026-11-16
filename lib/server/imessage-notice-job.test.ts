import { describe, expect, it } from "vitest";
import { GUEST_NOTICE_TEXTS } from "./imessage-notice-job";

// The guest's new-version notice in their linked conversation mirrors the
// email (#179) and lists what the host changed (#198).

describe("the guest's new-version notice", () => {
  it("lists each changed field on its own line", () => {
    const text = GUEST_NOTICE_TEXTS.en.status_new_version("Ada Lovelace", "Mon, Nov 2, 10:00 AM–10:30 AM (Asia/Seoul)", [
      "Place: Cafe Onion (was: Seoul Station)",
    ]);

    expect(text).toBe(
      "Ada Lovelace sent back changed meeting details:\n- Place: Cafe Onion (was: Seoul Station)\nNothing is agreed yet. Reply here to agree or to ask for something else.",
    );
  });

  it("keeps the new time in the sentence without a list of changes", () => {
    expect(GUEST_NOTICE_TEXTS.ko.status_new_version("Ada", "11월 2일 (월), 오전 10:00~10:30 (Asia/Seoul)")).toContain(
      "다시 보냈습니다: 11월 2일 (월)",
    );
  });
});
