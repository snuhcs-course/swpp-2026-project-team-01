# Find Me a Time Competitive Landscape

Research date: 2026-09-29  
Openavail update: 2026-10-05  
Howie update: 2026-10-08
Scope: External meeting coordination, email scheduling assistants, booking platforms, and conversational calendar agents.

This is a public-documentation review, not hands-on testing. Product descriptions are vendor claims; assessments of relevance and differentiation are our analysis. An accessible website does not establish successful onboarding, reliability, adoption, or retention. "Not verified" means the reviewed sources did not establish a capability, not that the product lacks it.

Find Me a Time's comparison baseline is its planned experience in [the one pager](../0_one_pager.md): external one-to-one requests through chat, email, or agents; host-specific preferences and travel constraints; and authenticated approval of the current proposal before booking. Find Me a Time's named agent integrations remain compatibility targets.

## 1. Findings

The competitive set extends well beyond Calendly Callie. Email coordination, natural-language scheduling rules, human review, and external agent integrations are already available in overlapping products.

CalendarBridge is an especially important benchmark because it combines email coordination, persistent plain-English rules, multiple calendars, and an MCP interface that can drive its email assistant. Reclaim overlaps with priority-aware availability, travel buffers, and review of AI-generated calendar changes. Cal.com and SavvyCal demonstrate that booking approval also exists without an AI email negotiator.

Skej is another close product benchmark: it combines email coordination with conversational booking links and targets founders and investors. SkipUp explicitly stores reusable scheduling preferences in memory. Lindy's current assistant positioning includes human approval, although its configurable workflow actions require separate examination.

Openavail is a particularly close benchmark for agent-mediated scheduling with owner control. Its review-first proposals, public requester links, scoped MCP/API agents, meeting-class policy, and audit trail overlap directly with Find Me a Time's planned agent and approval model. Its public documentation does not establish CC-email negotiation or location-dependent travel feasibility. [Product](https://www.openavail.com/), [Public scheduling](https://www.openavail.com/docs/public-scheduling/), [Rules](https://www.openavail.com/docs/rules-reference/)

These findings weaken feature-level uniqueness claims. A more useful Find Me a Time hypothesis is that a focused external-meeting workflow can apply relationship-specific preferences and hard feasibility constraints consistently across channels while preserving host control. This combination still needs comparative testing.

## 2. Direct email scheduling competitors

### Additional dedicated and general assistants

| Product | Scheduling flow and personalization | Approval evidence and commercial scope |
|---|---|---|
| **Skej** | CC-email coordination, conversational booking links, and messaging surfaces. Google/Outlook; reusable preferred hours, buffers, and limits. [Product explanation](https://skej.com/blog/what-is-skej-the-ai-scheduling-assistant-that-works-in-your-email), [Limits](https://skej.com/help/scheduling-preferences/buffers-and-meeting-limits) | Describes automatic confirmation; separate final host approval was not established. Founder/investor overlap is explicit. Pro is $19/user/month or $15/month billed annually; the free plan excludes email-assistant usage. [Plans](https://skej.com/help/subscriptions-and-billing/subscription-plan-options), [Founders](https://skej.com/founders) |
| **Lindy** | Adds an agent to email threads to share availability and schedule; broader email, calendar, and business automation. [Meetings](https://www.lindy.ai/solutions/meetings) | Current pricing positions outside-impact actions as requiring approval; Academy workflow actions have a configurable Ask for Confirmation setting. These surfaces must be tested separately. Plus is $29.99/user/month with 3,000 credits. [Pricing](https://www.lindy.ai/pricing), [Action configuration](https://www.lindy.ai/academy-lessons/action-configuration) |
| **Clara** | CC scheduling, follow-ups and rescheduling; Google Workspace, Outlook and Exchange. Published preferences include windows, buffers, meeting types, and priority contacts. [Product](https://www.claralabs.com/), [Pricing](https://www.claralabs.com/pricing/) | Markets automatic coordination; mandatory host approval was not established. Standard is $80/month for 30 meetings, with a 14-day/5-meeting trial. Current claims differ from older descriptions of human-reviewed service; successful signup and booking were not tested. |
| **SkipUp** | CC scheduling using Google/Microsoft and multiple calendars. Onboarding saves natural-language preferences to Memory for future requests. [Getting started](https://support.skipup.ai/getting-started/) | Books after participant confirmation; a separate final host checkpoint was not established. First ten meetings per person are free; the homepage's selected 30-meeting Pro option is $49/month. [Confirmation flow](https://support.skipup.ai/tutorials/schedule-your-first-meeting/), [Pricing](https://skipup.ai/) |
| **Mia / LoopMia** | CC-only email context, selected Google calendars, editable rules and buffers; privately asks the host when meeting mode/location is ambiguous. [Product](https://www.loopmia.com/) | Creates an invite after confirmation; mandatory approval for every proposal was not established. Publishes $199/month and a seven-day trial. Relevant to client, partner and vendor coordination. |
| **Ari / JustCC** | CC-email coordination with Google/Microsoft, time holds, rescheduling, and cancellation. [Product](https://justcc.to/) | Describes booking after mutual agreement; a separate host gate was not established. Ten meetings free in total; Basic $24/month, Premium $39/month. Current public offering, with adoption and reliability unverified. |

Prices are published USD figures checked on the research date. Plans differ in meeting quotas, credits, seats, and billing period; these figures are not like-for-like estimates of cost per successful booking.

### Howie

Howie is an additional direct scheduling competitor. See the [dedicated Howie research](howie_research.md) for the dated feature inventory, official sources, pricing boundaries, approval questions, and comparative test cases. Include it in the practical benchmark below; its public descriptions have not been validated through a live trial.

### CalendarBridge AI Scheduling Assistant

Users CC or forward an email to an assistant that proposes times and books after participants agree. Configuration supports Google, Microsoft, and Apple calendars, additional availability-only calendars, and a persistent plain-English rules field of up to 1,000 characters. Rules include working hours, preferred windows, duration, and buffers; ambiguous requests can require human input. A separate final host approval for every booking was not established. [Assistant guide](https://help.calendarbridge.com/help/ai-assistant.html)

Its MCP interface can manage events, scheduling pages, syncs, and assistant conversations. Connected agents can start a scheduling email or reply through the email assistant, subject to granted permissions. This directly overlaps with Find Me a Time's host-agent surface. [MCP guide](https://help.calendarbridge.com/user-docs/bring-your-own-agent-mcp/)

The billing guide places AI Assistant access on Premium and Pro: Premium costs $10/month or $8/month billed annually. The public pricing cards also list the assistant under Basic, creating an entitlement discrepancy; use the billing guide as the more explicit comparison and verify at signup. [Billing](https://help.calendarbridge.com/help/billing.html), [Pricing](https://calendarbridge.com/pricing-individual/)

### Sarra

CC-email coordination checks connected Google or Microsoft calendars, proposes times, follows up, and sends an invitation after agreement. Guests continue replying by email without a separate account. [Product](https://sarra.ai/)

The vendor documents persistent working-hour/buffer settings, clarification for uncertain requests, and host approval for requests outside working hours. These are exception checkpoints, not evidence of mandatory approval for every booking. Its security and accuracy statements were not independently tested. [Trust and controls](https://sarra.ai/trust)

Supporting two providers does not necessarily mean combining their availability: its Outlook guide says Google takes precedence when both are connected, with Outlook used as fallback, and only owned Outlook calendars are queried. [Outlook limitations](https://sarra.ai/help/microsoft-outlook-calendar)

### Calendly Callie: existing comparison baseline

Callie remains a direct email-coordination competitor. Its documented flow primarily serves one-on-one meetings, and Calendly separately provides MCP. A separate mandatory host checkpoint for every new booking was not established in this review. [Current scheduling guide](https://calendly.com/help/how-to-schedule-with-callie)

## 3. Booking and calendar competitors

| Product | Verified overlap | Important comparison boundary |
|---|---|---|
| **Openavail** | Owner-controlled booking proposals, public links, scoped agent access through REST/SDK/MCP, meeting-class priorities, holds, and audit history. [Product](https://www.openavail.com/), [Proposal API](https://www.openavail.com/docs/api/booking-proposals/) | Review-first is the default; owners can later permit trusted agents or selected public meeting types to book directly. Google Calendar is supported during private beta; Microsoft 365 is planned. Email-thread negotiation and location-aware travel calculation were not established. [Public scheduling](https://www.openavail.com/docs/public-scheduling/) |
| **Reclaim.ai 2.0** | Conversational calendar assistance, Google/Outlook, priority-aware Scheduling Links, and MCP. AI Assistant and MCP changes are staged in Preview Mode for review. [FAQ](https://help.reclaim.ai/en/articles/15280604-reclaim-2-0-faq) | Review of host-side AI changes does not establish approval of every external booking. Email CC negotiation was not verified. The FAQ notes that accounts still on 1.0 may need to request 2.0 access. |
| **Cal.com / Cal.ai** | Booking platform with optional Requires Confirmation and an official MCP interface. [Confirmation](https://cal.com/features/requires-confirmation), [MCP](https://cal.com/blog/how-to-connect-calcom-to-claude-using-mcp) | Approval and agent access already exist here. Current Cal.ai positioning is a phone agent for booking and follow-up, priced at $0.29/minute. [Cal.ai](https://cal.com/ai) |
| **SavvyCal** | External booking links with recipient calendar overlays, preferred availability, and optional booking approval. [Product](https://savvycal.com/), [Approval](https://docs.savvycal.com/article/81-require-approval-for-new-events) | With approval enabled, the slot is held in SavvyCal but no calendar event is created until the host approves. Conversational email negotiation was not verified. |
| **Motion** | Task/day optimization plus external Booking Links with conflict checks, working hours, buffers, and meeting limits. [Booking guide](https://www.usemotion.com/help/time-management/booking-links) | It is broader than scheduling alone, but should not be dismissed as only an internal time-blocking tool. Mandatory host approval and a first-party scheduling MCP were not verified. |
| **Akiflow / Aki** | Conversational task/event management and contact-availability actions; external Share Availability links. [Aki](https://product.akiflow.com/help/articles/5330825-what-can-aki-do), [Availability links](https://product.akiflow.com/articles/8587896-share-your-availability) | Host-side calendar assistance and external booking are established; CC-email negotiation and final approval on every booking were not. |

Openavail's agent proposal API creates a durable request with candidate times for owner review; proposals expire after at most 24 hours or at the end of the requested window. Its separate search → hold → confirm flow reserves capacity before calendar write and supports idempotency keys for retries. Working hours, recurring blocks, and daily meeting-hour caps are hard constraints; minimum inter-meeting buffer and back-to-back limits only lower a candidate's rank. Thus, a buffer preference must not be interpreted as guaranteed travel feasibility. Its published monthly plans are Free (one calendar, one agent, 50 bookings), Pro ($20; five calendars and five agents), and Team ($70; up to ten owners). These are vendor-documented capabilities and prices, not a completed beta trial. [Proposal API](https://www.openavail.com/docs/api/booking-proposals/), [Two-phase commit](https://www.openavail.com/docs/two-phase-commit/), [Rules](https://www.openavail.com/docs/rules-reference/), [Pricing](https://www.openavail.com/pricing/)

Reclaim's Scheduling Link configuration also documents travel and decompression buffers for physical meetings. Generic "travel-aware" positioning therefore needs a more specific test, such as applying different host-defined travel buffers between locations during external negotiation. [Link configuration](https://help.reclaim.ai/en/articles/6666663-creating-and-customizing-scheduling-links)

## 4. Broader assistants and specialized substitutes

| Product | Documented behavior | Relevance to Find Me a Time |
|---|---|---|
| **Fyxer** | Drafts email replies containing scheduling links; recipients book directly and invitations are automated. Supports Google/Outlook, buffers, and team links. [Scheduling](https://www.fyxer.com/ai-scheduling-assistant) | Competes for the executive's inbox and administrative budget. Drafting a link-bearing reply differs from delegating an ongoing email negotiation. Its FAQ says it does not send ordinary email replies on the user's behalf. [FAQ](https://www.fyxer.com/pricing) |
| **Google Labs CC** | The September 17, 2026 update positions CC for families/groups of up to six, with shared context, memory, Calendar/Tasks, email/Chat, and Google Maps drive-time checks. US personal-account experiment with waitlist access. [Current announcement](https://blog.google/innovation-and-ai/models-and-research/google-labs/cc-expanding-to-groups/) | Adjacent rather than a confirmed external professional meeting negotiator. Memory and location-aware assistance are nevertheless already part of broader agent products. |
| **Chosen** | Recruiting platform whose AI scheduling replies can wait in an approval queue. Approve sends the reply and executes its associated reschedule/cancel action; edit and reject are supported. [Approval queue](https://help.chosenhq.com/guides/scheduling/ai-events-tab) | A useful human-review benchmark in a narrower recruiting market. Message approval is not automatically equivalent to approving the exact final meeting proposal. |

## 5. Historical products and unresolved availability

- **Clockwise:** The official notice states the product and Scheduling Links became unavailable on March 27, 2026, as the team joined Salesforce. Treat it as a historical design reference, not an active purchase alternative. [Shutdown notice](https://getclockwise.com/)
- **Perplexity Email Assistant:** Official 2025 materials describe CC-email scheduling, timezone handling, in-person meetings, and rescheduling. A May 2026 user discussion reports deprecation; a current official availability or shutdown statement was not obtained. Exclude it from the confirmed-current shortlist and verify account access before benchmarking. [Original announcement](https://www.perplexity.ai/changelog/what-we-shipped-september-26th), [Unverified user report](https://www.reddit.com/r/perplexity_ai/comments/1te4lt9/quitting_perplexity_max_over_silent_email/)
- **Dola:** Indexed official material describes chat-based calendar creation/editing, multimodal input, and calendar sync. Direct retrieval failed, and current operation and external meeting negotiation were not established. [Official features](https://heydola.com/features)
- **Older Cal.ai email assistant:** An email-assistant listing remains public, while current Cal.ai marketing emphasizes voice. Do not assume the older email product is currently available. [Older listing](https://cal.com/apps/cal-ai), [Current product](https://cal.com/ai)

## 6. Implications and practical benchmark

The following are Find Me a Time product hypotheses, not evidence that competitors cannot perform them:

| Find Me a Time direction | Existing overlap | What a comparative test should establish |
|---|---|---|
| CC an assistant into an email | Callie, Skej, CalendarBridge, Sarra, Clara, SkipUp, Mia, Ari, and Lindy | Faster completion with fewer host interventions and a natural guest experience |
| Persistent natural-language preferences | CalendarBridge rules and SkipUp memory | Relationship-specific preferences remain consistent, editable, and private across requests |
| Human approval | Openavail review-first proposals; Lindy, Reclaim Preview Mode, Cal.com/SavvyCal booking approval, Chosen reply approval | Approval applies to the current meeting details and is renewed after a material change |
| Agent integration | Openavail, CalendarBridge, Reclaim, Cal.com and Calendly have MCP | Requester and host agents have distinct permissions and share a reliable request lifecycle |
| Location and travel | Reclaim buffers; Google CC drive-time checks; Openavail's buffer is a soft ranking preference | Hard feasibility constraints survive negotiation and changes of location |
| Korean coordination | Requires product-specific language testing | Korean/English mixed threads, timezones, and ambiguous date expressions work for target customers |

Prioritize trials of **Skej, CalendarBridge, Lindy, SkipUp, Reclaim 2.0, and Openavail** alongside Callie. These are research priorities based on feature overlap, not purchasing recommendations; Openavail currently labels itself private beta. Run the same scenarios:

1. A founder requests 30 minutes next week without specifying timezone or location.
2. A host prefers investor meetings in the afternoon but student meetings in office hours.
3. A calendar slot is free but cannot accommodate the required travel buffer.
4. A guest asks for a time outside normal hours; the host approves only this exception.
5. The guest changes duration or location after the host has approved a proposal.
6. A delayed reply and a duplicate agent retry arrive after a different proposal was selected.
7. The host updates a preference privately; the shared thread must not disclose it.
8. An external requester and a trusted agent ask for the same slot; verify each party's visibility, booking authority, approval path, and retry behavior.

Measure time to booking, host interventions, incorrect proposals, unauthorized or duplicate bookings, and guest completion. Also test whether mandatory approval saves decision effort or adds avoidable friction. Feature descriptions and vendor-selected testimonials cannot establish these outcomes.
