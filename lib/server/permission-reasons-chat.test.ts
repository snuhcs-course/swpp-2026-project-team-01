import { describe, expect, it } from "vitest";
import { PERMISSION_REASONS } from "../contracts/permission-reasons";
import { channelReplies } from "./channel-texts";
import { CALENDAR_ASK_CAUSES, type CalendarAskCause, LINK_TEXTS } from "./imessage-links";

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

  // Issue #407: a host who signed in with Google but has no usable Calendar
  // grant is told why Calendar is asked for again.
  it("says why the welcome asks for Calendar again, and only when there is a reason", () => {
    const url = "https://findmeatime.com/auth/sign-in?consent=calendar&return=imessage";
    const plain = LINK_TEXTS.welcomeCalendar(url);
    for (const line of Object.values(CALENDAR_ASK_CAUSES)) expect(plain).not.toContain(line);
    for (const cause of Object.keys(CALENDAR_ASK_CAUSES) as CalendarAskCause[]) {
      const lines = LINK_TEXTS.welcomeCalendar(url, cause).split("\n");
      expect(lines.at(-2)).toBe(CALENDAR_ASK_CAUSES[cause]);
      expect(lines.at(-1)).toBe(PERMISSION_REASONS.en.googleSignIn);
      expect(lines.at(-3)).toBe(`First, connect Google Calendar: ${url}`);
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
