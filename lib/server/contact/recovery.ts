import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {recoveryStart,recoveryRedeem,recoveryAccepted,recoveryResult} from '../../contracts/requester-recovery.ts';
import {Database} from '../database/client.ts';
import {TokenCipher} from '../calendar/encryption.ts';
import {requiredEnv} from '../config.ts';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export class RequesterRecovery{
 constructor(private readonly database=new Database(),private readonly env=process.env){}
 async start(input:unknown){
  const parsed=recoveryStart.parse(input),challengeId=randomUUID(),proof=randomBytes(32).toString('base64url');
  const encryptedProof=new TokenCipher(this.env).seal({proof},'requester-recovery:'+parsed.requestId+':'+challengeId);
  return recoveryAccepted.parse(await this.database.rpc('fmat_requester_recovery',{p_operation:'start',p_input:{...parsed,challengeId,proofHash:hash(proof),encryptedProof}}));
 }
 /** Server-only result: callers must install the token in an HttpOnly cookie, never serialize it. */
 async redeem(input:unknown){
  const {proof,...parsed}=recoveryRedeem.parse(input);new TokenCipher(this.env);
  const key=createHmac('sha256',Buffer.from(requiredEnv('TOKEN_ENCRYPTION_KEY',this.env),'base64')).update('requester-recovery-replacement:v1').digest();
  const token=createHmac('sha256',key).update(parsed.requestId+':'+parsed.challengeId+':'+proof).digest('base64url');
  const result=recoveryResult.parse(await this.database.rpc('fmat_requester_recovery',{p_operation:'redeem',p_input:{...parsed,proofHash:hash(proof),newTokenHash:hash(token)}}));
  return {...result,token};
 }
}
