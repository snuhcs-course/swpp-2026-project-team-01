"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";
import { useEffect, useRef } from "react";
import { analyticsPath, analyticsReferrer } from "@/lib/analytics";

// Loads GA4's gtag.js and records one page view per route (web-analytics design
// D1 and D2). Every address it reports is redacted first: path only, deep paths
// cut to their first segment, referrer cut to its origin. The page views are
// this component's alone (send_page_view: false), and the property's
// history-change page views must be off (provider setup: Google Analytics).

type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

function gtag(): Gtag {
  window.dataLayer = window.dataLayer ?? [];
  window.gtag =
    window.gtag ??
    function gtag() {
      // gtag.js reads the arguments object, not an array, from the queue.
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer?.push(arguments);
    };
  return window.gtag;
}

export function Analytics({ measurementId }: { readonly measurementId: string }) {
  const pathname = usePathname();
  const configured = useRef(false);

  useEffect(() => {
    const send = gtag();
    const location = `${window.location.origin}${analyticsPath(pathname)}`;

    send("set", { page_location: location, page_referrer: analyticsReferrer(document.referrer) });

    if (!configured.current) {
      configured.current = true;
      send("js", new Date());
      send("config", measurementId, {
        allow_ad_personalization_signals: false,
        allow_google_signals: false,
        page_location: location,
        send_page_view: false,
      });
    }

    send("event", "page_view", { page_location: location });
  }, [measurementId, pathname]);

  return <Script src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`} strategy="afterInteractive" />;
}
