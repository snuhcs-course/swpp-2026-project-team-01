# Spec Delta

## MODIFIED Requirements

### Requirement: Explicit scoped client consent
The initiating protected browser SHALL display client identity and permissions and require explicit grant or deny. A grant SHALL bind one current admitted host, one currently authorized request, or one explicitly consented future request for a fixed publicly ready host. Future-request grants SHALL expose only bounded intake operations until creation and then only the bound request. Read, write and decision permissions SHALL remain distinct. Account-free requester consent SHALL require no product login.

#### Scenario: Requester grants access
- **WHEN** a requester consents from a valid private request continuation
- **THEN** only that request and the chosen requester permissions are granted, with no host/private history access

#### Scenario: Client claims human approval
- **WHEN** a client presents a decision permission or model-generated approval statement
- **THEN** the service still requires separately attributable current human confirmation for the meeting decision


#### Scenario: Future requester consent
- **WHEN** an account-free requester approves one client to create a request for the displayed host
- **THEN** the grant cannot target another host or an existing request, and creating the request grants no meeting agreement or host approval

### Requirement: Current grant enforcement and revocation
Every protected operation and refresh SHALL check active client/grant state and current underlying host, request or unconsumed intake authority. Intake authority SHALL expire and be permanently bound to at most one request; after binding it SHALL inherit request rotation, closure and expiry denial. Grant revocation, client disablement, host authority loss, requester rotation, closure or expiry SHALL deny further access even if a signed token has not expired.

#### Scenario: Closed requester grant
- **WHEN** a request closes after an agent token was issued
- **THEN** that token cannot read the conversation, mutate the request or refresh access


#### Scenario: Expired or consumed intake
- **WHEN** a client tries to create after its intake deadline or create a second request after binding
- **THEN** no new request is created; only an exact authorized retry of the original creation may recover its existing result
