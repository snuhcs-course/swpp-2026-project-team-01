import { z } from 'zod';
export const emailInput = z.strictObject({email:z.string().trim().toLowerCase().pipe(z.email().max(254))});
export const waitlistInput = emailInput.extend({name:z.string().trim().max(200).default(''),idempotencyKey:z.uuid()});
export const invitationInput = z.strictObject({code:z.string().trim().toUpperCase().transform(v=>v.replaceAll('-','')).pipe(z.string().regex(/^[A-Z2-7]{16}$/u)),idempotencyKey:z.uuid()});
export const guestExchange = z.strictObject({requestId:z.uuid(),token:z.string().regex(/^[A-Za-z0-9_-]{43}$/u)});
export const hostState = z.object({email:z.email(),admitted:z.boolean(),calendarConnected:z.boolean(),nextAction:z.string(),profile:z.object({handle:z.string(),displayName:z.string().nullable(),ready:z.boolean()}).nullable()});
export type HostState = z.infer<typeof hostState>;
export const guestState = z.object({requestId:z.uuid(),status:z.string(),closed:z.boolean(),title:z.string().nullable(),proposal:z.object({start:z.string(),end:z.string(),timezone:z.string(),location:z.string().optional(),mode:z.string().optional()}).nullable()});
export type GuestState = z.infer<typeof guestState>;
