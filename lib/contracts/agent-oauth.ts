import {z} from 'zod';
export const agentPermissionLabels={
 'host:read':'Read your host scheduling information and private conversation.',
 'host:write':'Update your host scheduling settings and conversation.',
 'host:decide':'Start host decision flows that still require your explicit confirmation.',
 'request:intake':'Create one meeting request for the displayed host.',
 'request:read':'Read this meeting request and its shared conversation.',
 'request:write':'Update this meeting request and its shared conversation.',
 'request:decide':'Start requester decision flows that still require your explicit confirmation.',
} as const;
export const agentBrowserTarget=z.strictObject({authorizationId:z.uuid(),requestId:z.uuid().optional()});
export const agentGrantTarget=z.strictObject({requestId:z.uuid().optional(),cursor:z.uuid().optional()});
export const agentConsentView=z.object({authorizationId:z.uuid(),clientName:z.string(),redirectUri:z.string(),scope:z.string(),expiresAt:z.string(),decision:z.enum(['grant','deny']).nullable(),audience:z.enum(['host','guest','intake']),access:z.enum(['ready','sign_in','admission','request_required']),label:z.string().nullable(),requestId:z.uuid().nullable(),requests:z.array(z.object({id:z.uuid(),title:z.string()}))});
export type AgentConsentView=z.infer<typeof agentConsentView>;
export const agentGrantsView=z.object({grants:z.array(z.object({id:z.uuid(),clientName:z.string(),scope:z.string(),expiresAt:z.string(),clientDisabled:z.boolean()})),nextCursor:z.uuid().nullable()});
export type AgentGrant=z.infer<typeof agentGrantsView>['grants'][number];

export const agentIntakeBrowserView=z.strictObject({state:z.enum(['pending','bound']),clientName:z.string(),hostName:z.string().nullable(),scope:z.string(),expiresAt:z.iso.datetime({offset:true}),requestId:z.uuid().nullable()});
export type AgentIntakeBrowserView=z.infer<typeof agentIntakeBrowserView>;
