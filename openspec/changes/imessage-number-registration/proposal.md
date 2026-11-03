# Proposal

Tracking issue: #94

## Why

On 2026-11-04 a message sent from an iPhone to the production iMessage number never reached `/photon/webhook`. Photon answered it instead: "This number didn't recognize yours, so the message couldn't be delivered to a project ... add your number under Project → Users". The production project (`findmeatime`) is on Photon's Free plan, and the Free and Pro plans use shared lines. Photon's documentation says a shared line "will only message recipients you've registered as users of your project" ([iMessage troubleshooting](https://photon.codes/docs/spectrum-ts/troubleshooting/imessage)) and "Only messages from the assigned sender reach this shared-line connection" ([Beta: Build an iMessage agent](https://photon.codes/docs/beta/get-started/imessage)). The project had one registered user, so the inbound-first link of [`host-imessage-channel`](../host-imessage-channel/proposal.md) D4, D15 and D16 and [`guest-flow-completion`](../guest-flow-completion/proposal.md) D1 could not work for anyone else. Issue #94 records the investigation.

## What Changes

- **Number first.** Every iMessage link start asks for the person's mobile number before the link code: the `/app` link step and the Connect iMessage card for hosts, the landing's `/?flow=imessage` start, and **Get updates in iMessage** for guests. The rest of the flow is unchanged: the person sends the prefilled message, the browser shows the masked sender, and **Confirm and link** binds it.
- **Registration.** Creating an iMessage link attempt registers the entered number as a shared user of the Photon project (`POST /projects/{projectId}/users/`, idempotent on the number) and keeps the shared-pool number Photon assigned. The screens address the message to that number.
- **WhatsApp unchanged.** WhatsApp Business uses its own number and asks for no number.

## Decisions

Taken by the user on 2026-11-04 in the session that wrote this change.

| # | Decision | Choice |
|---|---|---|
| D1 | Where the number is asked ([design 1](design.md#1-registration)) | Before every iMessage link code: the host's `/app` link step and Connect iMessage card, the landing's iMessage start and the guest's **Get updates in iMessage**. The existing message-and-confirm flow follows. Rejected: a Business-plan dedicated line (cost), and keeping iMessage to manually registered testers |
| D2 | Which number the message goes to ([design 2](design.md#2-the-assigned-number)) | The `assignedPhoneNumber` Photon returns for the registered user, stored on the attempt as `imessage_links.line_number`. `PHOTON_LINE_NUMBER` only says whether iMessage is configured. Rejected: always showing `PHOTON_LINE_NUMBER`, because a shared pool may assign a different number per user (not verified) |
| D3 | The number field ([design 3](design.md#3-screens)) | The landing redesign's phone field (`feat/web-language-switch` d3ca3be8): country code apart, hyphens added while typing, sent as E.164. The ink screens use its ink look; the conversation cards use PR #23's card look (fd429eeb) |

## Capabilities

### New Capabilities

- `imessage-number-registration`: registering the entered number before an iMessage link code, and addressing the code to the number Photon assigned.

## Impact

- `lib/server/photon.ts` (`photonRegistrar`), `lib/server/imessage-links.ts`, `lib/server/imessage-start.ts`, `lib/server/requester-imessage-links.ts`, `lib/server/imessage-routes.ts`.
- `app.imessage_links.line_number` and its migration.
- The ink link step, the landing start, the Connect iMessage card and the guest card; `apps/web/app/_components/ink/number-form.tsx` and `phone.ts`.
- The Photon stand-in answers `POST /users`.
- The Free plan allows 10 registered users and Pro 100 ([pricing](https://photon.codes/pricing)). A full project refuses new numbers, and the screens say the number could not be registered.
