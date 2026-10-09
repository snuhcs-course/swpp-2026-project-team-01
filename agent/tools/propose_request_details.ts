import { defineTool } from 'eve/tools';
import { requestExtractionInput } from '../../lib/contracts/conversation-tools.ts';
import { ConversationTools } from '../../lib/server/identity/tool-execution.ts';

export default defineTool({
  description: 'Propose a partial request-details draft for requester review. Declare details, availability, question or unknown intent. Question/unknown must have an empty patch and a clarification. Read current context first; preserve omitted fields and report ambiguous information in clarifications. This never saves scheduling details. The requester must apply the exact draft in protected controls.',
  inputSchema: requestExtractionInput,
  availableInSubagents: false,
  async execute(input, ctx) {
    return new ConversationTools().proposeRequestExtraction(ctx.session.auth.current,
      { sessionId: ctx.session.id, callId: ctx.callId }, input);
  },
});
