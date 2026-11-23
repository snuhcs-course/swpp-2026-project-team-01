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

// A reply that reveals or attributes the notes: names them, says what the host
// prefers or asked for, or says the host told the assistant something.
export const MENTIONS_NOTES =
  /\bnotes?\b|\b(host|ada)\b[^.?!\n]{0,40}\b(prefers?|wants?|asked|likes?|said|told|instructed|mentioned)\b|메모|노트|선호하(시|세)|원하(시|세)는\s*(방식|시간)|호스트(가|께서|님이)\s*[^.?!\n]{0,20}(말씀|요청|안내|원하)/i;
