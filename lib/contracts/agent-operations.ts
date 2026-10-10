import {availabilityWindows} from './availability.ts';
import {ianaTimezone} from './time.ts';
import {agentHistoryInput} from './agent-history.ts';
import {z} from 'zod';
import {hostRequestQuery} from './host-requests.ts';
import {assistantDraftInput} from './setup.ts';
import {privateNoteInput,detailsProposalInput} from './conversation-tools.ts';
const requestId=z.uuid(),idempotencyKey=z.uuid(),empty=z.strictObject({});
// Deliberately no actor, bearer token, confirmation, or arbitrary RPC name.
export const agentOperation=z.discriminatedUnion('operation',[
 z.strictObject({operation:z.literal('conversation_read'),input:agentHistoryInput}),
 z.strictObject({operation:z.literal('booking_status'),requestId,input:empty}),
 z.strictObject({operation:z.literal('connection_review'),requestId,input:empty}),
 z.strictObject({operation:z.literal('setup_review'),input:empty}),
 z.strictObject({operation:z.literal('scheduling_read'),requestId,input:empty}),
 z.strictObject({operation:z.literal('availability_read'),requestId,input:empty}),
 z.strictObject({operation:z.literal('availability_propose'),requestId,input:z.strictObject({expectedRevision:z.number().int().positive(),timezone:ianaTimezone,windows:availabilityWindows}),idempotencyKey}),
 z.strictObject({operation:z.literal('requests_list'),input:hostRequestQuery}),
 z.strictObject({operation:z.literal('setup_read'),input:empty}),
 z.strictObject({operation:z.literal('setup_analysis_read'),input:empty}),
 z.strictObject({operation:z.literal('setup_draft'),input:assistantDraftInput,idempotencyKey}),
 z.strictObject({operation:z.literal('request_read'),requestId,input:empty}),
 z.strictObject({operation:z.literal('private_note_save'),requestId,input:privateNoteInput,idempotencyKey}),
 z.strictObject({operation:z.literal('details_propose'),requestId,input:detailsProposalInput,idempotencyKey}),
 z.strictObject({operation:z.literal('decision_review'),requestId,input:empty}),
]);
export type AgentOperation=z.infer<typeof agentOperation>;
export function agentOperationScope(operation:AgentOperation['operation'],kind:'host'|'guest'|'intake'):string{
 const role=kind==='host'?'host':'request';
 if(operation==='decision_review')return role+':decide';
 return role+(operation==='setup_draft'||operation==='private_note_save'||operation==='details_propose'||operation==='availability_propose'?':write':':read');
}
