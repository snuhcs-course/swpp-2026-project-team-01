import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { ConversationTools } from '../../lib/server/identity/tool-execution.ts';

export default defineTool({
  description: 'Read the current authorized request or private host setup. Request context is restricted to this conversation and its discussion audience.',
  inputSchema: z.strictObject({ context: z.enum(['request', 'setup']) }),
  availableInSubagents: false,
  async execute({ context }, ctx) {
    return new ConversationTools().execute(ctx.session.auth.current,
      { sessionId: ctx.session.id, callId: ctx.callId },
      { operation: context === 'request' ? 'request_read' : 'setup_read', input: {} });
  },
});
