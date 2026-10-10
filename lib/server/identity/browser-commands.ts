import { createHash } from 'node:crypto';
import { guestState, hostState, invitationInput, waitlistInput } from '../../contracts/browser.ts';
import { Database } from '../database/client.ts';
import { requireCredential, type Credential } from './credentials.ts';
export class BrowserCommands {
  constructor(private readonly database = new Database()) {}
  async host(credential: Credential) {requireCredential(credential);return hostState.parse(await this.call('host_state',credential,{}));}
  async redeem(credential: Credential, input: unknown) {
    requireCredential(credential);const parsed=invitationInput.parse(input);
    return hostState.parse(await this.call('invite_redeem',credential,{tokenHash:createHash('sha256').update(parsed.code).digest('hex'),idempotencyKey:parsed.idempotencyKey}));
  }
  async waitlist(input: unknown) {await this.call('waitlist_join',null,waitlistInput.parse(input));return{status:'pending' as const};}
  async guest(credential: Credential) {requireCredential(credential);return guestState.parse(await this.call('guest_state',credential,{}));}
  private call(operation:string,credential:Credential|null,input:unknown) {return this.database.rpc('fmat_browser_command',{p_operation:operation,p_credential:credential,p_input:input});}
}
