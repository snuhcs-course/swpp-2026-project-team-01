import {test} from 'node:test';import assert from 'node:assert/strict';
import {main} from './probe-google-login.mjs';
const origin='https://release.findmeatime.com',project='mriseqztcwmezvtawnbo',auth='https://'+project+'.supabase.co';
const google='https://accounts.google.com/o/oauth2/v2/auth?redirect_uri='+encodeURIComponent(auth+'/auth/v1/callback');
const start=()=>Response.json({url:auth+'/auth/v1/authorize?provider=google&redirect_to='+encodeURIComponent(origin+'/auth/callback')});
const redirect=url=>new Response(null,{status:302,headers:{location:url}});
async function run(responses){const output=[],errors=[],urls=[];let index=0;const code=await main(['--origin',origin,'--project',project],v=>output.push(JSON.parse(v)),v=>errors.push(JSON.parse(v)),async(url,init)=>{urls.push(url);assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');assert.ok(!init.headers?.cookie);assert.ok(!init.headers?.authorization);return responses[index++];});return {code,output,errors,urls};}
test('Google redirect mismatch is reported without provider detail or authorization URLs',async()=>{
 const detail=Buffer.from('redirect_uri_mismatch private sentinel').toString('base64url');
 const result=await run([start(),redirect(google),redirect('https://accounts.google.com/signin/oauth/error?authError='+detail)]);
 assert.equal(result.code,1);assert.equal(result.errors[0].code,'GOOGLE_REDIRECT_URI_MISMATCH');assert.equal(result.urls.length,3);assert.ok(!JSON.stringify(result.errors).includes('sentinel'));
});
test('reaching account selection does not claim completed login',async()=>{
 const result=await run([start(),redirect(google),redirect('https://accounts.google.com/v3/signin/accountchooser'),new Response('Account chooser')]);
 assert.equal(result.code,0);assert.equal(result.output[0].liveLoginVerified,false);assert.equal(result.output[0].initialGoogleRedirect,'passed');
});
test('target and provider redirects are fenced before fetching an unrelated origin',async()=>{
 let result=await run([Response.json({url:'https://wrong.supabase.co/auth/v1/authorize'})]);assert.equal(result.errors[0].code,'AUTH_TARGET_MISMATCH');assert.equal(result.urls.length,1);
 result=await run([start(),redirect(google),redirect('https://attacker.test/collect')]);assert.equal(result.errors[0].code,'UNEXPECTED_REDIRECT');assert.equal(result.urls.length,3);
 result=await run([start(),redirect(google.replace(encodeURIComponent(auth+'/auth/v1/callback'),encodeURIComponent('https://attacker.test/cb')))]);assert.equal(result.errors[0].code,'GOOGLE_CALLBACK_MISMATCH');assert.equal(result.urls.length,2);
});
test('ambiguous pages, network errors and invalid arguments never pass or expose raw errors',async()=>{
 const result=await run([start(),redirect(google),new Response('captcha')]);assert.equal(result.errors[0].code,'BROWSER_VERIFICATION_REQUIRED');
 const errors=[];assert.equal(await main(['--origin',origin,'--project',project],()=>{},v=>errors.push(v),async()=>{throw Error('private network sentinel');}),1);assert.ok(!errors[0].includes('sentinel'));
 assert.equal(await main(['--origin','http://localhost','--project',project],()=>{},v=>errors.push(v)),1);assert.equal(JSON.parse(errors.at(-1)).code,'INVALID_TARGET');
});
