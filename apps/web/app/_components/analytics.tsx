"use client";

import type { PostHog } from "posthog-js";
import { useEffect } from "react";
import { ANALYTICS_INGEST_PATH, type AnalyticsConfig, analyticsHosts, redactAnalyticsValue } from "@/lib/analytics";

// Product analytics in the browser (web-analytics design D1, D2 and D6). PostHog
// loads only when the root layout renders this component, which it does only in
// production with a project key, and is imported on first use so other builds
// never ship it. It records page views and leaves, clicks, rage and dead clicks,
// heatmaps, web vitals, front-end exceptions and session replay. Every event,
// replay snapshots included, passes redactAnalyticsValue first, so no booking
// identifier, link code or OAuth value leaves the browser. Replay masks all
// text, inputs and descriptive attributes and blocks images (design D6): it
// shows layout and interaction, never what anyone wrote, a guest's name or a
// calendar. Clicks carry neither an element's text nor its attributes, since
// labels such as a calendar block's aria-label name the event and the guest.

let client: PostHog | undefined;
let pendingIdentity: HostIdentity | undefined;

// Attributes whose values are words people or the app wrote about someone (a
// label, a title, a placeholder, a data value), masked in recordings.
const DESCRIPTIVE_ATTRIBUTE = /^(aria-.+|title|alt|placeholder|value|label|content|data-.+)$/;

type HostIdentity = {
  readonly hostAccountId: string;
  readonly traits: Readonly<Record<string, string | number | boolean | null>>;
};

export function Analytics({ config }: { readonly config: AnalyticsConfig }) {
  useEffect(() => {
    if (client) return;
    let cancelled = false;

    void import("posthog-js").then(({ default: posthog }) => {
      if (cancelled || client) return;
      const origin = window.location.origin;

      posthog.init(config.key, {
        api_host: ANALYTICS_INGEST_PATH,
        ui_host: analyticsHosts(config.region).ui,
        defaults: "2026-08-30",
        autocapture: true,
        capture_pageview: "history_change",
        capture_pageleave: true,
        capture_dead_clicks: true,
        capture_exceptions: true,
        capture_performance: { network_timing: true, web_vitals: true },
        enable_heatmaps: true,
        rageclick: true,
        // Clicked elements are described by tag and position only: their text and
        // attributes can hold a guest's name or a request's details.
        mask_all_text: true,
        mask_all_element_attributes: true,
        // Feature flags are unused; their request would skip before_send.
        advanced_disable_flags: true,
        person_profiles: "identified_only",
        disable_surveys: true,
        session_recording: {
          blockSelector: "img, video, canvas",
          // Uncompressed, so before_send can redact the addresses in snapshots.
          compress_events: false,
          maskAllInputs: true,
          maskAttributeFn: (name, value) => (DESCRIPTIVE_ATTRIBUTE.test(name) ? "*".repeat(Math.min(value.length, 8)) : value),
          maskTextSelector: "*",
          maskCapturedNetworkRequestFn: (request) => ({ ...request, name: redactAnalyticsValue(request.name, origin, "url") as string }),
          recordBody: false,
          recordHeaders: false,
        },
        before_send: (event) => (event ? (redactAnalyticsValue(event, origin) as typeof event) : event),
      });
      client = posthog;
      if (pendingIdentity) identify(posthog, pendingIdentity);
    });

    return () => {
      cancelled = true;
    };
  }, [config]);

  return null;
}

function identify(posthog: PostHog, identity: HostIdentity) {
  if (posthog.get_distinct_id() !== identity.hostAccountId) {
    posthog.identify(identity.hostAccountId, { ...identity.traits });
  } else {
    posthog.setPersonProperties({ ...identity.traits });
  }
}

// Identifies the signed-in host by their host account ID (design D6): never an
// email or a name. Renders nothing; without analytics it does nothing.
export function AnalyticsIdentity(identity: HostIdentity) {
  const { hostAccountId } = identity;
  const traits = JSON.stringify(identity.traits);

  useEffect(() => {
    const current = { hostAccountId, traits: JSON.parse(traits) as HostIdentity["traits"] };
    pendingIdentity = current;
    if (client) identify(client, current);
  }, [hostAccountId, traits]);

  return null;
}

// Forgets the identified host before signing out, so the next person on this
// browser starts anonymous. Before PostHog has loaded, its stored identity is
// removed directly instead.
export function resetAnalytics() {
  pendingIdentity = undefined;
  if (client) {
    client.reset();
    return;
  }
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith("ph_")) localStorage.removeItem(key);
    for (const key of Object.keys(sessionStorage)) if (key.startsWith("ph_")) sessionStorage.removeItem(key);
    for (const cookie of document.cookie.split("; ")) {
      const name = cookie.split("=", 1)[0];
      if (!name?.startsWith("ph_")) continue;
      document.cookie = `${name}=; Max-Age=0; path=/`;
      // PostHog shares its cookie across subdomains.
      document.cookie = `${name}=; Max-Age=0; path=/; domain=.${location.hostname.split(".").slice(-2).join(".")}`;
    }
  } catch {
    // Storage can be unavailable; signing out goes ahead regardless.
  }
}
