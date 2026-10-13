import {confirmPreference,revokePreference,preferenceReceipt} from '../../contracts/preference-decision.ts';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {requireCredential,type Credential} from '../identity/credentials.ts';
export class PreferenceDecisions {
 constructor(private readonly database=new Database()){}
 private call(operation:'confirm'|'revoke',credential:Credential,input:unknown){requireCredential(credential);if(credential.kind!=='host')throw new ApplicationError('FORBIDDEN',403);return this.database.rpc('fmat_preference_decision',{p_operation:operation,p_credential:credential,p_input:input});}
 async confirm(credential:Credential,input:unknown){return preferenceReceipt.parse(await this.call('confirm',credential,confirmPreference.parse(input)));}
 async revoke(credential:Credential,input:unknown){return preferenceReceipt.parse(await this.call('revoke',credential,revokePreference.parse(input)));}
}
