# Design

## Context

See [proposal](proposal.md). The Vite app already has shadcn Base UI, AI Elements conversations, secondary settings dialogs, and separate host/shared request messages. Existing APIs own permissions and exact decisions.

## Goals / Non-Goals

**Goals:** Give the transcript and composer the page's visual focus at desktop and phone widths. Keep navigation, private discussion, and structured recovery discoverable by keyboard.

**Non-Goals:** Change scheduling commands, message persistence, permissions, or decision semantics.

## Decisions

- Replace the host sidebar with the installed shadcn dropdown menu. It leaves no reserved navigation column and uses existing Base UI focus handling. A collapsed icon rail would still reserve space and compete with the conversation.
- Keep setup and request details in existing settings dialogs. Admission and calendar consent actions remain in the conversation because they are prerequisites to continuing chat.
- Show host shared and private request discussions one at a time behind a labeled toggle. This makes privacy mode explicit while reusing the existing independently authorized components.
- Put request state and decision artifacts in the scrollable conversation, with the composer outside the scrolling region. The mobile transcript height is bounded so the composer remains in view.

## Risks / Trade-offs

- A compact menu makes navigation less prominent → use a familiar menu icon, readable labels, and keyboard Escape/focus checks.
- Long artifact lists can occupy the initial transcript → keep the conversation scrollable with jump-to-latest and test mobile overflow.

## Migration Plan

Deploy the web bundle only. The existing routes and backend contracts remain stable; rollback is the previous web deployment.
