import {agentMcpHttp} from '../../../../lib/server/mcp/http.ts';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=120;
const handle=agentMcpHttp();
export {handle as POST,handle as GET,handle as DELETE,handle as OPTIONS,handle as PUT,handle as PATCH,handle as HEAD};
