// AI-generated with Claude Code (claude-opus-5-5), 2026-10-16
// Phone number entry for the host's texting setup: the country code is picked on its own,
// and the national number gets hyphens as it is typed.

export const COUNTRY_CODES = [
  { code: "+82", label: "KR +82" },
  { code: "+1", label: "US +1" },
  { code: "+81", label: "JP +81" },
  { code: "+86", label: "CN +86" },
  { code: "+44", label: "UK +44" },
] as const;

export type CountryCode = (typeof COUNTRY_CODES)[number]["code"];

export const PLACEHOLDER: Partial<Record<CountryCode, string>> = {
  "+82": "10-0000-0000",
  "+1": "000-000-0000",
};

export function digitsOf(text: string): string {
  return text.replace(/\D/g, "");
}

// After +82 the number drops its leading 0 (10-1234-5678, 2-123-4567); a 0 typed out of habit is removed.
export function nationalDigits(cc: CountryCode, text: string): string {
  const digits = digitsOf(text);
  return cc === "+82" ? digits.replace(/^0/, "") : digits;
}

// Korea: 10-1234-5678, 2-123-4567, 31-1234-5678. The US: 201-555-0123. Other countries stay plain digits.
export function formatLocal(cc: CountryCode, digits: string): string {
  if (cc === "+1") {
    const d = digits.slice(0, 10);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (cc !== "+82") return digits.slice(0, 14);
  const d = digits.slice(0, 10);
  const head = d.slice(0, d.charAt(0) === "2" ? 1 : 2);
  const rest = d.slice(head.length);
  if (!rest) return d;
  // Mobile 10 is always 2-4-4; area codes use 3 in the middle until the number is long enough for 4.
  const mid = head === "10" || rest.length > 7 ? 4 : 3;
  if (rest.length <= mid) return `${head}-${rest}`;
  return `${head}-${rest.slice(0, mid)}-${rest.slice(mid)}`;
}

// Only mobile numbers can receive Thyme's texts.
export function validLocal(cc: CountryCode, digits: string): boolean {
  if (cc === "+82") return /^1\d{8,9}$/.test(digits);
  if (cc === "+1") return digits.length === 10;
  return digits.length >= 6 && digits.length <= 14;
}

// Reformats `value` and returns where the caret goes: after the same digit it followed before,
// so editing the middle of the number doesn't jump the caret to the end.
export function reformat(cc: CountryCode, value: string, caret: number): { value: string; caret: number } {
  const digitsBefore = nationalDigits(cc, value.slice(0, caret)).length;
  const formatted = formatLocal(cc, nationalDigits(cc, value));
  let pos = 0;
  let seen = 0;
  while (pos < formatted.length && seen < digitsBefore) {
    if (/\d/.test(formatted[pos])) seen += 1;
    pos += 1;
  }
  return { value: formatted, caret: pos };
}

export function maskNumber(number: string): string {
  return `•••• ${digitsOf(number).slice(-4)}`;
}
