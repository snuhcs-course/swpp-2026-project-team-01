# KakaoTalk relay app

This Android app runs on the relay phone for the [`host-kakaotalk-channel`](../../openspec/changes/host-kakaotalk-channel/design.md) change. It sits between the product's KakaoTalk account and the Find Me a Time service:

- A notification listener reads KakaoTalk message notifications. It forwards each 1:1 message once to `POST /kakaotalk/webhook` and retries until the service acknowledges it. Group and open-chat text stays on the phone. For a link code seen there, it sends only a keyed hash (`void_code`).
- A foreground service long-polls `POST /kakaotalk/outbox/claim`. A `reply` claim is sent through the 답장 action of the room's posted notification. A `nudge` claim goes to the accessibility service, which opens the chat by name and types only the fixed nudge. Every claim ends with a result report.
- The same service posts `POST /kakaotalk/heartbeat` every minute.

[`PROTOCOL.md`](PROTOCOL.md) holds the exact requests, answers and signing test vectors.

## Build

You need JDK 17 or later (21 works) and the Android SDK with platform 36. Gradle comes from the wrapper.

```sh
cd apps/kakaotalk-relay
export JAVA_HOME=/path/to/jdk-21
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties   # or set ANDROID_HOME
./gradlew assembleDebug testDebugUnitTest
```

The APK is written to `app/build/outputs/apk/debug/app-debug.apk`. The unit tests run on the JVM. They cover notification parsing, event IDs, the acknowledged-ID ring, signing (known-answer vectors), the claim and result handling, and the nudge's match rules. Running `./gradlew lintDebug` runs Android lint.

The root `npm run lint`, `npm run typecheck` and `npm run build` never read this folder: oxlint finds no JavaScript here, and no `tsconfig.json` includes it. `.gitignore` keeps `build/`, `.gradle/` and `local.properties` out of Git.

## Install on the relay phone

Use only the relay phone, signed in to the product's KakaoTalk account. Keep it plugged in.

1. Turn on USB debugging. Connect the phone and confirm `adb devices` lists it.
2. Run `adb install -r app/build/outputs/apk/debug/app-debug.apk`.
3. Open **FMAT KakaoTalk Relay**. Allow notifications when Android asks, so the foreground service's notice shows.

## Grant access

The app's screen has a button for each of these. Its status block shows whether each one took.

1. **Notification access.** Press **Notification access** and turn on *FMAT KakaoTalk Relay listener*. Without it nothing is read and the heartbeat reports `listenerEnabled: false`, so the service treats the relay as down.
2. **Accessibility.** Press **Accessibility**, open *Installed apps* (on Samsung phones, *Installed apps* under Accessibility), and turn on *FMAT KakaoTalk Relay nudge*. If Android shows *Restricted setting*, open the app's App info, choose ⋮ > *Allow restricted settings*, and try again. The service only works in `com.kakao.talk` and only types the fixed nudge.
3. **Battery optimization off.** Press **Battery optimization off** and allow it. On Samsung also go to Settings > Battery > Background usage limits, and make sure the app is not in *Sleeping apps* or *Deep sleeping apps*. Add it to *Never sleeping apps*.
4. In KakaoTalk, keep message notifications on, with message previews shown. Leave every 1:1 chat unmuted, because a muted chat raises no notification. Turn off the phone's notification history (design 8).

## Configure

Fill in the three fields and press **Save and start relay**:

- **Service base URL**: the service origin, for example `https://findmeatime.com`. It must use HTTPS. Plain HTTP is allowed only to `localhost`, `127.0.0.1` or `10.0.2.2`, for a local relay stand-in.
- **Inbound secret**: the value of `KAKAOTALK_RELAY_INBOUND_SECRET`.
- **Outbox secret**: the value of `KAKAOTALK_RELAY_OUTBOX_SECRET`.

The settings are kept in EncryptedSharedPreferences and are excluded from backups. The screen never shows the secrets again. Leave a secret field blank to keep the stored value.

**Rotating a secret.** Set the new value on the service, keeping the old one as `_PREVIOUS`. Enter the new value here and save. Then remove `_PREVIOUS` from the service.

**Lost phone.** Remove both secrets on the service, sign the KakaoTalk account out from another device, and configure a replacement phone with new secrets (design 2).

The relay starts again after a reboot or an app update once it is configured.

## What it keeps

- An event's text is stored, encrypted, until the service acknowledges it, then deleted.
- The last 500 acknowledged event IDs are kept, without text, so a re-posted notification is not sent twice.
- Claimed text is only kept in memory while it is sent.
- Messages posted before the relay was first configured are never forwarded. The cutoff is set when the base URL is first saved, and again only when the base URL changes (a trailing slash is not a change). Saving new secrets keeps it. A base URL change also clears the waiting events and the acknowledged-ID ring.
- Logs carry no text, names or room IDs.

## Known limits

- **Open chats.** The 2026-11-26 device check covered 1:1 and group chats only. No open-chat notification has been measured, so the strict 1:1 shape below decides. An open chat that matched that shape exactly would still be forwarded. Confirm with an open chat on the test account (design open question).
- **Reply actions shared across rooms.** Android identifies a `PendingIntent` by its intent and request code, not its extras. If KakaoTalk reuses one for several rooms, an action kept for one room could deliver to another. When a newly posted action has the same `PendingIntent` as an action held for another room, the relay drops the other room's action. It never uses an action that another room also holds. Debug builds count these collisions on the status screen. This has not been tested with two rooms on the phone yet.
- **Strict 1:1 shape.** Text is forwarded only when the notification matches the measured 1:1 shape exactly:
  - `isGroupConversation` is present and false, and there is no conversation title;
  - the channel is `new_message_v1` and the category is `msg`;
  - there are exactly two actions, and the second has the `RemoteInput`;
  - every sender's name equals the notification title.

  Anything else, including an open chat we have not measured, sends only `void_code` hashes. A KakaoTalk update that changes this shape therefore stops forwarding rather than leaking group text. Watch the heartbeat's `kakaoVersion` after updates.
- **Accessibility path.** It finds the chat tab by the label 채팅, the list as the largest vertical `RecyclerView` or `ListView`, a row's name as its first text, the chat header in the top sixth of the screen, and the send control by the label 전송. None of this has been run on the relay phone yet (tasks 4.3). Test it with the test account only before release.
- **One reply per notification.** On 2026-11-26 the device test confirmed that a reply through 답장 is delivered, and that KakaoTalk then removes the room's notification. A second claim for that room comes back `not_started` until the host writes again, so the service batches the queued replies for a room into one message. Under test now: the relay keeps the room's newest 답장 action in memory after the notification is removed, and reports those rooms as `replyableRooms`. If the cached action still delivers, the service can send separate messages without batching. A cancelled action drops the room, and an app restart clears the cache. Debug builds show the number of cached actions on the status screen.
- **Room ID.** Whether the room ID in the tag survives a KakaoTalk reinstall or an account move is still open.
