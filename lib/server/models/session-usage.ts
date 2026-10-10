import {z} from 'zod';

const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const sessionTokenUsage=z.strictObject({inputTokens:count,outputTokens:count,cacheReadTokens:count,cacheWriteTokens:count});
export type SessionTokenUsage=z.infer<typeof sessionTokenUsage>;
export type ModelUsageState={total:SessionTokenUsage|null;steps:Record<string,SessionTokenUsage>};
export function initialModelUsage():ModelUsageState {
 return {total:{inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0},steps:{}};
}

// Channel state is checkpointed with the step, and projected into read-only
// dynamic-model metadata before the next resolver. Legacy states stay absent;
// only a newly created runtime receives an explicit zero starting point.
export function captureModelUsage(state:ModelUsageState|undefined,event:{turnId:string;sequence:number;stepIndex:number;usage?:unknown}){
 if(!state||state.total===null)return;
 const parsed=sessionTokenUsage.safeParse(event.usage&&typeof event.usage==='object'
  ?Object.fromEntries(Object.keys(state.total).map(key=>[key,(event.usage as Record<string,unknown>)[key]])):null);
 if(!parsed.success){state.total=null;return;}
 const key=`${event.turnId}:${event.sequence}:${event.stepIndex}`,previous=state.steps[key];
 if(previous){if(JSON.stringify(previous)!==JSON.stringify(parsed.data))state.total=null;return;}
 const next=sessionTokenUsage.safeParse(Object.fromEntries(Object.entries(state.total).map(([key,value])=>[key,value+parsed.data[key as keyof SessionTokenUsage]])));
 if(!next.success){state.total=null;return;}
 state.steps[key]=parsed.data;state.total=next.data;
}
