import {z} from 'zod';
import {agentOperation,agentOperationScope,type AgentOperation} from './agent-operations.ts';

type Operation=AgentOperation['operation'];
type Actor='host'|'guest';
type Definition={name:string;title:string;description:string;actors:readonly Actor[];readOnly:boolean};
const retry=' Supply a new UUID idempotencyKey for a new mutation; reuse it with identical input after a lost response. Changed input with the same key conflicts.';
const definitions={
 setup_read:{name:'fmat_get_setup',title:'Read host setup',actors:['host'],readOnly:true,description:'Read the admitted host’s saved setup and readiness. Requires host:read. Does not connect calendars or publish a booking link.'},
 setup_analysis_read:{name:'fmat_get_setup_analysis',title:'Read setup analysis',actors:['host'],readOnly:true,description:'Read the admitted host’s existing calendar setup analysis. Requires host:read. Does not start a new scan or grant provider consent.'},
 setup_draft:{name:'fmat_draft_setup',title:'Draft host setup',actors:['host'],readOnly:false,description:'Save an assistant-proposed host setup draft. Requires host:write. The host must review and confirm in /app; this does not publish settings.'+retry},
 request_read:{name:'fmat_get_request',title:'Read meeting request',actors:['host','guest'],readOnly:true,description:'Read an authorized meeting request using the caller’s audience-safe projection. Requires host:read or request:read. Requesters can access only their granted request; this is not a booking confirmation.'},
 private_note_save:{name:'fmat_save_private_note',title:'Save private host note',actors:['host'],readOnly:false,description:'Save a private note on the host’s request at expectedRevision. Requires host:write. The note stays outside requester history and does not approve the meeting.'+retry},
 details_propose:{name:'fmat_propose_request_details',title:'Propose request details',actors:['guest'],readOnly:false,description:'Propose a details patch or clarification for the granted request at expectedRevision. Requires request:write. The requester must review before applying; this does not express agreement or book a meeting.'+retry},
 decision_review:{name:'fmat_review_decision',title:'Open human decision review',actors:['host','guest'],readOnly:true,description:'Get the current request revision and protected browser path for human decision review. Requires host:decide or request:decide. No approval, agreement, decline or booking is performed. Ask the user to review the current proposal in that browser path.'},
} as const satisfies Record<Operation,Definition>;

/** Public descriptions and schemas only. Discovery is never authorization:
 * the server must verify credentials and execute through AgentOperations. */
export const agentTools=Object.freeze(agentOperation.options.map(schema=>{
 const {operation:discriminant,...inputShape}=schema.shape;
 const operation=discriminant.value,definition:Definition=definitions[operation];
 return Object.freeze({
  ...definition,operation,actors:Object.freeze([...definition.actors]),
  inputSchema:z.strictObject(inputShape),
  annotations:Object.freeze({readOnlyHint:definition.readOnly,destructiveHint:false,idempotentHint:true,openWorldHint:false}),
 });
}));
export type AgentTool=(typeof agentTools)[number];
export function agentToolsForActor(actor:Actor):readonly AgentTool[]{
 return agentTools.filter(tool=>tool.actors.includes(actor));
}
export function agentToolScope(tool:AgentTool,actor:Actor):string{
 return agentOperationScope(tool.operation,actor);
}
export function agentToolCommand(name:string,input:unknown):AgentOperation{
 const tool=agentTools.find(entry=>entry.name===name);
 if(!tool)throw new Error('Unknown scheduling tool');
 // The operation discriminant is exclusively server-selected. Strict parsing
 // rejects credential, actor, arbitrary operation and human-confirmation fields.
 return agentOperation.parse({...tool.inputSchema.parse(input),operation:tool.operation});
}
