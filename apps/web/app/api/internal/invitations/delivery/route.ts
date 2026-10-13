import {invitationDispatch} from '../../../../../../../lib/server/email/invitation-dispatch.ts';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=120;
export const POST=(request:Request)=>invitationDispatch(request);
