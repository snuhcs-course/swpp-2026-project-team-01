## ADDED Requirements

### Requirement: Recognized credentials are removed from conversation input
The service SHALL remove recognized bearer values, linking proofs and credential-bearing URL/query/fragment values before new conversation text is persisted in the runtime ledger or sent to the model. It SHALL preserve ordinary scheduling prose, replace removed material visibly and apply the same protection to authorized web, email and iMessage conversation input. Redaction SHALL confer no authority.

#### Scenario: Mixed scheduling and credential text
- **WHEN** an authorized message includes a meeting date/place alongside a bearer token, `LINK <UUID> <proof>` or named token/code/state/secret/proof/recovery/invitation/credential URL parameters
- **THEN** the runtime text retains the scheduling context and replacement markers but contains none of those credential values

#### Scenario: Credential URL encodings
- **WHEN** a credential parameter name has different casing or percent-encoded ASCII characters, or an iMessage proof appears in a URL fragment
- **THEN** the value cannot bypass protection and no automatic link-following or credential redemption occurs

#### Scenario: Ordinary links and prose
- **WHEN** a message contains ordinary scheduling prose or a link without recognized credential material
- **THEN** its meaningful content remains unchanged and it retains the existing size, authority and quota checks

### Requirement: Protected input retains exact retry semantics
Removing credential text SHALL NOT merge distinct submitted inputs under one message retry identity. Exact retries SHALL recover the same protected receipt without another model input or quota charge; changed original input SHALL conflict even if it produces the same protected text. Only a non-plaintext comparison value SHALL be retained for this purpose.

#### Scenario: Changed secret under the same retry identity
- **WHEN** two submissions have identical surrounding prose and retry identity but different recognized secret values
- **THEN** the later submission is rejected as a conflicting retry and no second message or charge is created

#### Scenario: Reclaimed pending delivery
- **WHEN** a protected message is redelivered after a process or acknowledgement failure
- **THEN** only its saved protected text reaches the runtime and no original credential value is reconstructed

#### Scenario: Pre-migration pending message
- **WHEN** a pending message admitted before this change is dispatched after migration
- **THEN** its recognized credentials are protected before future runtime delivery while its original retry identity remains stable
