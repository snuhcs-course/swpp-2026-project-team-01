import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { ConversationTools } from '../../lib/server/identity/tool-execution.ts';

export default defineTool({
  description: 'Read the current authorized request or private host setup. Use setup_readiness for current verified public links after settings confirmation. Request context is restricted to this conversation and its discussion audience.',
  inputSchema: z.strictObject({ context: z.enum(['request', 'setup', 'setup_analysis', 'setup_readiness']) }),
  availableInSubagents: false,
  async execute({ context }, ctx) {
    return new ConversationTools().execute(ctx.session.auth.current,
      { sessionId: ctx.session.id, callId: ctx.callId },
      { operation: context === 'setup_readiness' ? 'setup_readiness' : context === 'request' ? 'request_read' : context === 'setup_analysis' ? 'setup_analysis_read' : 'setup_read', input: {} });
  },
});
