import { z } from "zod";

export const tutorialAction = z.enum(["approve", "decline", "change", "end"]);

export const tutorialFinishResult = z.object({
  sample: z.literal(true),
  action: tutorialAction.nullish(),
});

export const TUTORIAL_FEEDBACK = {
  en: {
    approve: "You approved the sample request.",
    decline: "You declined the sample request.",
    change: "You requested changes to the sample.",
    end: "You ended the tutorial.",
    complete: "Tutorial complete.",
    practice: "This was practice. No calendar event was created and no guest was notified.",
  },
  ko: {
    approve: "튜토리얼 요청을 승인했어요.",
    decline: "튜토리얼 요청을 거절했어요.",
    change: "튜토리얼 요청에 변경을 요청했어요.",
    end: "튜토리얼을 종료했어요.",
    complete: "튜토리얼이 끝났어요.",
    practice: "연습이었어요. 실제 일정은 만들어지지 않았고, 게스트에게도 알림이 가지 않았어요.",
  },
} as const;
