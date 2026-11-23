import { z } from "zod";

// The host's notes for Thyme (host-preference-notes): free text with meeting
// preferences the guest's assistant uses to shape what it proposes, such as
// "investment advisory meetings are 30 minutes" or "a first meeting is online".
// They are not scheduling policy: feasibility never reads them, they never
// override the host's settings, and the guest never sees them.

export const HOST_NOTES_MAX_LENGTH = 1000;

// Control and bidirectional-override characters could hide or reorder text in
// what the guest's assistant reads, so they are removed; line breaks and tabs stay.
// oxlint-disable-next-line no-control-regex -- removing control characters is the point
const REMOVED = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;

export function cleanHostNotes(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(REMOVED, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// An empty value means the host has no notes (and has answered the setup step).
export const hostNotesSchema = z
  .string()
  .max(HOST_NOTES_MAX_LENGTH * 2)
  .transform(cleanHostNotes)
  .pipe(z.string().max(HOST_NOTES_MAX_LENGTH, `Keep the notes to ${HOST_NOTES_MAX_LENGTH} characters.`));

export const saveHostNotesInput = z.object({ notes: hostNotesSchema }).strict();
export type SaveHostNotesInput = z.infer<typeof saveHostNotesInput>;

// The host's notes as setup and Settings show them: null until the host has
// answered (saved notes or saved none), else the text ("" for none) and when.
export type HostNotesView = { readonly text: string; readonly updatedAt: string } | null;
