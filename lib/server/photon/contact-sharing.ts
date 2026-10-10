import {z} from 'zod';
import {contactShareInput,contactShareReadInput,contactShareState} from '../../contracts/imessage.ts';
import {Database} from '../database/client.ts';
import {ApplicationError} from '../errors.ts';
import {requireMessagingEnvironment} from '../config.ts';
import {requireCredential,type Credential} from '../identity/credentials.ts';

export class HostContactSharing {
 constructor(private readonly database:Pick<Database,'rpc'>=new Database(),private readonly env=process.env){}
 private call(operation:'read'|'request',credential:Credential,input:unknown){
  requireCredential(credential);
  if(credential.kind!=='host')throw new ApplicationError('FORBIDDEN',403);
  if(operation==='request')requireMessagingEnvironment(this.env);
  const parsed=(operation==='request'?contactShareInput:contactShareReadInput).parse(input);
  const project=z.uuid().safeParse(this.env.PHOTON_PROJECT_ID);
  if(!project.success)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  return this.database.rpc('fmat_photon_contact',{p_operation:operation,p_credential:credential,p_project_id:project.data,p_input:parsed});
 }
 async read(credential:Credential,input:unknown){return contactShareState.nullable().parse(await this.call('read',credential,input));}
 async request(credential:Credential,input:unknown){return contactShareState.parse(await this.call('request',credential,input));}
}
