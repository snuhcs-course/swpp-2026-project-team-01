# Design

## Context

Everything a guest holds is bound to one request: the booking link (`booking_links.request_id`), the request-bound Google grants (`requester_grants.request_id`, "Request-bound Google consent flow"), the guest's messenger binding (`requester_imessage_bindings.request_id`) and the guest thread. A request has one requester (`requests.requester_name`, `contact_email`). Bookings belong to a request's approved proposal and create an event with the requester as the only attendee (`calendar-booking`).

The host chat already starts things for the host in words: changing intake (`lib/server/host-intake-tools.ts`), and requesting another host ("Request another host from the host's messenger"). Host notices go through `enqueueHostNotice` (`lib/server/imessage-notices.ts`).

## 1. A participant is a request

A new `group_meetings` row holds the host, the meeting terms (purpose, length, date range, timezone), with mode and place left open, the number of people, the shared link and a state: `collecting`, `closed`, `booking`, `booked`, `cancelled`.

Each person who opens the shared link gets their own request with `group_meeting_id` set, and with the group's terms copied into `details`. The request then reuses its booking link, requester grants, guest thread and messenger binding without change. The group's terms are fixed: the guest tools refuse changes to purpose, length and windows on a group request.

Rejected: participants in a table of their own, which would duplicate the grant, link, binding and thread machinery for a second kind of guest.

## 2. The shared link

The shared link is a sealed token like the booking link (`lib/server/booking-links.ts`), stored by hash on `group_meetings`. Opening it creates a draft request in the group, as a ready host's public page does today, and moves the browser to that request's booking link, so a returning participant continues their own thread. A link that is full or closed shows that it is closed and creates nothing. The link has no expiry of its own (D14): it stays open until it is full or the host closes it. While the group is open, its participant requests are exempt from the request expiry sweep and their booking links from the 30-day expiry; both apply again from the close.

Participant requests are left out of every host projection, list, count and notice, as drafts are; the group is the host's only view of them (D18). A host chat tool reports the group's progress: the done count against the number and the done participants' names.

The number of people counts participants who reached **done**, not drafts, so someone who opens the link and leaves does not take a place. While the link is open, more people may be in progress than places remain; the first ones to finish fill them, and the others are told the meeting is full.

## 3. The participant's steps

1. **Google.** Identity and Calendar on one consent screen. A group request has no **Skip for now** and no manual availability; it waits on this step until a Calendar grant exists.
2. **One question.** Thyme asks, in one message, about preferred hours, where they usually are, how they usually travel, and commitments the calendar does not show. Stated commitments are stored as unavailable intervals; preferred hours are stored as soft preferences that order times without excluding them; the usual place and travel mode are stored for the travel check.
3. **Review.** Thyme shows the times they cannot meet within the group's date range: their calendar busy times and what they said. The guest confirms or corrects them. Confirming is the participant's agreement.
4. **Messenger.** The existing link card, with a skip.
5. **Done.** The request records that it is done, and the guest is told they will get an invitation by email. A done participant cannot change their answers (D13).

## 4. Confirmed unavailable times

What the participant confirms in step 3 is what the host gets (D11). Confirming stores each listed interval on the participant request with its start, end, whether it lasts all day and, for a calendar event, its place (D17), together with the stated commitments, preferred hours, usual place and travel mode. A place may be kept at neighborhood level. This is a written exception to "Private read-only Calendar access" in `requester-calendar-access`; event titles, attendees and descriptions are not stored, and no participant's places or events are shown to the host or other participants. The participant's calendar is not read again at the close or at booking.

## 5. Closing and the common-time search

The group closes when the set number of participants are done, or when the host closes it in words. A close with no participant done does nothing and tells the host.

The search uses the feasibility rules of `lib/server/feasibility.ts` over the group's date range, for the host and every done participant, with each participant's confirmed intervals as their busy times.

- **In person.** Each option is a pair of a time and a place, as in "Time and place pairs", with every person's travel legs checked from and to their adjacent events, or their usual place when an event has no place. Place candidates come in order (D16): the host's venue and areas, then the participants' usual places, then points between the participants' places, found by geocoding their places and naming a station or neighborhood near the middle with a place lookup. A later tier is searched only when the earlier tiers give fewer than three options.
- **Online.** A time that fits everyone with no travel is an online option. Online options are offered when in-person options are fewer than three.

Soft preferences order the options, and the spreading rule ("Offered times spread across the range") picks up to three. When no option fits everyone, the options are ranked by how many participants fit, and each comes with the names of those who do not.

## 6. The host's choice and booking

The host names an option from the notice, a time with a place or online, or asks for more. The host may name an option that not everyone can make when it is the best there is (D12); contacting those people is the host's own choice. Booking reads the host's conflict calendars again for that time; a time that no longer fits the host books nothing and the host is told. A time that fits becomes one booking of the group: one event in the host's booking destination at the chosen place, or with a Google Meet link when online, with each participant's confirmed email as an attendee and Google's invitations sent. Each participant request then closes as booked, which ends its grant and binding as today.

## Open questions

None. D11–D18 settled the questions of the earlier drafts.
