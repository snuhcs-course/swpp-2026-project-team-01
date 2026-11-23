> 한국어 번역본 (검토용). 원본: documentations/business/market_and_positioning.md

# Find Me a Time — 시장과 포지셔닝

상태: **팀 검토용 초안** (#171)\
날짜: 2026-11-23\
관련 문서: [경쟁 환경](competitor_research.md), [원페이저](../01_one_pager.md)

이 페이지는 발표의 첫 논거를 순서대로 담습니다. 지금 우리가 수익을 낼 수 있는 시장, 오늘 그 시장을 누가 서비스하는지, 그들이 풀지 못한 것, 그리고 Find Me a Time의 위치입니다. 모든 수치에는 출처와 날짜를 적었고, 각 출처는 2026-11-23에 열어 확인했습니다. 업체와 리서치 회사의 수치는 그들의 주장이며, 회사마다 시장 규모 추정치가 다릅니다. **(팀 판단)** 으로 표시한 문장은 우리 자신의 판단이며, 발표에서 쓰기 전에 팀의 검토가 필요합니다.

## 1. 범위

Find Me a Time은 **외부 일대일 미팅**의 일정을 조율합니다. 캘린더와 최종 결정을 소유하는 호스트 한 명과, 투자자에게 피칭하는 창업자나 교수에게 요청하는 학생처럼 호스트의 조직 밖에 있는 게스트 한 명입니다. 다대다 일정 조율은 아직 결정되지 않은 후속 과제이며, [PRD의 범위](../02_product_requirements.md#outside-the-initial-release)와 마찬가지로 현재 출시 범위 밖에 있습니다.

일대일 외부 미팅을 먼저 다루는 이유 **(팀 판단)**: 조직 안에서는 보통 상급자의 캘린더에 맞추지만, 조직 사이의 미팅은 양쪽이 서로 볼 수 없는 제약을 조정해야 합니다. 이것은 그런 조정의 가장 작은 사례이며, 나중에 다대다 일정 조율을 이해하는 출발점입니다.

## 2. 지금 우리가 수익을 낼 수 있는 시장

| 항목 | 수치 | 출처 |
|---|---|---|
| 전 세계 약속 일정 관리 소프트웨어 시장 | 2025년 USD 546.1 million, 2026년 USD 635.6 million, 2034년 USD 1,905.9 million 전망(2026–2034 연평균 성장률 14.7 %) | [Fortune Business Insights, 보고서 FBI108614](https://www.fortunebusinessinsights.com/appointment-scheduling-software-market-108614), 최종 갱신 2026-11-02 |
| 같은 시장의 두 번째 추정 | 2025년부터 2030년까지 연평균 9.4 % 성장률로 USD 282.4 million 증가(전체 규모가 아닌 성장 수치) | [Technavio](https://www.technavio.com/report/appointment-scheduling-software-market-industry-analysis), 2026년 10월 게시 |
| 전문직 종사자가 일정 조율에 쓰는 시간 | 설문에 응한 미국과 영국의 전문직 약 1,200명(방법론에는 1,241명)의 89 %가 미팅 일정을 잡는 데 주당 최대 4시간을 쓴다고 답함 | [Calendly, The State of Scheduling 2023](https://calendly.com/resources/guides/state-of-scheduling-report), 조사 기간 2023-08-25–2023-09-13 (업체 설문) |
| 시간이 가는 곳 | 주고받기가 "일정 조율에서 가장 큰 시간 낭비"임(그룹 미팅에 대한 참가자 96명의 ETH Zurich 학사 논문) | [Doodle](https://doodle.com/en/resources/blog/study-reveals-time-spent-with-scheduling/), 2021-11-22 게시, 2026-09-28 갱신 (업체의 요약) |

이 수치가 말하는 것과 말하지 않는 것 **(팀 판단)**: 이 수치는 일정 관리 소프트웨어 전반의 규모이며, 대부분은 약속이나 영업 통화를 위한 예약 페이지입니다. 우리 세그먼트, 즉 여러 장소에서 외부 일대일 미팅을 많이 하는 투자자, 창업자, 교수 같은 호스트의 규모는 아닙니다. 이 세그먼트에 대해서는 출처가 있는 수치가 없습니다. 발표 전에 팀은 이를 상향식으로 추정하여(예: 한국에서 도달할 수 있는 그런 호스트의 수에 가격을 곱한 값) 우리의 추정치로 표기하거나, 위의 시장을 우리가 속한 범주로만 제시해야 합니다.

단일 제품이 벌어들이는 매출은 이 범주가 실재함을 보여 줍니다. Calendly는 240개가 넘는 나라에서 5천만 명이 넘는 사람이 사용하고 있으며 이를 통해 13억 건이 넘는 미팅이 예약되었다고 밝힙니다([Calendly, About](https://calendly.com/about), 날짜 표시 없음, 같은 페이지의 다른 문단은 "over 20 million users"라고 함). Calendly는 비상장이며 매출을 공개하지 않습니다. Sacra는 2023년 말 연간 반복 매출을 USD 270 million으로 **추정**합니다([Sacra, Calendly](https://sacra.com/c/calendly), 날짜 표시 없음). 이 출처가 있는 추정치는 2026-10-21 세션에서 기억에 의존해 인용했던 Calendly 매출 수치를 대체하며, 보고된 수치가 아니라 애널리스트의 추정치입니다.

## 3. 오늘 이 시장을 누가 서비스하는가

| 제품 종류 | 주요 제품 | 잘하는 것 |
|---|---|---|
| 예약 링크 | Calendly, Cal.com, SavvyCal | 게스트가 계정 없이 비어 있는 시간대를 고릅니다. 오픈 소스인 Cal.com은 확인된 USD 32.4 million을 조달했고 Sacra는 2026년 11월 연간 반복 매출을 USD 11 million으로 추정합니다([Sacra, Cal.com](https://sacra.com/c/cal), 날짜 표시 없음; [VentureBeat](https://venturebeat.com/2022/04/18/open-source-calendly-rival-cal-com-raises-25m/), 2022-04-18, USD 25 million 시리즈 A에 관한 기사) |
| 이메일 일정 어시스턴트 | Howie, Skej, CalendarBridge, Calendly Callie, SkipUp, Clara | 이메일 스레드에 참조된 어시스턴트가 시간을 제안하고, 후속 연락을 하며, 참가자들이 동의하면 예약합니다 |
| 에이전트 매개 일정 조율 | Openavail | 요청자의 에이전트가 API나 MCP로 요청하고, 소유자가 제안을 검토합니다 |

제품별 기능 수준의 세부 사항, 가격, 출처는 [경쟁 환경](competitor_research.md)에 있습니다. 2026-11-23에 Openavail과 SkipUp은 모두 가입 페이지와 가격 페이지가 운영 중이었습니다([세부 내용](competitor_research.md#operating-status-checked-2026-11-23)).

## 4. 그들이 풀지 못한 것

예약 링크는 비어 있는지 바쁜지만 볼 뿐, 미팅의 **맥락**, 즉 미팅이 열리는 장소, 이동에 걸리는 시간, 호스트의 앞뒤 미팅은 보지 못합니다. Calendly와 Cal.com은 여유 시간을 이벤트 유형이나 예약 링크별 고정 분으로 설정하며, 이동은 그 용도 중 하나로만 언급합니다([Calendly](https://calendly.com/help/how-to-use-buffers), [Cal.com](https://cal.com/help/event-types/event-buffer)). 그래서 링크는 역삼에서 16:00에 끝나는 미팅 직후에 홍대에서의 16:30을 제안하고, 양쪽은 예약 후에 다시 협상합니다([문제 시나리오](../user_experience/01_user_journeys.md#problem-scenario-travel-between-meetings)). 이메일 어시스턴트는 대화를 더하지만, 검토한 출처들은 그들이 이동에 필요한 시간 때문에 어떤 시간을 거절한다는 점이나, 호스트가 예약 전에 정확한 최종 제안을 승인한다는 점을 입증하지 않습니다([시나리오별 비교](competitor_research.md#6-comparison-by-user-scenario)).

예약 후 다시 협상하게 된다는 점은 인터뷰가 아니라 예약 링크 사용자의 행동을 관찰한 데서 나온 것이며, #172의 인터뷰와 사용성 테스트로 확인하거나 바로잡아야 합니다.

## 5. Find Me a Time의 위치

**(팀 판단)** Find Me a Time은 일대일 외부 미팅을 위한 맥락 인식 일정 조율입니다. 시간을 제안하기 전에 장소, 이동, 그 앞뒤의 미팅을 확인하고, 게스트가 어디에 있든(예약 링크, 이메일, 메신저, 또는 자신의 에이전트로, 계정 없이) 게스트와 협상하며, 호스트가 자신의 메신저나 웹에서 현재 제안을 승인할 때에만 예약합니다. 우리의 주장은 사람처럼 느껴지는 캘린더 에이전트가 아니라, 우리가 제안하는 시간이 양쪽 모두에게 실행 가능해서 예약 후의 재협상이 일어나지 않는다는 것입니다.

아직 보여 주어야 할 것은 호스트와 게스트가 이것을 예약 링크보다 가치 있게 여긴다는 점(#172)과 단계별 성공 기준(#168)입니다.

## 6. 이후 확장 (부록)

위의 시장과 분리해 두며, 발표의 마지막에 제시합니다.

- 둘보다 많은 쪽의 제약을 조정하는 다대다 일정 조율. 아직 결정되지 않은 후속 과제입니다.
- 서로 다른 사람들의 개인 에이전트가 미팅을 서로 협상하는 계층. 현재 출시의 MCP와 스킬 문서 진입점이 그 첫걸음이지만, 이에 대해서는 어떤 시장 수치도 주장하지 않습니다.
