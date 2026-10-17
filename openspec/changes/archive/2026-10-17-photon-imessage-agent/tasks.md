## 1. Photon and local setup

- [x] 1.1 Confirm the Photon CLI session, select the project, and configure an authorized Free/Pro test user or Business line.
- [x] 1.2 Store the project ID and secret in an ignored local environment file; add safe variable names to `.env.example`.

## 2. Agent implementation

- [x] 2.1 Add the Spectrum dependency and a standalone iMessage echo worker.
- [x] 2.2 Add a run script and document local setup and testing instructions.
- [x] 2.3 Verify type checking/build and start the worker after Photon-side configuration is complete.
- [x] 2.4 Ask the user to send a test iMessage and check for the inbound event and accepted reply.
