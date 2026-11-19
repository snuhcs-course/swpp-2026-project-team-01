import { NOTE_DESCRIPTION_LIMIT } from "../contracts/note-review";

// A Google Calendar description as plain text for the note review's details
// (calendar-note-review design 7). Google keeps descriptions written in its web
// editor as HTML, so line breaks and paragraphs become new lines, every other
// tag is dropped and entities are decoded; the page then renders the result as
// text, never as markup. Long descriptions are cut at the limit with "…".

// Google allows 8192 characters; anything longer is cut before parsing so the
// work stays bounded.
const RAW_LIMIT = 16_384;

const NAMED: Readonly<Record<string, string>> = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };

function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      // Control characters and invalid code points are dropped.
      if (!Number.isInteger(code) || code > 0x10ffff || (code < 0x20 && code !== 0x0a && code !== 0x09) || (code >= 0xd800 && code <= 0xdfff)) return "";
      return String.fromCodePoint(code);
    }
    return NAMED[name.toLowerCase()] ?? whole;
  });
}

export function plainDescription(raw: string | null | undefined, limit = NOTE_DESCRIPTION_LIMIT): string | null {
  if (!raw) return null;
  const text = decodeEntities(
    raw
      .slice(0, RAW_LIMIT)
      .replace(/\r\n?/g, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n• ")
      .replace(/<\/?(p|div|ul|ol|h[1-6]|tr|blockquote)\b[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      // A stray "<" without its ">" is left as text and escaped by React.
  )
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return null;
  const characters = [...text];
  return characters.length > limit ? `${characters.slice(0, limit).join("").trimEnd()}…` : text;
}
