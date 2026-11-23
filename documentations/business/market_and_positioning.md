# Find Me a Time — Market and Positioning

Status: **Draft for team review** (#171)\
Date: 2026-11-23\
Companions: [Competitive landscape](competitor_research.md), [one-pager](../01_one_pager.md)

This page gives the presentation's opening argument in order: the market we can earn from now, who serves it today, what they leave unsolved, and where Find Me a Time stands. Every figure names its source and date; each source was opened on 2026-11-23. Vendor and research-firm figures are their claims, and market-size estimates from different firms disagree. Statements marked **(team judgement)** are ours and need the team's review before the presentation uses them.

## 1. Scope

Find Me a Time schedules **one-to-one external meetings**: one host, who owns the calendar and the final decision, and one guest from outside the host's organization, such as a founder pitching an investor or a student asking a professor. Many-to-many scheduling is an undecided follow-up and stays outside the current release, as in the [PRD's scope](../02_product_requirements.md#outside-the-initial-release).

Why one-to-one external meetings first **(team judgement)**: inside an organization, people usually fit the senior person's calendar, while a meeting between organizations has to reconcile two sides' constraints that neither side can see. It is the smallest case of that reconciliation, and the starting point for understanding many-to-many scheduling later.

## 2. The market we can earn from now

| What | Figure | Source |
|---|---|---|
| Global appointment-scheduling software market | USD 546.1 million in 2025, projected USD 635.6 million in 2026 and USD 1,905.9 million by 2034 (14.7 % CAGR, 2026–2034) | [Fortune Business Insights, report FBI108614](https://www.fortunebusinessinsights.com/appointment-scheduling-software-market-108614), last updated 2026-11-02 |
| The same market, a second estimate | Grows by USD 282.4 million from 2025 to 2030 at a 9.4 % CAGR (a growth figure, not a total size) | [Technavio](https://www.technavio.com/report/appointment-scheduling-software-market-industry-analysis), published October 2026 |
| Time professionals spend scheduling | 89 % of about 1,200 US and UK professionals surveyed (1,241 in the methodology) said they spend up to 4 hours a week scheduling meetings | [Calendly, The State of Scheduling 2023](https://calendly.com/resources/guides/state-of-scheduling-report), fielded 2023-08-25 to 2023-09-13 (a vendor survey) |
| Where the time goes | The back-and-forth is "the most substantial time killer while scheduling" (an ETH Zurich bachelor's thesis with 96 participants, on group meetings) | [Doodle](https://doodle.com/en/resources/blog/study-reveals-time-spent-with-scheduling/), published 2021-11-22, updated 2026-09-28 (a vendor's summary) |

What these numbers do and do not say **(team judgement)**: they size scheduling software in general, most of it booking pages for appointments and sales calls. They do not size our segment, hosts such as investors, founders and professors who take many external one-to-one meetings across places. We have no sourced figure for that segment. Before the presentation, the team should either estimate it bottom-up (for example, the number of such hosts we can reach in Korea times a price) and label it as our estimate, or present the market above only as the category we sit in.

The revenue a single product earns shows the category is real. Calendly says more than 50 million people use it in more than 240 countries and that over 1.3 billion meetings have been booked with it ([Calendly, About](https://calendly.com/about), no date shown; another passage on the same page says "over 20 million users"). Calendly is private and does not publish revenue: Sacra **estimates** USD 270 million in annual recurring revenue at the end of 2023 ([Sacra, Calendly](https://sacra.com/c/calendly), no date shown). This sourced estimate replaces the Calendly revenue figure quoted from memory in the 2026-10-21 session; it is an analyst's estimate, not a reported number.

## 3. Who serves it today

| Kind of product | Main players | What they do well |
|---|---|---|
| Booking links | Calendly, Cal.com, SavvyCal | A guest picks an open slot without an account. Cal.com, open source, has raised a confirmed USD 32.4 million and Sacra estimates USD 11 million in annual recurring revenue in November 2026 ([Sacra, Cal.com](https://sacra.com/c/cal), no date shown; [VentureBeat](https://venturebeat.com/2022/04/18/open-source-calendly-rival-cal-com-raises-25m/), 2022-04-18, on its USD 25 million Series A) |
| Email scheduling assistants | Howie, Skej, CalendarBridge, Calendly Callie, SkipUp, Clara | An assistant copied into an email thread proposes times, follows up and books once the participants agree |
| Agent-mediated scheduling | Openavail | A requester's agent asks through an API or MCP; the owner reviews proposals |

Feature-level detail, prices and sources for each product are in the [competitive landscape](competitor_research.md). On 2026-11-23 Openavail and SkipUp were both live with sign-up and pricing pages ([details](competitor_research.md#operating-status-checked-2026-11-23)).

## 4. What they leave unsolved

A booking link sees free and busy time, not the meeting's **context**: where it takes place, how long the trip takes, and the host's meetings before and after. Calendly and Cal.com set buffers as fixed minutes per event type or booking link and name travel only as one use for them ([Calendly](https://calendly.com/help/how-to-use-buffers), [Cal.com](https://cal.com/help/event-types/event-buffer)). So a link offers 16:30 in Hongdae right after a 16:00 meeting in Yeoksam, and the two sides renegotiate after booking ([problem scenario](../user_experience/01_user_journeys.md#problem-scenario-travel-between-meetings)). Email assistants add conversation, but the reviewed sources do not establish that they reject a time for the trip it needs, or that the host approves the exact final proposal before it is booked ([comparison by scenario](competitor_research.md#6-comparison-by-user-scenario)).

The renegotiation after booking comes from observing how booking-link users behave, not yet from interviews; the interviews and usability tests of #172 should confirm or correct it.

## 5. Where Find Me a Time stands

**(team judgement)** Find Me a Time is context-aware scheduling for one-to-one external meetings: it checks the place, the trip and the meetings around it before offering a time, negotiates with the guest wherever the guest is (booking link, email, messenger or their own agent, with no account), and books only when the host approves the current proposal in their messenger or on the web. Its claim is not a calendar agent that feels human; it is that the times it offers are workable for both sides, so the renegotiation after booking does not happen.

What still has to be shown: that hosts and guests value this over a booking link (#172), and the success criteria for each stage (#168).

## 6. Later expansion (appendix)

Kept apart from the market above, and to be presented at the end:

- Many-to-many scheduling, which reconciles more than two sides' constraints; an undecided follow-up.
- A layer through which different people's personal agents negotiate meetings with each other. The MCP and skill-document entry points of the current release are the first step, but no market figure is claimed for it.
