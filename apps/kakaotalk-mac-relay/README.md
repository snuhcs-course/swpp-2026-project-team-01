# KakaoTalk Mac relay

The main KakaoTalk relay of the proposed [`host-kakaotalk-mac-relay`](../../openspec/changes/host-kakaotalk-mac-relay/design.md) change: a daemon on a Mac mini that runs KakaoTalk for Mac, signed in to the product's KakaoTalk account. It uses the phone relay's routes and signing ([`PROTOCOL.md`](../kakaotalk-relay/PROTOCOL.md), "Mac relay"). The Android relay in [`../kakaotalk-relay/`](../kakaotalk-relay/README.md) stays as a standby. Never run both: the service acts only on the relay that `KAKAOTALK_ACTIVE_RELAY` names.

## What it does

- **Watches** the KakaoTalk database every 2 seconds through `kakaocli query`, and posts one signed webhook event per new 1:1 message from the other person. Group text never leaves the Mac; a link code seen in a group is sent only as its hash.
- **Claims** outbox messages and sends them with `kakaocli send`, after checking that the room's name picks it and no other room, in the database and in the chat list. After sending it checks in the database that the message landed in the claimed room. A message found elsewhere is reported `uncertain` with reason `wrong_room`.
- **Never writes first**: it sends into a 1:1 room only after the other person wrote there, and never sends the phone's nudge.
- **Leaves** a group room for a `leave` claim, through the chat window's menu.
- **Beats** every minute: database readable, accessibility trusted, screen locked, KakaoTalk version and sendable rooms. It claims nothing while the screen is locked.

The marks file (`state.json`) holds only each room's last handled log ID and the first start time. No message text is written to disk.

## Layout

| Path | What |
|---|---|
| `src/relay.ts` | The watch, claim and heartbeat loops |
| `src/delivery.ts` | Sending and leaving, with the wrong-room checks |
| `src/kakao-db.ts`, `src/bplist.ts` | The SQL, row parsing and the display-member decoder |
| `src/rooms.ts`, `src/events.ts` | The room rules and the webhook events |
| `src/signer.ts` | Request signing, checked against PROTOCOL.md's vectors |
| `src/adapters.ts`, `src/main.ts` | `kakaocli`, the helper, the state file and the entry point |
| `src/testing.ts`, `fixtures/` | Test doubles and rows recorded on the Mac mini (IDs and names replaced) |
| `helper/KakaoAX.swift` | `kakao-ax`: `supervise`, `probe`, `rows`, `leave` |
| `launchd/` | The LaunchAgent template |

Tests: `npm test` runs the unit tests here; `tests/integration/kakaotalk-mac-relay.test.ts` runs the loop against the local service. There are no npm dependencies: Node 24 or later runs the TypeScript sources directly.

## Setting up the Mac

Each step that changes the Mac, signs in an account or sets a secret needs the owner's approval (proposal Q2).

1. **KakaoTalk.** Install KakaoTalk for Mac and sign in to the product's account. Keep the main window open. Turn KakaoTalk's own lock mode off.
2. **One user.** The Mac has only the relay's user account: `kakaocli` takes the database key and message text as arguments, which other users could read with `ps`.
3. **Screen.** The relay sends nothing while the session is locked, because KakaoTalk then exposes no windows. Turn the screen lock off (`sysadminctl -screenLock off -password -`, typed by the owner) and keep the display from sleeping: on 2026-11-26 the session reported itself locked once the display slept, and waking it showed the lock screen. `caffeinate -d -w <supervise pid>` holds the display on while the relay runs, without changing a setting. Keep the Mac in a room that is itself locked, and keep FileVault on.
4. **kakaocli.** Install `kakaocli` 0.6.0 (`brew install silver-flight-group/tap/kakaocli`) and apply the fix below, or build the patched copy: `swift build -c release` in a checkout with the patch.
5. **Database key.** `kakaocli status` cannot find the user ID of an account that `DeviceInfo.userId()` does not detect. Recover it from the `GETCONF*` and `DENYFILE*` key suffixes in `~/Library/Containers/com.kakao.KakaoTalkMac/Data/Library/Preferences/com.kakao.KakaoTalkMac.plist` (SHA-512 of the user ID). Derive the key as `KeyDerivation.swift` does (PBKDF2-SHA256, 100,000 rounds, 128 bytes, from the hardware UUID and the user ID). Write it to `~/.kc-key.txt` with mode 600. Never print it. Check it with `kakaocli query --key "$(cat ~/.kc-key.txt)" "SELECT count(*) FROM NTChatRoom"`.
6. **Files.** Under `~/Library/Application Support/FindMeATime/kakaotalk-mac-relay/`: copy this folder to `app/`, build the helper there (`xcrun swiftc -O -o kakao-ax app/helper/KakaoAX.swift`), and write `config.json` with mode 600:

   ```json
   { "origin": "https://findmeatime.com", "inboundSecret": "…", "outboxSecret": "…", "keyFile": "~/.kc-key.txt", "kakaocli": "/opt/homebrew/bin/kakaocli", "kakaocliSend": "/path/to/patched/kakaocli" }
   ```

   `kakaocli` reads the database and `kakaocliSend` sends; on 2026-11-26 the patched build (a 0.4.1 checkout) took tens of seconds per query, so reads use the released 0.6.0. The secrets are the service's `KAKAOTALK_RELAY_INBOUND_SECRET` and `KAKAOTALK_RELAY_OUTBOX_SECRET`. Add `"groupEvents": true` only when the group change needs membership events.
7. **LaunchAgent.** Fill in `launchd/com.findmeatime.kakaotalk-mac-relay.plist`, copy it to `~/Library/LaunchAgents/`, and load it from the logged-in session (not over SSH): `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.findmeatime.kakaotalk-mac-relay.plist`.
8. **Grants.** Approve Accessibility for `kakao-ax` in System Settings > Privacy & Security, and the prompt to read KakaoTalk's data if macOS shows one. A rebuilt helper needs the grant again. Once the helper works, turn off any grant given to `sshd-keygen-wrapper` for testing over SSH.
9. **Service.** Set `KAKAOTALK_ACTIVE_RELAY=mac` on the service and deploy, after stopping the phone relay. Claims start after the Mac's first heartbeat. The log is `~/Library/Logs/kakaotalk-mac-relay.log`.

## The kakaocli patch

KakaoTalk 26 labels chat-list names `_NS:40`, where `kakaocli` 0.6.0 looks for `_NS:18`, so `send` cannot find any chat. In `Sources/KakaoCore/Automation/AXHelpers.swift`, `findChatRow`:

```swift
if role(child) == "AXStaticText" && (identifier(child) == "_NS:18" || identifier(child) == "_NS:40") {
```

The chats tab is also an `AXButton` now, not an `AXCheckBox`, so `kakaocli` no longer presses it (harmless while the chat list is already shown; `kakao-ax rows` presses either). Offering these upstream, with an exact-match option for `send`, is proposal Q3.

## Device checks still open

- One real leave on a test group, and a recording of the chat window's menu as a fixture (task 5.3). Until then `kakao-ax leave` looks the menu up by title and does nothing unless it finds exactly one.
- `fixtures/ax/rows.json` is a `kakao-ax rows` recording from 2026-11-26 with names replaced. Pass the database path as `"db"` in `config.json`: without `--db`, `kakaocli query` spends about 12 seconds detecting the user ID on every call.
