import { createHash } from 'node:crypto';
import { z } from 'zod';
import {requestClarificationQuestions} from '../../contracts/request-clarifications.ts';
import {setupGuide} from '../../contracts/setup-guide.ts';
import {applicationOrigin} from '../config.ts';
import {PublicIntake} from './public-intake.ts';
import {setupState,encodeSetupClarifications} from '../../contracts/setup.ts';
import { conversationTool, requestExtractionInput } from '../../contracts/conversation-tools.ts';
import { Database } from '../database/client.ts';
import { ApplicationError } from '../errors.ts';
import {requestModelContext} from './request-model-context.ts';
import {hostRequestModelPage} from '../../contracts/host-requests.ts';
import { runtimeAuth } from './runtime-messages.ts';

const callIdentity = z.strictObject({
  sessionId: z.string().min(1).max(200), callId: z.string().min(1).max(200),
});

/** Only pass the current caller from eve's server-owned runtime context here.
 * Never accept this snapshot as browser authentication or use the initiator of
 * a shared session. Mutations revalidate authority atomically; external readiness
 * reads revalidate both before and after provider I/O. */
export class ConversationTools {
  constructor(private readonly database = new Database(),private readonly env=process.env,private readonly publicIntake:Pick<PublicIntake,'profile'>=new PublicIntake(database,env)) {}

  async proposeRequestExtraction(currentAuth:unknown,call:unknown,input:unknown):Promise<unknown>{
    const parsed=requestExtractionInput.safeParse(input);
    if(!parsed.success)throw new ApplicationError('INVALID_INPUT',400);
    const {intent:_intent,clarificationLanguage='en',clarifications,...draft}=parsed.data;
    return this.execute(currentAuth,call,{operation:'details_propose',input:{...draft,
      clarifications:clarifications.map(kind=>requestClarificationQuestions[clarificationLanguage][kind]),
    }});
  }

  async execute(currentAuth: unknown, call: unknown, command: unknown): Promise<unknown> {
    const auth = runtimeAuth.safeParse(currentAuth);
    if (!auth.success) throw new ApplicationError('UNAUTHORIZED', 401);
    const identity = callIdentity.safeParse(call);
    const parsed = conversationTool.safeParse(command);
    if (!identity.success || !parsed.success) throw new ApplicationError('INVALID_INPUT', 400);
    const { operation, input } = parsed.data;
    if(operation==='setup_readiness'){
      const read=async()=>setupState.parse(await this.database.rpc('fmat_conversation_tool',{
        p_grant_id:auth.data.principalId,p_conversation_id:auth.data.attributes.conversationId,p_operation:'setup_read',p_input:{},
      }));
      const before=await read();
      if(before.nextAction!=='settings_confirmed'||!before.confirmed.handle)return {ready:false,reason:'setup'};
      if(!before.calendarGeneration||!before.calendarSelected)return {ready:false,reason:'calendar'};
      let available=true;
      try{await this.publicIntake.profile(before.confirmed.handle);}
      catch(error){if(error instanceof ApplicationError&&error.code==='NOT_FOUND')available=false;else throw error;}
      // Public metadata cannot confer private authority. Recheck the captured
      // current execution grant after I/O, including private-link revocation.
      const after=await read();
      if(after.revision!==before.revision||after.rulesVersion!==before.rulesVersion||after.calendarGeneration!==before.calendarGeneration)throw new ApplicationError('STALE_REVISION',409);
      if(!available)return {ready:false,reason:'calendar'};
      const bookingUrl=applicationOrigin(this.env)+'/'+before.confirmed.handle;
      return {ready:true,bookingUrl,agentInstructionsUrl:bookingUrl+'/SKILL.md'};
    }
    // An interrupted model step can regenerate different call IDs. Permit one
    // mutation of each kind per accepted message; retries use that same key,
    // even if the model changes its call ID or re-reads a newer revision.
    const idempotencyKey = 'eve:' + createHash('sha256').update(JSON.stringify([
      auth.data.attributes.conversationId, auth.data.attributes.messageId, operation,
    ])).digest('hex');
    const result=await this.database.rpc('fmat_conversation_tool', {
      p_grant_id: auth.data.principalId, p_conversation_id: auth.data.attributes.conversationId,
      p_operation: operation,
      p_input: operation.endsWith('_read') ? input : { ...(parsed.data.operation==='setup_draft'?encodeSetupClarifications(parsed.data.input):input), idempotencyKey },
    });
    if(operation==='host_requests_read')return hostRequestModelPage.parse(result);
    if(operation==='setup_read'){const state=setupState.parse(result);return {...state,guide:setupGuide(state)};}
    if(operation==='request_read'||operation==='details_propose'||operation==='private_note_save')return requestModelContext(result);
    return result;
  }
}
