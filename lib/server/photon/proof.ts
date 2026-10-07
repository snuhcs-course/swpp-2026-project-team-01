import {createHash,createHmac,randomBytes,randomInt} from 'node:crypto';
import {ApplicationError} from '../errors.ts';
import {TokenCipher} from '../calendar/encryption.ts';
import {z} from 'zod';

const secret=z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
export const browserProof=()=>randomBytes(32).toString('base64url');
export function proofHash(value:string){if(!secret.safeParse(value).success)throw new ApplicationError('UNAUTHORIZED',401);return createHash('sha256').update(value).digest('hex');}
export class LinkProof {
 private readonly key:Buffer;
 private readonly cipher:TokenCipher;
 constructor(env=process.env){this.cipher=new TokenCipher(env);this.key=createHmac('sha256',Buffer.from(env.TOKEN_ENCRYPTION_KEY!,'base64')).update('fmat:photon:code-hash:v1').digest();}
 code(){return randomInt(0,1_000_000).toString().padStart(6,'0');}
 hash(challengeId:string,code:string){if(!z.uuid().safeParse(challengeId).success||!/^\d{6}$/u.test(code))throw new ApplicationError('INVALID_INPUT',400);
  return createHmac('sha256',this.key).update(challengeId+':'+code).digest('hex');}
 seal(challengeId:string,hostId:string,projectId:string,code:string){return this.cipher.seal({code},`photon:otp:${projectId}:${hostId}:${challengeId}`);}
 open(challengeId:string,hostId:string,projectId:string,value:string){
  try{return z.object({code:z.string().regex(/^\d{6}$/u)}).parse(this.cipher.open(value,`photon:otp:${projectId}:${hostId}:${challengeId}`)).code;}
  catch{throw new ApplicationError('PROVIDER_UNAVAILABLE',503);}
 }
}
