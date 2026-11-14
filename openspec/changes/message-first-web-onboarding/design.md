# Design

## Context

`/app` already wraps the host workspace in `LinkStep`. That step reads the shared channel status and uses the existing iMessage/WhatsApp Photon and Telegram Bot API link commands. Today it can auto-select a channel or remember a web-chat deferral. The message-led setup logic is owned by [host-onboarding-in-chat](../host-onboarding-in-chat/design.md).

## Goals / Non-Goals

**Goals:** Make the first authenticated view a channel choice for incomplete hosts, preserve sender confirmation, and recover visibly from status or provider failures.

**Non-Goals:** Rebuild the message-led setup engine or create a browser chat preview. Provider provisioning and live-device validation remain in the channel-specific changes.

## Decisions

1. Gate `HostWorkspace` at its existing `LinkStep` wrapper while `ready` is false. This keeps the server-rendered workspace unavailable to the browser view until the channel flow completes. The alternative, deleting setup components, would break existing ready-host workspace features and does not itself gate entry.
2. Always show configured channel choices before creating a proof. Keep pending and received attempts resumable from the status endpoint. Exclude iMessage on Android; existing deep-link builders and number registration remain the source of channel-specific behavior.
3. Remove local deferral and the post-link web-chat button for incomplete hosts. A status failure displays a retry state instead of silently mounting setup.
4. After confirmation, link directly to the chosen app's conversation and offer the public home page. The channel welcome already starts setup and supplies a Calendar OAuth link when consent is missing.

## Risks / Trade-offs

- [A channel provider is unavailable] → Show a retry state and keep the host's Google session; do not claim setup has started.
- [A channel link is opened on another device] → Keep QR/copy fallback and explicit sender confirmation in the authenticated browser.
- [Existing ready hosts need their workspace] → Preserve their current route behavior and test the incomplete-host gate separately.

## Migration Plan

Deploy the web gate and documentation together. No schema migration is needed. Rollback restores the previous link step while preserving existing channel bindings.
