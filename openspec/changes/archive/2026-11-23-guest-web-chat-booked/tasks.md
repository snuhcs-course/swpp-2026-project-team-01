# Tasks

## Booked conversation (#329)

- [x] Admit a booked request on the messages, events, intake and recovery routes (`conversingRequester`), and give the closed booked view its conversation status.
- [x] Render a booked meeting's booking page as the conversation with the receipt and an open composer; read the request again when a turn settles.
- [x] Cover the page in a component test and the routes in an integration test.

## Composer lock (#373)

- [x] Add `handedOver` to the requester view and lock the composer only before the first handover while a fixed step is open.
- [x] Move a Calendar card that reopened after the handover to where the thread is now, under Thyme's line; close the composer with the reason once the request ended.
- [x] Cover the lock rules in unit tests and `handedOver` in an integration test.

## Documents

- [x] Update the guest booking flow (G5, G11) and regenerate its Korean mirror.
- [ ] Run the integration tests (`tests/integration/booking-routes.test.ts`) and the browser tests on main; not run in the implementing session.
