import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {requiredEnv} from '../config.ts';
import {ApplicationError} from '../errors.ts';

export class TokenCipher {
  private readonly key:Buffer;
  constructor(env=process.env){
    const value=requiredEnv('TOKEN_ENCRYPTION_KEY',env);
    this.key=Buffer.from(value,'base64');
    if(this.key.length!==32||this.key.toString('base64')!==value)throw new ApplicationError('CONFIGURATION_UNAVAILABLE',503);
  }
  seal(value:unknown,context:string){
    const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,nonce);
    cipher.setAAD(Buffer.from(context));
    const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    return ['v1',nonce.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');
  }
  open(value:string,context:string):unknown {
    try{
      const [version,nonce,tag,encrypted,...extra]=value.split('.');
      if(version!=='v1'||extra.length||!encrypted||encrypted.length>131072)throw new Error();
      const iv=Buffer.from(nonce,'base64url'),authTag=Buffer.from(tag,'base64url');
      if(iv.length!==12||authTag.length!==16)throw new Error();
      const cipher=createDecipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from(context));cipher.setAuthTag(authTag);
      return JSON.parse(Buffer.concat([cipher.update(Buffer.from(encrypted,'base64url')),cipher.final()]).toString('utf8'));
    }catch{throw new ApplicationError('RECONNECT_REQUIRED',409);}
  }
}
