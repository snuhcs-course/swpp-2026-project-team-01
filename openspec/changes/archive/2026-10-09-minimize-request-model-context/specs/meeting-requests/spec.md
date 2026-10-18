## ADDED Requirements

### Requirement: Minimized structured contact context
New application-owned conversation tool results SHALL replace structured requester names and email addresses with derived presence indicators, including nested current, proposed and reviewed details. Omitted patch fields SHALL remain distinguishable from explicit empty values. Authorized protected contact review and explicit contact edits SHALL remain available. Presence SHALL NOT imply verification, agreement or approval.

#### Scenario: Read or draft echoes saved contact
- **WHEN** a conversation reads current request context or creates a details draft containing saved requester contact fields
- **THEN** its model-facing tool result contains contact presence indicators instead of those structured values, retaining scheduling and review state

#### Scenario: Exact application retry
- **WHEN** a committed request operation is retrieved again through the conversation application adapter
- **THEN** the recovered result receives the same contact minimization without another mutation

#### Scenario: Partial or empty contact edit
- **WHEN** a draft omits one contact field and explicitly empties another
- **THEN** the omitted field remains absent from the patch projection, the empty field is marked absent, and protected review retains the exact edit for explicit application

#### Scenario: Protected contact review
- **WHEN** the currently authorized requester reviews or applies an explicit contact correction in protected controls
- **THEN** the exact contact remains visible there and existing verification invalidation and human confirmation rules still apply
