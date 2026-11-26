-- The KakaoTalk relay phone's latest heartbeat (host-kakaotalk-channel design 7,
-- D7), one row for the one relay: whether its notification listener and
-- accessibility service are enabled, whether the phone is locked, the KakaoTalk
-- version it runs and how many rooms have a posted notification (never the room
-- IDs). The relay is down when the last heartbeat is more than five minutes old
-- or reports a disabled service; app.check_kakaotalk_relay records down_since
-- and its cause, and an alert (down_alerted_at, down_alerts) when the relay goes
-- down and again each hour it stays down. A healthy heartbeat clears the down
-- state. No row means the relay never reported, and nothing is down.
-- relay_kind names the relay that sent the latest heartbeat, the Android phone
-- or the Mac relay (host-kakaotalk-mac-relay design 1); a claim hands out
-- nothing unless it is the active relay. For the Mac relay, posted_rooms counts
-- its sendable rooms.
CREATE TABLE "app"."kakaotalk_relay_heartbeats" (
  "relay" text PRIMARY KEY DEFAULT 'relay' CHECK ("relay" = 'relay'),
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "listener_enabled" boolean NOT NULL,
  "accessibility_enabled" boolean NOT NULL,
  "locked" boolean NOT NULL,
  "kakaotalk_version" text CHECK (char_length("kakaotalk_version") BETWEEN 1 AND 40),
  "posted_rooms" integer NOT NULL DEFAULT 0 CHECK ("posted_rooms" >= 0),
  "relay_kind" text NOT NULL DEFAULT 'android' CHECK ("relay_kind" IN ('android', 'mac')),
  "down_since" timestamptz,
  "down_cause" text CHECK ("down_cause" IN ('silent', 'listener_disabled', 'accessibility_disabled')),
  "down_alerted_at" timestamptz,
  "down_alerts" integer NOT NULL DEFAULT 0 CHECK ("down_alerts" >= 0),
  CONSTRAINT "kakaotalk_relay_heartbeats_down" CHECK (("down_since" IS NULL) = ("down_cause" IS NULL))
);

ALTER TABLE "app"."kakaotalk_relay_heartbeats" ENABLE ROW LEVEL SECURITY;
