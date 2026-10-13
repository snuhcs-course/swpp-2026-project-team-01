import {z} from 'zod';
import {openConversation,conversationEvent} from './conversations.ts';
export const historyCursor=z.string().min(1).max(2048);
export const agentHistoryInput=z.strictObject({target:openConversation,cursor:historyCursor.optional()});
export const agentHistoryPage=z.strictObject({events:z.array(conversationEvent).max(100),nextCursor:historyCursor.nullable(),hasMore:z.boolean()});
