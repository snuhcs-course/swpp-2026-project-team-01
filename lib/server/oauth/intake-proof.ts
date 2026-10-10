import {createHmac} from 'node:crypto';
import {z} from 'zod';
import {requiredEnv} from '../config.ts';
import {ApplicationError} from '../errors.ts';

/** Server-only recovery of one immutable request proof. Never send this result
 * to a model or terminal; browser handoff may install it only as HttpOnly. */
export function agentIntakeProof(intakeId:string,requestId:string,env=process.env){
 const value=requiredEnv('AGENT_INTAKE_PROOF_KEY',env),key=Buffer.from(value,'base64');
 if(key.length!==32||key.toString('base64')!==value)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
 const identity=z.tuple([z.uuid(),z.uuid()]).parse([intakeId,requestId]).map(id=>id.toLowerCase());
 return createHmac('sha256',key).update('fmat:agent-intake:request-proof:v1\0'+identity.join('\0')).digest('base64url');
}
