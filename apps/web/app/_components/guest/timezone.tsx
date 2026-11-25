"use client";

import { detectedTimeZone, isValidTimeZone, TIMEZONE_STORAGE_KEY } from "@lib/contracts/timezone";
import { useEffect, useState } from "react";

// Use the browser's IANA zone, retaining an existing choice from this tab so
// dates do not change across a reload or Google consent return.

function storedChoice() {
  try {
    const value = window.sessionStorage.getItem(TIMEZONE_STORAGE_KEY);
    return value && isValidTimeZone(value) ? value : null;
  } catch {
    return null;
  }
}

export function useGuestTimezone() {
  const [zone, setZone] = useState("UTC");

  useEffect(() => {
    const chosen = storedChoice();
    setZone(chosen ?? detectedTimeZone());
  }, []);

  return { zone };
}

// The browser's language, as the request's: Korean or English.
export function browserLanguage(): "en" | "ko" {
  try {
    return navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
  } catch {
    return "en";
  }
}
