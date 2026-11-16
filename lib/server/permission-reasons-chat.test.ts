import { describe, expect, it } from "vitest";
import { PERMISSION_REASONS } from "../contracts/permission-reasons";
import { channelReplies } from "./channel-texts";
import { LINK_TEXTS } from "./imessage-links";

// Issue #203: the linked chats carry the same reason lines the web shows, in the
// conversation's language, on the message that makes each ask.
describe("permission reasons in the linked chats", () => {
  it("adds the Google reason to every message that sends the Google link", () => {
    const url = "https://findmeatime.com/auth/sign-in?consent=calendar&return=imessage";
    expect(LINK_TEXTS.welcomeCalendar(url)).toContain(PERMISSION_REASONS.en.googleSignIn);
    expect(LINK_TEXTS.receivedBeforeSignIn(url)).toContain(PERMISSION_REASONS.en.googleSignIn);
    for (const language of ["en", "ko"] as const) {
      expect(channelReplies(language).nextStep.connect_calendar).toContain(PERMISSION_REASONS[language].googleSignIn);
    }
  });

  it("adds the calendar reason to the calendar choice and the note reason to the note review link", () => {
    for (const language of ["en", "ko"] as const) {
      const onboarding = channelReplies(language).onboarding;
      const reasons = PERMISSION_REASONS[language];
      expect(onboarding.rolesDefault("Me").split("\n").at(-1)).toBe(reasons.calendarRoles);
      expect(onboarding.rolesNeeded.split("\n").at(-1)).toBe(reasons.calendarRoles);
      expect(onboarding.noteReviewLink(3, "https://findmeatime.com/app/notes").split("\n").at(-1)).toBe(reasons.noteReview);
    }
  });
});
