import {defineTool} from 'eve/tools';
import {assistantDraftInput} from '../../lib/contracts/setup.ts';
import {ConversationTools} from '../../lib/server/identity/tool-execution.ts';
export default defineTool({
 description:'Update the current host-only setup draft. Read setup first; proactively extract the host’s preferences from chat into one patch per incoming message instead of sending them to forms. Suggest first and ask only for missing or ambiguous details. These are unconfirmed assistant suggestions, never saved settings. Select unresolved category keys and optional clarificationLanguage en or ko; never write question prose in unresolved. Explicit host choices cannot be replaced. Chat-extracted mode/location/travel answers appear in a compact protected acceptance card without retyping. Final settings activation requires the current protected review.',
 inputSchema:assistantDraftInput,availableInSubagents:false,
 async execute(input,ctx){return new ConversationTools().execute(ctx.session.auth.current,{sessionId:ctx.session.id,callId:ctx.callId},{operation:'setup_draft',input});},
});
