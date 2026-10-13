import {agentmailWebhook} from '../../../../../../lib/server/agentmail/ingress.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
export const POST=(request:Request)=>agentmailWebhook(request);
