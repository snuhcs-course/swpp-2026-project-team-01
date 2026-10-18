# 명세 상태

> 한국어 번역본 (검토용). 원본: openspec/README.md

날짜: 2026-10-19. 애플리케이션 구현은 시작되지 않았습니다.

`specs/`는 합의된 행동 계약을 담습니다. 명세를 보관한다고 해서 구현되었다는 뜻은 아닙니다. [PRD](../documentations/02_product_requirements.md)를 따르고, 기능을 구현하기 전에 충돌을 해결하십시오.

명세는 두 그룹으로 나뉩니다.

- **제품 동작**: PRD와 대조하여 확인하고 계약으로 유지합니다. `meeting-requests`, `meeting-feasibility`, `host-admission`, `chat-workspaces`, `conversation-access`, `email-delivery`, `public-agent-entry`, `agent-client-authorization`, `imessage-agent`가 여기에 속합니다.
- **내부 메커니즘**: 애플리케이션을 어떻게 만들지 제약합니다. `durable-jobs`, `model-execution`, `application-commands`, `operational-diagnostics`, `messaging-environments`, `calendar-analysis-retention`, `requester-email-ingress`가 여기에 속합니다. 아키텍처가 결정되면 다시 검토하고, 병합하거나 다시 씁니다. 설계를 고정하는 제약으로 취급하지 마십시오.

대기 중인 첫 변경 제안은 없습니다. 스택 결정 후 첫 변경을 제안하십시오. 완료된 변경은 구현되고 검증된 뒤 `changes/archive/`에 보관합니다.

`specs/imessage-agent/`와 `changes/host-imessage-assistant/`는 반복 1 프로토타입에서 변경 없이 복사되었으며, 팀 검토를 기다리고 있습니다. 인터페이스 문서와의 중복은 아직 해결되지 않았습니다.

활성 산출물은 OpenSpec CLI 1.14.0(`openspec validate --all --strict`)으로 검증하십시오. 각 범위 있는 변경은 구현과 검증이 끝난 뒤에만 명세와 동기화하거나 보관하십시오.
