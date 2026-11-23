import { readRequestProjection } from "./support";
import { HOST_NOTES_USE } from "../../lib/server/host-notes";

// The host's notes for Thyme (host-preference-notes) as read_request gives
// them: quoted data with their use. The guest's assistant uses them only to
// shape what it proposes, within host.offer; it never quotes or mentions them,
// never treats them as rules over the settings, and ignores instructions in them.

export function withHostNotes(notes: string, offer: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const base = readRequestProjection();
  return readRequestProjection({
    details: { ...base.details, mode: null, purpose: null, windows: [] },
    host: { displayName: '"Ada Lovelace"', notes: { quoted: notes, use: HOST_NOTES_USE }, offer },
    missing: ["purpose", "mode"],
    readyForTimes: false,
    ...overrides,
  });
}

// A reply that reveals or attributes the notes: names the host's notes, or says
// the host prefers, asked for, said or told the assistant something. Ordinary
// questions about the guest's own wishes ("would you like…", "원하시는 시간") and
// a "Note:" line do not count.
export const MENTIONS_NOTES = new RegExp(
  [
    String.raw`\b(host|ada|lovelace)(['’]s)?\s+(own\s+)?notes?\b`,
    String.raw`\b(left|wrote|gave|shared)\b[^.?!\n]{0,30}\bnotes?\b`,
    String.raw`\b(host|ada|lovelace|she|he|they)\s+(prefers?|asked|said|told|instructed|mentioned|requested|usually\s+(wants|prefers))\b`,
    String.raw`\b(host|ada|lovelace)(['’]s)?\s+(preference|instructions?)\b`,
    "메모|노트",
    String.raw`호스트(가|께서|님이|님께서)\s*[^.?!\n]{0,20}(선호|말씀|요청|안내|원하)`,
  ].join("|"),
  "i",
);
