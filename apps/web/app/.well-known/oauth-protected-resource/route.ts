import {NextRequest} from 'next/server';
import {agentOAuthProtocol} from '../../../lib/agent-oauth-protocol.ts';
export const dynamic='force-dynamic';
const protocol=agentOAuthProtocol();
function handle(request:NextRequest){return protocol(request,'resource');}
export const GET=handle;export const HEAD=handle;export const POST=handle;export const OPTIONS=handle;export const PUT=handle;export const DELETE=handle;export const PATCH=handle;
