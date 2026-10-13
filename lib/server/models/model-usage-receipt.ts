import {z} from 'zod';
import {sessionTokenUsage,type SessionTokenUsage} from './session-usage.ts';
import {ApplicationError} from '../errors.ts';

export type ModelUsageReceipt={complete(usage:unknown):Promise<void>;failed():Promise<void>};
const reported=z.object({inputTokens:z.object({total:z.number()}),outputTokens:z.object({total:z.number()})});
export function providerTokenUsage(value:unknown):SessionTokenUsage {
 const parsed=reported.safeParse(value);
 if(!parsed.success)throw new ApplicationError('MODEL_LIMIT',429);
 const input=value as {inputTokens:{cacheRead?:unknown;cacheWrite?:unknown}};
 const usage=sessionTokenUsage.safeParse({inputTokens:parsed.data.inputTokens.total,outputTokens:parsed.data.outputTokens.total,
  cacheReadTokens:input.inputTokens.cacheRead??0,cacheWriteTokens:input.inputTokens.cacheWrite??0});
 if(!usage.success)throw new ApplicationError('MODEL_LIMIT',429);
 return usage.data;
}
