import {oauthJson} from '../../../../../lib/server/oauth/http.ts';
import {NextRequest} from 'next/server';
import {agentOAuthProtocol} from '../../../lib/agent-oauth-protocol.ts';
export const dynamic='force-dynamic';
export const runtime='nodejs';
const protocol=agentOAuthProtocol();
async function handle(request:NextRequest,{params}:{params:Promise<{action:string}>}){const action=(await params).action;return ['register','token','revoke','jwks','authorize'].includes(action)?protocol(request,action):oauthJson({error:'invalid_request'},404);}
export const GET=handle;export const HEAD=handle;export const POST=handle;export const OPTIONS=handle;export const PUT=handle;export const DELETE=handle;export const PATCH=handle;
