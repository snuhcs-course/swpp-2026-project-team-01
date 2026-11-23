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
    approve: "샘플 요청을 승인했어요.",
    decline: "샘플 요청을 거절했어요.",
    change: "샘플 요청에 변경을 요청했어요.",
    end: "튜토리얼을 종료했어요.",
    complete: "튜토리얼이 끝났어요.",
    practice: "연습이었어요. 실제 일정은 만들어지지 않았고, 게스트에게도 알림이 가지 않았어요.",
  },
} as const;

// The tutorial offer says in one line what the tutorial is before asking
// (setup-chat-guidance, issue #377), and the Korean says what the English says:
// a sample request, never a different word for it. The web card shows the
// English offer beside Try it and Skip; linked chats send the host's language.
export const TUTORIAL_TEXT = {
  en: {
    offer: "A pretend guest sends you a sample request, and you try approving or changing it. Nobody real gets a message. Want to try?",
    sample: "Sample request",
    guide: "You can approve or decline this request. Ask me for more details or if you want to change anything.",
  },
  ko: {
    offer: "가상의 게스트가 샘플 요청을 보내면 승인하거나 바꿔 볼 수 있어요. 실제로는 아무에게도 메시지가 가지 않아요. 해보실래요?",
    sample: "샘플 요청",
    guide: "위 요청에 대해서 승인하거나, 거절하실 수 있어요. 자세한 정보를 원하시거나 조정이 필요하시면 저에게 말해주세요.",
  },
} as const;
