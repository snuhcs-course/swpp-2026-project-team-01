import { photonWebhook } from '../../../../../../lib/server/photon/webhook.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = (request:Request) => photonWebhook(request);
