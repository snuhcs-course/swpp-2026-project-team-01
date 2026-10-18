# Spec Delta

## REMOVED Requirements

### Requirement: Connect a standalone agent to Photon iMessage

**Reason**: The standalone agent only supports an echo connection test and is being replaced by a host-specific outbound worker and signed inbound webhook.

**Migration**: Remove the echo script and command. Use the `host-imessage-onboarding` capability for host phone connection and Photon messaging.

### Requirement: Reply to inbound iMessage text

**Reason**: Echoing arbitrary inbound text would send test content into real host conversations.

**Migration**: Route inbound messages through the signed host webhook and persist only matching host conversation events.

### Requirement: Protect message and credential data

**Reason**: This requirement applies to the standalone echo agent that is being removed.

**Migration**: Apply the new host onboarding capability's server-side credential and message privacy requirements to the replacement paths.

### Requirement: Stop cleanly

**Reason**: This requirement applies to the standalone echo process that is being removed.

**Migration**: Manage the replacement outbound worker lifecycle as part of its implementation.
