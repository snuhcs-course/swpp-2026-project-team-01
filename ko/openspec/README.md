# 명세 상태

> 한국어 번역본 (검토용). 원본: openspec/README.md

날짜: 2026-10-21. [구현 계획](../documentations/technical_specification/06_implementation_plan.md)의 1단계와 2단계가 구현되었으며, 그 증거는 [인수 기록](../documentations/technical_specification/07_acceptance_record.md)에 있습니다.

`specs/`는 합의된 행동 계약을 담습니다. 명세를 보관한다고 해서 구현되었다는 뜻은 아닙니다. [PRD](../documentations/02_product_requirements.md)를 따르고, 기능을 구현하기 전에 충돌을 해결하십시오.

명세는 두 그룹으로 나뉩니다.

- **제품 동작**: PRD와 대조하여 확인하고 계약으로 유지합니다. `meeting-requests`, `meeting-feasibility`, `host-admission`, `chat-workspaces`, `conversation-access`, `email-delivery`, `public-agent-entry`, `agent-client-authorization`이 여기에 속합니다.
- **내부 메커니즘**: 애플리케이션을 어떻게 만들지 제약합니다. `durable-jobs`, `model-execution`, `application-commands`, `operational-diagnostics`, `messaging-environments`, `calendar-analysis-retention`, `requester-email-ingress`가 여기에 속합니다. 아키텍처가 결정되면 다시 검토하고, 병합하거나 다시 씁니다. 설계를 고정하는 제약으로 취급하지 마십시오.

처음 두 변경인 [`application-foundation`](changes/application-foundation/proposal.md)과 [`host-onboarding`](changes/host-onboarding/proposal.md)은 구현되고 병합되었지만 아직 보관되지 않았습니다. `application-foundation`의 작업 2.3과 2.8, `host-onboarding`의 작업 7.1이 아직 열려 있습니다. `host-onboarding`이 보관되기 전까지 그 델타(숫자로 된 `host-admission` 한도와 새 `host-setup` 기능)는 해당 변경에만 있습니다. 완료된 변경은 구현되고 검증된 뒤 `changes/archive/`에 보관합니다.

2026-10-19에 폐기됨: 반복 1의 `specs/imessage-agent/`(독립 실행형 에코 응답기)와 `changes/host-imessage-assistant/`(프로토타입의 Drizzle 테이블 위에서 서비스가 보내는 환영 메시지). 두 문서 모두 PRD에서 선택한 호스트 발송 링크 코드와 모순되었고, 이 저장소에 존재하지 않는 코드를 설명했습니다. 호스트 iMessage 동작은 [구현 계획](../documentations/technical_specification/06_implementation_plan.md)의 6단계에서 새로운 변경으로 다시 명세합니다. 폐기된 본문은 `git show e3c01d2:openspec/changes/host-imessage-assistant/design.md`로 계속 읽을 수 있으며, 그 아웃박스, 확인 응답 전 내구성 있는 웹훅, 불확실한 전송 잠금은 해당 변경의 설계 입력입니다.

활성 산출물은 OpenSpec CLI 1.14.0(`openspec validate --all --strict`)으로 검증하십시오. 각 범위 있는 변경은 구현과 검증이 끝난 뒤에만 명세와 동기화하거나 보관하십시오.
