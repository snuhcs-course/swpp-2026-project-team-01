import { z } from 'zod';
import {draftInput} from './setup.ts';

const revision = z.number().int().nonnegative();
const window = z.strictObject({ start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }) });
export const requestDetails = z.strictObject({
  requesterName: z.string().max(200), requesterEmail: z.union([z.email().max(254), z.literal('')]),
  purpose: z.string().max(5000), durationMinutes: z.number().int().min(5).max(240).optional(),
  timezone: z.string().max(100), windows: z.array(window).max(30),
  mode: z.enum(['', 'online', 'in_person']), location: z.string().max(2000),
});
export const privateNoteInput = z.strictObject({ expectedRevision: revision, text: z.string().trim().min(1).max(10_000) });
export const detailsProposalInput = z.strictObject({ expectedRevision: revision, patch: requestDetails.extend({durationMinutes:z.number().int().min(5).max(240).nullable()}).partial(), clarifications:z.array(z.string().trim().min(1).max(500)).max(10) }).refine(value=>Object.keys(value.patch).length>0||value.clarifications.length>0);

// No actor, request ID, execution grant, or human decision in model input.
export const conversationTool = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('setup_draft'), input: draftInput }),
  z.strictObject({ operation: z.literal('setup_analysis_read'), input: z.strictObject({}) }),
  z.strictObject({ operation: z.literal('setup_read'), input: z.strictObject({}) }),
  z.strictObject({ operation: z.literal('request_read'), input: z.strictObject({}) }),
  z.strictObject({ operation: z.literal('private_note_save'), input: privateNoteInput }),
  z.strictObject({ operation: z.literal('details_propose'), input: detailsProposalInput }),
]);
