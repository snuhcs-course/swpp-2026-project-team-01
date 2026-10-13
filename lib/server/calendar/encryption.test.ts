import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {TokenCipher} from './encryption.ts';
test('token encryption authenticates principal, content and key without exposing plaintext',()=>{
  const env={...process.env,TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')},cipher=new TokenCipher(env),value={refreshToken:'private-provider-token'};
  const first=cipher.seal(value,'google:host:one'),second=cipher.seal(value,'google:host:one');
  assert.notEqual(first,second);assert.ok(!first.includes(value.refreshToken));assert.deepEqual(cipher.open(first,'google:host:one'),value);
  assert.throws(()=>cipher.open(first,'google:guest:one'),/Reconnect/);
  const parts=first.split('.');parts[3]=(parts[3][0]==='a'?'b':'a')+parts[3].slice(1);
  assert.throws(()=>cipher.open(parts.join('.'),'google:host:one'),/Reconnect/);
  assert.throws(()=>new TokenCipher({...env,TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')}).open(first,'google:host:one'),/Reconnect/);
  assert.throws(()=>new TokenCipher({...env,TOKEN_ENCRYPTION_KEY:'not-a-key'}),/configured/);
});
