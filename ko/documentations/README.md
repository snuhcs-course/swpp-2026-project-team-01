> 한국어 번역본 (검토용). 원본: documentations/README.md

# Find Me a Time — 문서

상태: Phase 1 기반이 구현되었으며, 그 증거는 [인수 기록](technical_specification/07_acceptance_record.md)에 있습니다. 이후 단계는 명세 단계입니다. [제공자 설정](technical_specification/03_provider_setup.md)은 선택된 환경과 검증 전제 조건을 기록합니다.

제품 목적과 요구사항을 먼저 읽고, 이어서 UX와 아키텍처를 읽으십시오. 상세한 합의 동작은 [기능 명세](../openspec/specs/)에 있고, 대기 중인 요구사항은 [활성 변경](../openspec/changes/)에 있습니다. 기획 문서는 전달 또는 배포 준비 상태를 증명하지 않습니다.

| 문서 | 담당 및 목적 |
|---|---|
| [원페이저](01_one_pager.md) | 목적, 대상, 핵심 제품 원칙 |
| [PRD](02_product_requirements.md) | 출시 범위, FR-01–FR-36, AC-01–AC-28, 미해결 제품 결정 |
| [설계 원칙](03_design_principles.md) | 에이전트 기능 동등성, 제안 우선 설정, 사용자/관리자 CLI 분리 |
| [시각 디자인](../DESIGN.md) | Thyme 브랜드 자산, 팔레트, 타이포그래피, 접근성 있는 스타일 방향 |
| [사용자 여정](user_experience/01_user_journeys.md) | 채널 전반의 end-to-end 경험 |
| [사용자 스토리](user_experience/02_user_stories.md) | PRD 요구사항과 연결된 행위자별 필요 |
| [인터페이스](user_experience/03_interfaces.md) | 웹, 요청자 이메일, 호스트 iMessage, 개인 에이전트, MCP, CLI의 책임 |
| [페이지 목록](user_experience/04_page_list.md) | 단일 호스트 작업 공간, 공개 접수, 보호된 요청자 목적지, 액션 카드 |
| [호스트 온보딩 흐름](user_experience/05_host_onboarding_flow.md) | 호스트의 설정 상태, 단계별 서버 확인, 기록되는 데이터, 재개 동작 |
| [게스트 예약 흐름](user_experience/06_guest_booking_flow.md) | 요청 상태, 접수부터 확정까지, 에이전트·이메일 변형, 복구와 종료 |
| [기술 개요](04_technical_specification.md) | 시스템 책임과 유지되는 기술 방향 |
| [백엔드 아키텍처](technical_specification/01_backend_architecture.md) | 권한, 도메인 트랜잭션, 실현 가능성, 외부 효과 복구 |
| [프론트엔드 아키텍처](technical_specification/02_frontend_architecture.md) | 제안된 레이아웃, UI/서버 경계, 채팅 상태와 복구 |
| [제공자 설정](technical_specification/03_provider_setup.md) | 기록된 환경 방향과 향후 검증 전제 조건 |
| [에이전트 구성](technical_specification/04_agent_configuration.md) | eve 에이전트가 디스크에 정의되는 방식: 지침, 도구, 스킬, 연결, 채널, 메모리, 모델 |
| [CLI 방향](technical_specification/05_cli.md) | 분리된 사용자/관리자 클라이언트. 실행 명령은 대기 중 |
| [구현 계획](technical_specification/06_implementation_plan.md) | 범위가 정해진 OpenSpec 변경의 제안 순서, 결정 기한, 단계별 인수 증거 |
| [인수 기록](technical_specification/07_acceptance_record.md) | 각 단계가 만든 증거와 그 명령, 날짜, 리비전, 환경, 그리고 알려진 공백 |
| [경쟁사 조사](business/competitor_research.md) | 날짜가 기록된 조사 맥락. 제품 호환성 주장 없음 |
| [이식 가이드](transplant/en/transplant-guide.md) | `dev`에서 검토용으로 복사된 반복 1 프로토타입 기능 F01–F11, 여정, 디자인을 재사용 가능하게 분해한 문서. 아직 조정되지 않음 |

## 유지 관리

제품 목적은 원페이저에, 범위와 인수 기준은 PRD에, UX 설명은 `user_experience/`에, 기술적 근거는 `technical_specification/`에, 관찰 가능한 계약은 OpenSpec에 유지하십시오. 영향을 받는 기능을 구현하기 전에 충돌을 명시적으로 해결하십시오. 초안 결정을 메인 명세로 승격하지 말고, 검증되지 않은 증거를 현재 상태로 취급하지 마십시오.

각 순서 디렉터리 안에서는 두 자리 접두사를 사용하고, 문서를 옮길 때마다 이 색인을 갱신하십시오. 안정적인 FR, AC, 여정, 스토리 식별자는 보존하십시오.
