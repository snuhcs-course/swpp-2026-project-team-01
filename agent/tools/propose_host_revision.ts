import {defineTool} from 'eve/tools';
import {hostRevisionExtractionInput} from '../../lib/contracts/conversation-tools.ts';
import {ConversationTools} from '../../lib/server/identity/tool-execution.ts';
export default defineTool({
 description:'Draft changed shared meeting details in the current host-private request. Read current context first. Preserve omitted fields, never copy private rationale or calendar details into the patch, and never change requester identity. Questions and unknown intent require an empty patch and authored clarification categories. This saves only a private draft. The host must review and explicitly share it in the authenticated web workspace; it does not revise a proposal, grant agreement, approve or book.',
 inputSchema:hostRevisionExtractionInput,
 availableInSubagents:false,
 async execute(input,ctx){return new ConversationTools().proposeHostRevision(ctx.session.auth.current,{sessionId:ctx.session.id,callId:ctx.callId},input);},
});
