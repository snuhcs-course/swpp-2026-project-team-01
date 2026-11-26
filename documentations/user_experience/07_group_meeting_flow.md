# Group Meeting Flow

Status: specified in [`group-scheduling`](../../openspec/changes/group-scheduling/proposal.md) (#486), not yet merged\
Date: 2026-11-26\
Basis: [GM01 and GM02](02_user_stories.md#group-meetings), [group-scheduling contract](../../openspec/changes/group-scheduling/specs/group-scheduling/spec.md)\
Companions: [Guest booking flow](06_guest_booking_flow.md), [Host onboarding flow](05_host_onboarding_flow.md)

This page follows one group meeting from the host's message to the booked event. The group's behavior is owned by the change's specification; this page explains how the steps fit together.

## Steps

```mermaid
sequenceDiagram
    participant H as Host (linked messenger)
    participant T as Thyme
    participant P as Participant (web)
    H->>T: "Set up a one-hour kickoff with four people next week"
    T->>H: One shared link (/g/{token})
    P->>T: Opens the link, continues with Google and Calendar
    T->>P: One question: fixed commitments the calendar lacks, usual place, travel
    P->>T: Answers in words
    T->>P: The times they can't meet, to confirm or correct
    P->>T: These are right (then an optional messenger link)
    Note over T: When the set number are done, or the host closes early
    T->>H: Up to three options, or the ones that fit the most people
    H->>T: "Book the second one"
    T->>H: Booked; Google emails every participant the invitation
```

## What each side sees

| Moment | Host | Participant |
|---|---|---|
| Collecting | Nothing unless they ask; then how many are done and who | Their own steps only |
| Closed | One message with the options; more on request | That their answers were sent; a person still answering is told the meeting is full |
| Booked | The booked option | Google's invitation by email |

A participant who is already a host of the service can send the link in their own linked messenger instead of opening it. Nothing their settings answer is asked: Thyme sends a picture of their open times in the group's dates (their meeting hours minus their conflict calendars) and asks "…님과의 그룹 미팅이군요. 원래 정해두신 대로 이렇게 전달하면 될까요? 캘린더에 없는 고정 일정이 있으면 알려 주세요."; a fixed commitment named in reply sends a new picture, and a yes makes them done.

The host never sees a participant's events or places. A participant's confirmed times are stored with the places of their events, at neighborhood level or finer, and used as confirmed: their calendar is not read again at the close or at booking. Only the host's calendars are rechecked before booking.

## Options

Options come from the [feasibility rules](../../openspec/specs/meeting-feasibility/spec.md) run for the host and each participant, with everyone's travel legs from and to their adjacent events. In person, places are tried in order: the host's venue and areas, then the participants' usual places, then a station between them (Google Geocoding and Places, #487), a later tier only while fewer than three options fit everyone. Online options join when the in-person ones are still fewer than three. Options are ordered by any hours participants volunteered as suiting them and spread across the range, one place per time.
