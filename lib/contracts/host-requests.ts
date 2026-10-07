import {z} from 'zod';
export const hostRequestTarget=z.strictObject({requestId:z.uuid()});
export const hostRequestCursor=z.strictObject({beforeCreatedAt:z.iso.datetime({offset:true}),beforeId:z.uuid()});
export const hostRequestQuery=z.strictObject({search:z.string().trim().max(200).default(''),status:z.enum(['active','closed','all']).default('active'),beforeCreatedAt:z.iso.datetime({offset:true}).optional(),beforeId:z.uuid().optional()}).refine(value=>!!value.beforeId===!!value.beforeCreatedAt);
export const hostRequestSummary=z.strictObject({requestId:z.uuid(),revision:z.number().int().positive(),title:z.string().max(400),requesterName:z.string().max(400),status:z.enum(['gathering','negotiating','awaiting_approval','booking','booked','declined','withdrawn','expired']),closed:z.boolean(),createdAt:z.string(),updatedAt:z.string(),proposalVersion:z.number().int().positive().nullable()});
export const hostRequestPage=z.strictObject({requests:z.array(hostRequestSummary).max(30),nextCursor:hostRequestCursor.nullable()});
export type HostRequestSummary=z.infer<typeof hostRequestSummary>;
export type HostRequestPage=z.infer<typeof hostRequestPage>;
