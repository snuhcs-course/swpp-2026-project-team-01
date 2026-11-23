# Tasks

## 1. Refusal evidence

- [x] 1.1 Keep Cloudflare's error codes and messages, bounded and with addresses masked, on rejected and server-error outcomes, and write them into the delivery evidence.
- [x] 1.2 Cover the kept, masked, bounded and absent cases in `lib/server/cloudflare-email.test.ts`.

## 2. Sender name

- [x] 2.1 Send a non-ASCII From display name as RFC 2047 encoded-words of whole characters; leave ASCII names unchanged.
- [x] 2.2 Cover a Korean name, a long name split into several words, and unchanged ASCII headers in unit tests.

## 3. Documentation and confirmation

- [x] 3.1 Describe the refusal evidence and the encoded sender name in provider setup and its Korean mirror.
- [ ] 3.2 After deployment, confirm a booking confirmation for a host with a non-ASCII name is accepted, or read the refusal's error code from its evidence.
