# Photon iMessage Agent

## Why

The application currently has no iMessage integration. Add a small, standalone Spectrum agent so the team can receive an iMessage through the configured Photon project and verify replies end to end without coupling the messaging process to the Next.js request lifecycle.

## What changes

- Add a Node.js Spectrum worker using the managed Photon iMessage provider.
- Reply to text messages with a simple connection confirmation and an echo of the received text.
- Keep the project credentials in an ignored local environment file and document the setup and run command.
- Keep the worker independently runnable from the web application.

## Requirements

- The worker must require the Spectrum project ID and secret from environment variables and fail clearly when either is missing.
- The worker must connect only to the iMessage provider and wait for inbound messages.
- For inbound text messages, reply with `Photon Spectrum is connected. You said: <message>`.
- Ignore unsupported message content safely and avoid logging message bodies, sender IDs, or credentials.
- The worker must stop its Spectrum connection on SIGINT or SIGTERM.

## Out of scope

- Connecting iMessage messages to scheduling, booking, or account data.
- Adding any messaging channel other than iMessage.
- Exposing a public webhook or embedding the long-running worker in a Next.js serverless route.

## Decisions and open questions

- Use the existing `apps/web` npm project and lockfile; run the worker as a separate Node process from that directory.
- Keep this first integration as a safe echo smoke test. Product-specific message workflows can be proposed separately.
