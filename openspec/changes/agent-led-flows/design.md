# Design

## Context

The MCP tools run the web's commands through `runAsGrant`, which takes the actor from the verified grant (`actorOf` in `lib/server/agent-tools.ts`): a host grant acts as `host_account`, a requester grant as `requester_request` for its one request. The chat-link commands already accept those actors. `imessage.link.create` checks that the actor is the host it acts on (`assertSelf` in `lib/server/imessage-links.ts`), and `request.imessage_link.create` checks that it is the request (`assertRequest` in `lib/server/requester-imessage-links.ts`). Each makes a one-time `FMAT-` code valid for 15 minutes, voids any earlier open attempt, and binds nothing until a confirm command runs after the receipt job has recorded the sender.

Setup through the agent writes the same draft as the web (`updateDraftCommand`, `confirmSettingsCommand`). The web counts a meeting mode, place or travel mode only when the host presses a card. A linked chat counts one only when the host stated it. The agent's `update_setup_field` marks every action accepted, so today it sets these fields on the agent's word alone.

The UAT these steps serve is U08-A (requester, 10 steps) and U08-B (host, 15 steps) in the Week 12 UAT sheet, run with Claude Code against the shared deployment.

## Goals / Non-Goals

**Goals:** an agent can lead a person through every U08 step from the tool results and documents alone; setup values are applied only when the host agrees; both agents can start a chat link that the person finishes in the browser.

**Non-goals:** notifying an agent of new requests or updates; choosing calendars through the agent (it stays in `/app`); client-specific code; changing how the web or a linked chat links or sets up; Requirements and Specifications, Testing Documentation §5 and the terms of service.

## 1. Entry documents

Instruction version 5. Both documents keep what they say today and add a **Connect from your client** section:

- **Claude Code:** `claude mcp add --transport http findmeatime <endpoint>` for the host, or `findmeatime-{handle}` for a requester, then ask the person to run `/mcp`, choose the server and authenticate in the browser. If the server does not appear in `/mcp`, the person restarts Claude Code and continues the conversation.
- **Other clients:** add the endpoint as a remote MCP server (Streamable HTTP, OAuth) in the client's settings; if the client cannot, continue on the web.

The agent asks the person before running the command and never handles a token. The host document adds what the agent can do once connected, in order: `get_host_status` first, setup with the host's agreement, the booking link, chat linking, and requests on request. The requester document adds chat linking for updates after the request exists.

## 2. Guidance in tool results

The service writes these sentences in `lib/server/setup-tools.ts` and the tool files, in English, so the UAT can name them.

`get_setup` adds `nextStep` beside `nextAction`:

| `nextAction` | `nextStep` |
|---|---|
| `connect_calendar` | Ask the host to connect Google Calendar at `{origin}/app`, then call get_setup again. |
| `choose_calendars` | Ask the host to choose their calendars at `{origin}/app`, then call get_setup again. |
| `analyzing` | Their calendar is still being analyzed. Tell the host to wait a moment, then call get_setup again. Do not confirm yet. |
| `review_suggestions` | Propose a value for each field in `missingFields`, from the suggestions or what you know about the host, and set it with update_setup_field only after the host agrees. Ask the host directly for meeting mode, place and travel mode when you do not know them. |
| `confirm_settings` | Read the settings back to the host. When they agree, call confirm_setup with their words. |
| `ready` | Setup is complete. Share the booking link with the host. |

`confirm_setup` adds `next`: "Setup is confirmed. Give the host the booking link to share. You are not notified of new requests: tell the host to ask you to check for requests, and use list_requests when they do."

`agree_to_proposal` adds `next`: "The person agreed to this time. Tell them the host must still approve, nothing is booked yet, and the outcome arrives by email. They can ask you to check again with get_request."

The host server instructions gain one sentence at the start: "Start with get_host_status, and follow its nextStep and each tool's next step." `get_host_status` keeps its `nextStep`, which already names `/app` for calendars.

## 3. Setup values the host agreed to

`update_setup_field` and `confirm_setup` take a required `hostWords`: 1–500 characters after trimming, "the host's own words agreeing to this value" (or "to these settings" for `confirm_setup`). A missing or blank one is `invalid_input` before any command runs. It is not stored, like `hostInstruction` on decisions. The descriptions and the host instructions say:

- propose values from the suggestions or from what you know about the host;
- set a value only after the host agrees to it, and pass their words;
- ask for meeting mode, place and travel mode when you do not know them; never assume them.

`use_suggestion`, `adjust` and `choose_own` all stay. Like `hostInstruction`, `hostWords` is an attestation, not proof. Its use is that the call cannot be made without the agent stating that the host agreed.

## 4. The link page

### Tools

| Tool | Role and scope | Input | Runs |
|---|---|---|---|
| `start_chat_link` | host, `host:write` | `channel` (`imessage`, `whatsapp` or `telegram`), `number` (not for Telegram), `retryKey` | `imessage.link.create` |
| `start_updates_link` | requester, `request:write` | `channel` (`imessage` or `whatsapp`), `number`, `retryKey` | `request.imessage_link.create` |

Each returns `{ linkUrl, channel, expiresAt, next }`. `linkUrl` is `{origin}/connect/link/{token}`. `next` is: "Give the person this link. On that page they send a code from their own phone and confirm. Nothing is linked until they do." The commands keep their guards: a channel the deployment has not configured is `unavailable_configuration`, too many attempts in an hour is `rate_limited`, and a closed request is `request_closed`. A new attempt voids the earlier open one, as on the web.

### Token

The token seals `{ role, linkId }` with the deployment's token key (`sealToken`) under its own context, `connect-link`. It carries no expiry of its own: the attempt's `expires_at` (15 minutes) and state decide. An attempt that is no longer open (confirmed, voided, cancelled or expired) makes the page show "This link is no longer open. Ask your agent to start again." So a token works once, and needs no new table.

### Page

`/connect/link/{token}` (`noindex`, `Referrer-Policy: same-origin` like the consent page):

- **Host attempt.** The page needs a session for the attempt's host. Signed out, it shows **Sign in with Google**, which returns to the same page (a `return=link` value beside `consent` and `imessage` in `lib/server/google-sign-in.ts`). Signed in as another account, it shows the closed message and binds nothing.
- **Requester attempt.** The token alone authorizes this one attempt: showing its code and confirming it. It never shows the booking link, the request or its details.
- **Content.** The same pieces as the web cards: the message to send, with **Open Messages** or **Open WhatsApp** on a phone, a QR code with **Copy** elsewhere, and **Open Messages on this Mac** on a Mac. The page polls the attempt. When the sender is recorded, it shows the sender in full, as the web cards do (`displaySender` in `lib/contracts/imessage.ts`, #118), with **Confirm and link** and **Cancel**. Only **Confirm and link** binds, through `imessage.link.confirm` (host, session actor) or `request.imessage_link.confirm` (requester, actor from the token's request).
- **After confirming.** "Linked. You can go back to your agent." A linked host gets the usual welcome in the chat; a requester gets the usual first update.

### Status

`get_host_status` adds `chat: { channel, state, sender }`, where `state` is `none`, `pending` or `linked` and `sender` is shown as the web cards show it (#118). The requester's `get_request` adds `updates` in the same shape. Both read the existing status readers (`readImessageStatus`, `readRequesterImessageStatus`).

## 5. Permission words

`host:write` reads "Draft setup, find times, suggest and share changes, and start chat links for you to confirm". `request:write` adds "and start an updates link for you to confirm". Existing grants keep their scopes and gain the tools without a new consent, as in `agent-decisions-in-words`.

## 6. Tests

- Unit: the new tools' inputs and descriptions; `hostWords` missing, blank and overlong on `update_setup_field` and `confirm_setup`; a `nextStep` for every `nextAction`; the `next` on `confirm_setup` and `agree_to_proposal`; entry documents at version 5 with the Claude Code section; token seal and open, a wrong context and a tampered token.
- Integration (`tests/integration/agent-mcp-host.test.ts`, `agent-mcp-requester.test.ts`, `entry-documents.test.ts`): start a link from each role, confirm it on the page with a recorded sender, the expired and voided attempt, another host's session, a requester token used for a second attempt, `get_host_status` and `get_request` before and after linking, and setup through the agent with and without `hostWords`.
- Browser: one Playwright journey for the host page (signed out, sign in, confirm) and one for the requester page.

## Risks

- **Claude Code may need a restart** before a newly added server appears. The documentation is silent on this; the entry document covers both cases, and the UAT records which happened.
- **`hostWords` and `hostInstruction` are attestations.** A model can invent them. The guidance and the UAT's conditional and refusal steps are what check this.
- **A requester token is a bearer for one attempt.** Anyone who holds it within 15 minutes could send the code from their own phone and bind that number to the request's updates. The token goes only to the person's own agent, and the page shows the sender in full before **Confirm and link**, so the person sees whose number is bound.
