## ADDED Requirements

### Requirement: Visible conversation recovery
A workspace with a confirmed failed runtime SHALL show a safe explanation and an explicit recovery action while keeping saved scheduling controls available. The action SHALL remain keyboard-accessible and preserve pending text, history and discussion selection. Ordinary reconnect and send SHALL NOT silently replace a terminal runtime.

#### Scenario: Recover and continue
- **WHEN** the participant activates recovery and the guarded transition succeeds
- **THEN** the same logical conversation remains visible with its history and saved controls, and eligible pending or new input can continue

#### Scenario: Interrupted recovery response
- **WHEN** the browser loses a recovery response or reloads during recovery
- **THEN** it reads authoritative status and retries the same recovery identity without creating another successor

#### Scenario: Recovery unavailable
- **WHEN** provider state cannot be established or current authority is lost
- **THEN** the workspace reports that outcome without claiming recovery, exposing credentials or discarding unsent text
