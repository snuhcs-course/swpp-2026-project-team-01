# Spec Delta

## Purpose

Let a host inspect and change their availability and control new request intake from the existing conversation workspace, without weakening setup confirmation or existing request authority.

## ADDED Requirements

### Requirement: In-place settings dialog
The signed-in host workspace SHALL show a labeled gear button immediately left of the upper-right navigation menu in both setup and request conversation views. Activating it SHALL open a settings modal above the current view, with a translucent backdrop, a readable panel, a visible **X** close button at the panel's upper right and the current view preserved beneath it. The modal SHALL have an accessible title, keep keyboard focus inside while open, close by **X** or Escape, and return focus to the gear button. Closing the modal SHALL not silently apply unfinished edits. Setup, requests, iMessage and connected-agent navigation SHALL remain reachable in the workspace.

#### Scenario: Open and close from setup
- **WHEN** a host opens settings from an incomplete onboarding conversation and presses the **X** button
- **THEN** the same conversation and draft remain in place, no unsaved edit is applied, and focus returns to the gear button

#### Scenario: Open and close from request chat
- **WHEN** a host opens settings from a request conversation and presses Escape
- **THEN** the modal closes and the same request conversation remains selected

#### Scenario: Keyboard and phone use
- **WHEN** a host uses settings with a keyboard at phone width or 200% zoom
- **THEN** the title, close button, controls, pending and error messages are readable and reachable without horizontal page scrolling or focus escaping behind the modal

### Requirement: Weekly availability in settings
The modal SHALL show the host's confirmed weekly available windows and meeting timezone, distinguish any pending draft from the active schedule, and let the host edit windows by weekday. It SHALL label an overnight end as the next day and reject equal start and end times. Editing SHALL update only the revisioned draft; the public schedule SHALL continue to use confirmed windows until the host reviews and explicitly confirms the current settings. Failed or stale confirmation SHALL leave the earlier confirmed schedule in force and show the current draft for review.

#### Scenario: Ready host changes a window
- **WHEN** a ready host edits Monday's window and has not confirmed the review
- **THEN** settings shows the new window as pending while public candidate evaluation continues to use the earlier confirmed window

#### Scenario: Confirm changed window
- **WHEN** the host confirms the current review and all readiness checks pass
- **THEN** the new weekly window becomes the confirmed schedule for subsequent evaluations

#### Scenario: Incomplete onboarding
- **WHEN** a host who has not completed setup edits weekly windows in settings
- **THEN** the new draft appears in setup, but no public schedule becomes available until full setup confirmation

### Requirement: Host-controlled new request intake
A ready active host SHALL be able to turn **Accept new meeting requests** off or on in settings. The choice SHALL be saved on the server and reflected after reload or in another session. Off SHALL prevent creation of new requests through the public web page, personal-agent interface and email entry, and public entry SHALL give the same neutral unavailable result used for an unavailable host. Off SHALL not cancel, hide or prevent continuation, review or booking of requests that already exist, including drafts. On SHALL permit new intake only while the host's account and confirmed setup remain otherwise ready. The host's choice SHALL remain separate from operator suspension and SHALL not change confirmed settings or the host's handle.

#### Scenario: Pause and resume
- **WHEN** a ready host turns the toggle off and later on
- **THEN** every new-request entry path refuses intake while off and accepts it again only after on is saved and readiness still passes

#### Scenario: Existing request while paused
- **WHEN** a host turns intake off after a guest has started a request
- **THEN** that guest can continue the same request and the host can review it, while a new guest cannot start another

#### Scenario: Lost readiness or suspension
- **WHEN** Calendar access is lost or an operator suspends a host while the toggle is on
- **THEN** public intake remains unavailable and the toggle cannot override the missing readiness or operator action

#### Scenario: Retry or stale toggle
- **WHEN** a toggle response is lost or an older settings view submits a conflicting choice
- **THEN** the current saved state is shown without applying a duplicate or silently replacing a newer choice

### Requirement: Sign out from workspace menu
The workspace navigation menu SHALL offer **Sign out**, using the existing authenticated session-ending behavior. The settings modal SHALL not duplicate that action. After sign-out, private settings and conversations SHALL no longer be visible through the former session.

#### Scenario: Sign out from the menu
- **WHEN** a host activates **Sign out** in the workspace menu
- **THEN** the host session ends and a later attempt to open `/app` requires sign-in before any private host data is shown
