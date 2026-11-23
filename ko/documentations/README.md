> 한국어 번역본 (검토용). 원본: documentations/README.md

# Find Me a Time — 문서

상태: Phase 1(기반)과 Phase 2(호스트 온보딩)가 구현되었으며, 그 증거는 [인수 기록](technical_specification/07_acceptance_record.md)에 있습니다. 이후 단계는 명세 단계입니다. [제공자 설정](technical_specification/03_provider_setup.md)은 선택된 환경과 검증 전제 조건을 기록합니다.

제품 목적과 요구사항, 그다음 UX와 아키텍처 문서를 읽으십시오. 상세한 합의 동작은 [기능 명세](../openspec/specs/)에 있고, 대기 중인 요구사항은 [활성 변경](../openspec/changes/)에 있습니다. 기획 문서는 전달 또는 배포 준비 상태를 증명하지 않습니다.

| 문서 | 담당 및 목적 |
|---|---|
| [원페이저](01_one_pager.md) | 목적, 대상, 핵심 제품 원칙 |
| [PRD](02_product_requirements.md) | 출시 범위, FR-01–FR-36, AC-01–AC-28, 미해결 제품 결정 |
| [설계 원칙](03_design_principles.md) | 에이전트 기능 동등성, 제안 우선 설정, 사용자/관리자 CLI 분리 |
| [시각 디자인](../DESIGN.md) | Thyme 브랜드 자산, 팔레트, 타이포그래피, 접근성 있는 스타일 방향 |
| [사용자 여정](user_experience/01_user_journeys.md) | 채널을 가로지르는 종단 간 경험 |
| [사용자 스토리](user_experience/02_user_stories.md) | 테스트 기준선의 열 개 스토리(H01–H04, G01–G03, M01, A01, R01)와 2026-11-23에 결정된 범위 |
| [인터페이스](user_experience/03_interfaces.md) | 웹, 요청자 이메일, 호스트 iMessage, 개인 에이전트, MCP, CLI의 책임 |
| [페이지 목록](user_experience/04_page_list.md) | 단일 호스트 워크스페이스, 공개 페이지에서 보호된 요청자 목적지까지의 게스트 스레드, 액션 카드 |
| [호스트 온보딩 흐름](user_experience/05_host_onboarding_flow.md) | 호스트의 설정 상태, 단계별 서버 확인, 기록되는 데이터, 재개 동작 |
| [게스트 예약 흐름](user_experience/06_guest_booking_flow.md) | 초안부터 확정까지의 요청 상태, 에이전트와 이메일 변형, 복구와 종료 |
| [기술 개요](04_technical_specification.md) | 시스템 책임과 유지되는 기술 방향 |
| [백엔드 아키텍처](technical_specification/01_backend_architecture.md) | 권한, 도메인 트랜잭션, 실현 가능성, 외부 효과 복구 |
| [프론트엔드 아키텍처](technical_specification/02_frontend_architecture.md) | 제안된 레이아웃, UI/서버 경계, 채팅 상태와 복구 |
| [제공자 설정](technical_specification/03_provider_setup.md) | 기록된 환경 방향과 향후 검증 전제 조건 |
| [에이전트 구성](technical_specification/04_agent_configuration.md) | eve 에이전트가 디스크에 정의되는 방식: 지침, 도구, 스킬, 연결, 채널, 메모리, 모델 |
| [CLI 방향](technical_specification/05_cli.md) | 분리된 사용자/관리자 클라이언트. 관리자 CLI는 구현되었고 사용자 CLI는 대기 중 |
| [구현 계획](technical_specification/06_implementation_plan.md) | 범위가 정해진 OpenSpec 변경의 제안 순서, 결정 기한, 단계별 인수 증거 |
| [인수 기록](technical_specification/07_acceptance_record.md) | 각 단계가 만든 증거와 그 명령, 날짜, 리비전, 환경, 그리고 알려진 공백 |
| [결정 기록](technical_specification/08_decision_log.md) | 단계별 모든 결정 지점과 그 대안, 기록된 곳과 바꾸는 방법, 그리고 사용자에게 막혀 있는 단계 |
| [게스트 방어 평가](technical_specification/10_guest_defense_evaluation.md) | 게스트 어시스턴트에 대한 고정 공격 세트, 채점, 사전 선언된 통과 기준, 실행 설정, 결과 |
| [호스트 승인 평가](technical_specification/11_host_approval_evaluation.md) | 초안: 말로 하는 승인을 위한 고정 호스트 메시지 세트, 채점, 제안된 통과 기준, 실행 설정 |
| [스토리 경로 평가](technical_specification/13_story_path_evaluation.md) | 초안: 테스트 기준선의 고정 스토리 경로 사례 세트, 실제 도구 러너, 실행 설정, 테스트 진행 상황 |
| [경쟁사 조사](business/competitor_research.md) | 날짜가 기록된 조사 맥락과 호스트와 게스트를 위한 사용자 시나리오별 비교. 제품 호환성 주장 없음 |
| [시장과 포지셔닝](business/market_and_positioning.md) | 초안: 지금 우리가 수익을 낼 수 있는 시장, 현재 경쟁자, 풀리지 않은 문제와 우리의 위치, 출처 포함 |
| [이식 가이드](transplant/en/transplant-guide.md) | `dev`에서 검토용으로 복사된 반복 1 프로토타입 기능 F01–F11, 여정, 디자인을 재사용 가능하게 분해한 문서. 아직 조정되지 않음 |

## 유지 관리

제품 목적은 원페이저에, 범위와 인수 기준은 PRD에, UX 설명은 `user_experience/`에, 기술적 근거는 `technical_specification/`에, 관찰 가능한 계약은 OpenSpec에 유지하십시오. 영향을 받는 기능을 구현하기 전에 충돌을 명시적으로 해결하십시오. 초안 결정을 메인 명세로 승격하지 말고, 검증되지 않은 증거를 현재 상태로 취급하지 마십시오.

각 순서 디렉터리 안에서는 두 자리 접두사를 사용하고, 문서를 옮길 때마다 이 색인을 갱신하십시오. 안정적인 FR, AC, 여정, 스토리 식별자는 보존하십시오.
