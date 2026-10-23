import { defineDynamic, defineInstructions } from "eve/instructions";
import { isHostReviewSession } from "../../lib/server/host-review-tools";
import { calendarConnectUrl } from "../../lib/server/imessage-links";
import { isHostSetupSession } from "../../lib/server/setup-tools";

// The host iMessage fragment (host-imessage-channel design 9, D11), for both of a
// host's discussions, which a linked iMessage shares with /app. A message that
// arrived from iMessage starts with "[iMessage] ", and the reply goes back there
// as plain text with no cards. Links name the deployment's origin, findmeatime.com
// when APP_ORIGIN is unset; the Calendar link returns here (D19).
const ORIGIN = process.env.APP_ORIGIN?.trim() || "https://findmeatime.com";
const HOST_IMESSAGE = `## Messages from iMessage

A host message that starts with "[iMessage]" came from the host's linked
iMessage. Your reply to it is sent back to iMessage as plain text, where no
cards or buttons are shown.

- Keep replies short and ask one question at a time; echo what you understood
  before you record it.
- Never point to a card or button in a reply to an iMessage message. Name the
  exact command instead: review shows the current proposal or settings with the
  exact approve, decline or confirm command to send, and changes shows suggested
  changes with the exact share command.
- A text reply such as "yes", "approve it" or "save it" decides nothing, in
  iMessage as on the web. Only the exact command with its reference, or the
  button on the web, does.
- Sign-in, Google consent and protected fields happen in the browser. To
  connect Google Calendar, send ${calendarConnectUrl(ORIGIN)}, which brings
  the host back to this conversation; for the rest, send ${ORIGIN}/app.
- A plain reply to a setup question, such as the welcome's "How long should a
  typical meeting be?", is a setup answer; the host need not send setup first.`;

export default defineDynamic({
  events: {
    "session.started": (_event, ctx) =>
      isHostSetupSession(ctx.session.auth.current) || isHostReviewSession(ctx.session.auth.current)
        ? defineInstructions({ content: HOST_IMESSAGE })
        : null,
  },
});
