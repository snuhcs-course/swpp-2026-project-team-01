# Find Me a Time Competitive Landscape

Research date: 2026-09-29  
Openavail update: 2026-10-05  
Howie update: 2026-10-08

Comparison matrix update: 2026-10-19
Scenario comparison and operating status: 2026-11-23

Scope: External meeting coordination, email scheduling assistants, booking platforms, and conversational calendar agents.

This is a public-documentation review, not hands-on testing. Product descriptions are vendor claims; assessments of relevance and differentiation are our analysis. An accessible website does not establish successful onboarding, reliability, adoption, or retention. "Not verified" means the reviewed sources did not establish a capability, not that the product lacks it.

Find Me a Time's comparison baseline is its planned experience in [the one pager](../01_one_pager.md): external one-to-one requests through chat, email, or agents; host-specific preferences and travel constraints; and authenticated approval of the current proposal before booking. Find Me a Time's named agent integrations remain compatibility targets.

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

조사일: 2026-10-08 (KST)
대상: [howie.ai](https://howie.ai/), 연결된 [howie.com](https://howie.com/) 및 공식 지원 문서

공개 자료 조사이며 가입·결제·실제 예약은 테스트하지 않았다. 아래 기능은 공급사의 설명이고, 비교와 시사점은 우리 팀의 분석이다. **미확인은 기능 부재를 뜻하지 않는다.** 홈페이지 직접 조회가 비어 있어 검색에 노출된 공식 본문과 연결된 howie.com 본문을 함께 확인했다.

#### 1. 확인한 기능

| 영역 | 공식 설명 | 근거와 한계 |
|---|---|---|
| 일정 조율 | 이메일 CC로 문맥 파악 → 가용시간 제안 → 답장 처리 → 초대 발송. 그룹 조율, 예약 링크, 무응답 후속 연락 | [홈페이지](https://howie.com/#features). 실제 성공률 미측정 |
| 대화 채널 | 이메일, iMessage, SMS | [홈페이지](https://howie.com/). 국가별 사용 조건 미확인 |
| 일정 보호 | 집중시간, 임시 홀드, 버퍼·통근·이동시간, 충돌·과밀 일정 감지, 일정 규칙 기억 | [홈페이지](https://howie.com/#features). 경로 계산과 강제 제약 여부 미확인 |
| 선호 적용 | 연속회의 제한과 후속 연락 횟수·간격을 적용하는 예시 | [홈페이지](https://howie.com/#features). 예시이지 실행 검증은 아님 |
| 변경·개인화 | 하루 일정 재조율; 비서 이름·회사 도메인 이메일·서명 설정 | [홈페이지](https://howie.com/#features) |
| 업무 보조 | 알림·할일·일일 브리핑·응답 대기 추적; Granola·Linear·Notion·Todoist 연동 표방 | [홈페이지](https://howie.com/#features). 도구별 권한·동작 미확인 |
| 로그인 | Google 로그인으로 시작 | [로그인](https://howie.ai/auth/signin). 온보딩 완료 여부 미검증 |
| 화상회의 | 설정에서 Zoom 연결 후 회의 생성·변경·취소와 링크 자동 추가. 연결 해제 시 이후 일정은 Google Meet으로 대체 | [Zoom 지원](https://howie.ai/support/zoom). 공식 절차까지 확인, 실제 실행 미검증 |

#### 2. 가격과 운영

공식 가격 영역에는 Team **월 $25**, 시작 시 **$25 무료 크레딧**, 워크스페이스 공유 크레딧과 팀원 수 무제한이 표시된다. 회사 도메인 비서 이메일은 **월 $20 추가**. Enterprise는 별도 견적이며 DPA·SLA·우선 지원·전용 온보딩을 설명한다. 크레딧 차감 단위, 포함 사용량, 초과 과금은 확인하지 못했으므로 무제한 예약 요금제로 해석하면 안 된다. [가격](https://howie.com/#pricing)

지원 문서는 매일 08:00–22:00 PST 운영과 24시간 내 첫 응답 목표를 안내한다. 이는 일반 지원 목표이며 Enterprise SLA와 동일하다고 볼 수 없다. [지원](https://howie.ai/support)

개인정보처리방침은 접근 권한을 받은 이메일·캘린더 데이터와 비가입자의 이메일 스레드 정보도 처리 대상으로 설명하며, 일정 조율 시 가용시간을 상대방에게 공유할 수 있다고 명시한다. 이것만으로 캘린더 상세나 비공개 선호의 비노출 보장까지 확인되지는 않는다. [개인정보처리방침](https://howie.com/privacy-policy/)

#### 3. Find Me a Time과의 비교

비교 기준은 이 문서의 Find Me a Time 제품 방향이다. 아래 내용은 요구사항 변경 제안이나 확정 사양이 아니다.

| 비교 질문 | 판단 및 다음 확인 |
|---|---|
| 직접 경쟁자인가? | 외부 미팅의 대화형 조율과 휴대폰 채널이 겹치므로 우선 비교 대상이다. 단순 예약 페이지만을 비교 기준으로 삼으면 범위를 과소평가한다. |
| 승인에서 차별화되는가? | 공개 예시는 참가자 합의 후 초대 발송을 보여준다. 매 예약의 별도 호스트 승인, 수정 후 재승인은 확인되지 않았다. 우리 제품의 승인 원칙과 실제 비교가 필요하다. |
| 이동시간이 차별점인가? | 이동시간 지원이라는 표현만으로 독점성을 주장하기 어렵다. 장소 변경 후에도 이동 제약을 강제로 지키는지 시험해야 한다. |
| 선호 기억이 차별점인가? | 기억 자체보다 관계별 규칙의 일관성, 수정 가능성, 비공개 유지가 비교 기준이다. |
| 범용 비서로 확장해야 하는가? | Howie의 넓은 기능을 그대로 따라갈 근거는 없다. 외부 일대일 미팅에서 호스트 판단 부담을 줄이는지 먼저 측정하자. |

#### 4. 실사용에서 확인할 항목

공개 자료로 확정하지 못한 항목: 한국어·한영 혼합 조율, 한국 SMS/iMessage 사용 조건, Outlook·Microsoft 365 지원, 공개 MCP/API, 상대방의 가입 필요 여부, 캘린더별 읽기·쓰기 권한, 중복 요청의 안전성, 승인 설정, 크레딧 소비량. 오래된 후기나 연동 로고만으로 지원 범위를 확정하지 않는다.

1. 한국어로 “다음 주 오후 30분”을 요청하고 서울·샌프란시스코 시간대와 날짜 해석을 확인한다.
2. 투자자·학생에게 서로 다른 선호를 적용하고 상대방에게 비공개 규칙이 노출되는지 확인한다.
3. 빈 슬롯이지만 이동시간이 부족한 대면 미팅을 요청하고, 조율 도중 장소를 바꾼다.
4. 참가자 합의만으로 초대가 나가는지, 호스트의 별도 승인을 설정할 수 있는지 확인한다.
5. 승인 후 시간·장소·길이를 바꾸고 재승인 여부를 확인한다.
6. 이메일 조율 중 iMessage로 지시를 수정한 뒤 지연 답장과 중복 요청을 보낸다.
7. Zoom 연결·변경·해제와 초대 링크 동기화를 확인한다.
8. 크레딧 소비량, 예약 완료시간, 호스트 개입 횟수, 잘못된 제안, 무승인·중복 예약을 기록한다.

가입과 유료 테스트 전에는 요금·권한·지역 조건을 다시 확인한다. 이번 조사는 공개 기능의 존재와 비교 질문을 정리한 단계이며, 품질·신뢰성 우위를 입증하지 않는다.

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

## 6. Comparison by user scenario

Draft for team review (#170), updated 2026-11-23. This replaces the earlier capability checklist marked O/X. Each scenario below is one moment in a formal external meeting, and each row says what the host and the guest go through with a group of products, why that does not fit, and what Find Me a Time produces. A formal external meeting has to feel right on both sides, so every scenario has a host column and a guest column.

How to read it. Competitor rows describe what the cited public documentation establishes, not hands-on tests; "not established" means the sources reviewed did not show it, not that the product lacks it. The Find Me a Time rows describe the behavior in the [user stories](../user_experience/02_user_stories.md) and the [testing baseline](../technical_specification/12_testing_baseline.md); where a row there is not yet built, the cell says so. The groups are:

- **Booking links:** Calendly, Cal.com, SavvyCal. The guest picks an open slot on the host's page.
- **Email assistants:** Howie, Skej, CalendarBridge, Calendly Callie, SkipUp. The host copies an AI assistant into an email thread, which proposes times and books once the participants agree.
- **Agent-mediated scheduling:** Openavail. A requester's agent asks through an API or MCP and the owner reviews proposals.

### S1. Travel between meetings (the [problem scenario](../user_experience/01_user_journeys.md#problem-scenario-travel-between-meetings))

The host's meeting in Yeoksam ends at 16:00; the guest asks for an in-person meeting in Hongdae.

| | Host | Guest | Why it does not fit |
|---|---|---|---|
| Booking links | Sets one buffer in minutes per event type, whatever the places ([Calendly](https://calendly.com/help/how-to-use-buffers), [Cal.com](https://cal.com/help/event-types/event-buffer)); finds the clash after the booking | Books 16:30 because it is listed; later gets a cancel or reschedule request | The buffer is fixed, not computed from where the meetings are; neither help page describes a trip calculation |
| Email assistants | Howie advertises buffer, commute and travel-time protection ([Howie](https://howie.com/#features)); whether a trip is enforced as a constraint is not established | Agrees in the thread to whatever the assistant proposes | A trip between two places blocking a slot is not established for any product in the group |
| Agent-mediated | Openavail ranks candidates lower for a short buffer but does not reject them ([rules](https://www.openavail.com/docs/rules-reference/)) | The guest's agent may still be offered the slot | A buffer preference is not travel feasibility |
| **Find Me a Time** | Told only once the guest has picked a workable time; approves in the messenger | Offered 16:30 online, or in person from a time the trip allows | The trip from the previous meeting's place and on to the next is checked before a time is offered ([PRD FR-12](../02_product_requirements.md#travel-time-checks)) |

### S2. Renegotiation after booking

After booking, the guest needs a different time or place, or the host does.

| | Host | Guest | Why it does not fit |
|---|---|---|---|
| Booking links | Calendly's **Share new times to meet** cancels the meeting and asks the invitee to pick again ([Calendly](https://calendly.com/help/how-to-reschedule-a-meeting)) | Reschedules or cancels from the link in the confirmation email ([Calendly FAQ](https://calendly.com/help/scheduling-faq)), choosing from the same slot grid | The new slot is checked as the first one was, so S1's problem comes back; the original booking is gone while a new time is found |
| Email assistants | Clara and Ari list rescheduling ([Clara](https://www.claralabs.com/), [Ari](https://justcc.to/)); a separate host checkpoint on the new time is not established | Replies in the thread | The changed meeting is booked on agreement, without the host's fresh approval |
| Agent-mediated | Public requests enter the owner's approval queue unless the owner's policy allows auto-book ([Openavail](https://www.openavail.com/docs/public-scheduling/)); changes to a booked meeting were not reviewed here | Not established | Not established |
| **Find Me a Time** | Approves or declines the changed proposal; the booked meeting stands until then and the same calendar event moves | Asks in the booking page conversation, the messenger or an agent until the meeting starts | M01: a change goes through the same checks and fresh host approval; a declined or expired change leaves the meeting as it was |

### S3. A request with missing details

A founder asks for 30 minutes next week without saying the timezone or whether it is in person.

| | Host | Guest | Why it does not fit |
|---|---|---|---|
| Booking links | Defines the mode and place in each event type in advance | Picks a slot in the page's timezone; cannot say "in person near Gangnam" unless the event type asks | The page cannot ask the one question that is still open |
| Email assistants | Lets the assistant work in the thread | Answers the assistant's follow-ups by email | Fits on clarification; differs from Find Me a Time on approval (S5) and privacy (S6) |
| **Find Me a Time** | Not involved until a time is picked | The assistant asks only what is still open (mode, place, timezone), one question at a time, in the guest's language | G01: offered times already pass the host's calendar, rules and travel checks |

### S4. A one-off exception

Every candidate is in a week where the host has reached the weekly meeting limit, or the trip needs a manual allowance.

| | Host | Guest | Why it does not fit |
|---|---|---|---|
| Booking links | Must change the event type's limits for everyone, or book by hand | Sees no slot and has to email | No per-request exception |
| Email assistants | Sarra asks the host before booking outside working hours ([Sarra trust and controls](https://sarra.ai/trust)) | Waits | An exception checkpoint exists for this one product and case; a general per-request exception is not established |
| **Find Me a Time** | Gets a private exception control and decides for this request only (web today; the messenger notice and tools are to build, #327) | Is offered times only after the host decides; never told the private reason | Exceptions are host-only and bound to one request ([meeting feasibility](../../openspec/specs/meeting-feasibility/spec.md)) |

### S5. Late replies and retries

A delayed reply and a duplicate agent retry arrive after a different proposal was chosen.

| | Host | Guest | Why it does not fit |
|---|---|---|---|
| Booking links | Usually one booking per click; SavvyCal holds the slot until the host approves ([SavvyCal](https://docs.savvycal.com/article/81-require-approval-for-new-events)) | Not affected | Fits for one-click booking; no multi-turn negotiation to go stale |
| Email assistants | Not established how an old reply is matched to a newer proposal | Not established | Not established |
| Agent-mediated | Openavail's hold-then-confirm flow takes idempotency keys ([two-phase commit](https://www.openavail.com/docs/two-phase-commit/)) | The agent retries safely | Fits for retries; approval is per proposal rather than per version of changed details |
| **Find Me a Time** | An approval names the exact proposal version; a stale tap or reply decides nothing and shows the current one | Sees the current state | At most one calendar event per request (PRD AC-06, AC-13) |

### S6. Private host reasons

The host tells the assistant something private ("not before my board meeting"); the guest must not learn it.

| | Host | Guest | Why it does not fit |
|---|---|---|---|
| Booking links | Keeps the reason private by never stating it | Sees only open slots | Fits on privacy, without any negotiation |
| Email assistants | Talks to the assistant in or around a thread the guest is copied on; Howie's policy says availability may be shared with the other side ([privacy policy](https://howie.com/privacy-policy/)) | May see the assistant's reasoning in the thread | Keeping host-only reasons out of the shared thread is not established |
| **Find Me a Time** | Discusses in the private messenger conversation; the web has no request chat (#326) | The guest's assistant never sees the host's calendar or rules and does not explain why a time is unavailable | Host-private and guest-facing conversations are separate (PRD section 8) |

### S7. A guest who sends their own agent

The guest hands the host's link to ChatGPT, Claude or another agent.

| | Host | Guest | Why it does not fit |
|---|---|---|---|
| Booking links | Cal.com and Calendly offer MCP for the host's own agent ([Cal.com MCP](https://cal.com/blog/how-to-connect-calcom-to-claude-using-mcp), [Calendly MCP](https://developer.calendly.com/docs/mcp/supported-tools)) | A request path for the guest's own agent was not established; the agent would have to fill the page | The documented MCP serves the host's account, not the guest |
| Agent-mediated | Reviews requests in an approval queue, or allows auto-book where the owner's policy permits ([Openavail](https://www.openavail.com/docs/public-scheduling/)) | The agent asks through scoped API or MCP access | Closest fit; email negotiation and travel feasibility were not established |
| **Find Me a Time** | Gets the same approval summary as for a person | The agent starts from `findmeatime.com/{host}`, needs no account, and has access only to that request | G01 MCP path; the host still approves |

### S8. Relationship-specific preferences

The host prefers investor meetings in the afternoon and student meetings in office hours.

| | Host | Guest | Why it does not fit |
|---|---|---|---|
| Booking links | Keeps one event type or link per audience and sends the right one | Sees only the link they were sent | Works only when the host picks the link |
| Email assistants | CalendarBridge keeps a plain-English configuration of up to 1,000 characters ([guide](https://help.calendarbridge.com/help/ai-assistant.html)); Clara lists priority contacts ([Clara](https://www.claralabs.com/)) | Not affected | Whether rules differ by who is asking is not established in tests |
| **Find Me a Time** | One set of hours, limit and places per host; per-relationship rules are not built | Same | Not a current advantage; needs a team decision before it is claimed |

### Operating status checked 2026-11-23

The earlier version of this section left Openavail and SkipUp out because the team reported that they no longer operate. On 2026-11-23 both sites loaded with sign-up and pricing: Openavail shows "Private beta · Google Calendar supported today", a Free plan and Pro at $20 per month ([Openavail](https://www.openavail.com/), [pricing](https://www.openavail.com/pricing/)), and SkipUp shows "Free for your first 10 meetings" and Pro at $49 per month with a sign-up link ([SkipUp](https://skipup.ai/), [getting started](https://support.skipup.ai/getting-started/)). A live site does not establish that onboarding or booking works; neither was tried. Both are back in the comparison above. Reclaim 2.0 stays out at the team's request.

### What to test next

Run S1 to S8 against **Howie, Skej, CalendarBridge, Calendly Callie and Openavail**, with Calendly, Cal.com and SavvyCal as the booking-link baseline, and record for each side: time to booking, host interventions, guest messages, offered times that break a known constraint, and unauthorized or duplicate bookings. Also test whether mandatory approval saves the host decisions or adds friction. Feature descriptions and vendor testimonials cannot establish these outcomes; the interviews and usability tests of #172 supply the user evidence. The presentation's comparison table should follow this section.
