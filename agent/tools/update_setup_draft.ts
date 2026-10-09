import {defineTool} from 'eve/tools';
import {assistantDraftInput} from '../../lib/contracts/setup.ts';
import {ConversationTools} from '../../lib/server/identity/tool-execution.ts';
export default defineTool({
 description:'Update the current host-only setup draft. Read setup first; collect one patch per incoming message. These are unconfirmed assistant suggestions, never saved settings. Select unresolved category keys and optional clarificationLanguage en or ko; never write question prose in unresolved. Explicit host choices cannot be replaced. Host must answer mode/location/travel questions and confirm the current review in protected controls.',
 inputSchema:assistantDraftInput,availableInSubagents:false,
 async execute(input,ctx){return new ConversationTools().execute(ctx.session.auth.current,{sessionId:ctx.session.id,callId:ctx.callId},{operation:'setup_draft',input});},
});
