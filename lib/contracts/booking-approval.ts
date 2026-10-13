import {z} from 'zod';
import {requestLifecycleState} from './request-lifecycle.ts';
import {schedulingTarget,schedulingAgreement,schedulingProposal} from './scheduling.ts';
export const approvalTarget=schedulingTarget;
export const approvalDecision=schedulingAgreement;
export const approvalState=z.strictObject({requestId:z.uuid(),revision:z.number().int().positive(),status:requestLifecycleState.shape.status,proposal:schedulingProposal.nullable(),requesterAgreed:z.boolean(),approved:z.boolean(),canApprove:z.boolean(),blocker:z.enum(['none','proposal_required','agreement_required','contact_verification_required','reconnect_required','proposal_stale','booking_pending','closed'])});
export type ApprovalState=z.infer<typeof approvalState>;
