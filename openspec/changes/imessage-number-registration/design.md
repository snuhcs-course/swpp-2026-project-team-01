# Design

## Context

Photon's shared lines (Free and Pro) deliver only messages from registered project users and refuse sends to anyone else ([proposal](proposal.md#why)). The 2026-10-20 spike's `Target not allowed for this project` and the 2026-11-04 reply to an unregistered sender are the same rule. Registering a user needs the phone number ([Create user](https://photon.codes/docs/api-reference/users/create-user.md): `phoneNumber` is required), and Photon emits no event for a refused sender ([Events](https://photon.codes/docs/webhooks/events): `messages` is the only event), so the number cannot be learned from the first message.

## 1. Registration

`photonRegistrar` sends `POST https://spectrum.photon.codes/projects/{projectId}/users/` with `{ "type": "shared", "phoneNumber": "<E.164>" }` and `Authorization: Basic base64(projectId:projectSecret)`. Photon returns the same user for a number already registered, so a repeat is harmless. Outside production, `PHOTON_API_URL`'s stand-in answers `POST {apiUrl}/users` the same way. The registrar goes through the messaging gate like every send, so a preview or a non-loopback local run is refused before any network access.

`imessage.link.create` (iMessage), `request.imessage_link.create` and the landing's `POST /api/imessage/start` take a `number`. After the attempt limits pass, `registeredLineNumber` normalizes it to E.164 (otherwise `invalid_input`) and registers it. A refusal, a lost answer or an answer without an E.164 `assignedPhoneNumber` is `unavailable_configuration`, and no attempt is made. WhatsApp attempts take no number.

The entered number is not stored. Photon holds it as the project user.

## 2. The assigned number

The attempt stores `assignedPhoneNumber` in `imessage_links.line_number` (E.164, checked). Every status that shows a pending code (host card and link step, landing start, guest card) addresses the message to that number, falling back to `PHOTON_LINE_NUMBER` for attempts made before this change. A reload shows the same number. The production project's one registered user was assigned the number production advertises, but whether a second user gets the same number was not verified, which is why the attempt keeps its own.

## 3. Screens

The number field (`NumberForm`) is the landing redesign's phone field: a country-code select (KR +82 first), a national number formatted while typing, client validation of mobile numbers, then E.164 to the server. A refused number shows under the field; a limit shows as the screen's notice; any other failure says the number could not be registered.

- `/app` link step: an iMessage code first shows "Which number do you use for iMessage?" with **Next**, **Use WhatsApp instead** where WhatsApp is offered, and **Set up here in web chat**. The number is kept for the visit, so **Write a new message** needs no new entry.
- Connect iMessage card: the iMessage state shows the field with **Connect iMessage**.
- Landing `/?flow=imessage`: **Onboard with iMessage** opens the number screen, then the send popup or Messages.
- Guest card: **Get updates in iMessage** opens the field inside the waiting card, with **Cancel**.

## Risks

- The Free plan's 10 users run out quickly. A full project refuses new numbers, and the screens show the generic registration failure.
- The pool's number per user, and whether an Apple ID email sender still matches a registered phone user, are unverified on a real device.
