import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {IMessageError,type Message} from '@photon-ai/advanced-imessage/grpc';
import {PhotonTransport,type PhotonClient} from './transport.ts';
import {LinkProof,browserProof,proofHash} from './proof.ts';
import {ApplicationError} from '../errors.ts';
const phone='+15550100001',spaceId='any;-;'+phone;
const message=(overrides:Partial<Message>={}):Message=>({guid:'fixture-message',chatGuids:[spaceId],isFromMe:true,isDelivered:false,sendErrorCode:0,...overrides}) as Message;
const env={PHOTON_PROJECT_ID:randomUUID(),PHOTON_PROJECT_SECRET:'synthetic-secret'};
const issuer:typeof fetch=async(url,init)=>{assert.equal(String(url),`https://spectrum.photon.codes/projects/${env.PHOTON_PROJECT_ID}/imessage/tokens`);assert.equal(init?.redirect,'error');return Response.json({succeed:true,data:{type:'shared',token:'synthetic-token',expiresIn:300}});};
function fixture(){
 const calls:unknown[][]=[];let closed=0;
 const client:PhotonClient={messages:{async sendText(...args){calls.push(args);return message();},async get(){return message();}},addresses:{async isIMessageAvailable(){return true;}},async close(){closed++;}};
 const transport=new PhotonTransport(env,issuer,options=>{assert.equal(options.retry,false);assert.equal(options.autoIdempotency,false);assert.equal(options.tls,true);assert.equal(options.address,'imessage.spectrum.photon.codes:443');return client;});
 return {transport,client,calls,closed:()=>closed};
}
test('code proof encrypts with host/project/challenge context and HMAC never permits offline six-digit guesses',()=>{
 const proof=new LinkProof({TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')}),id=randomUUID(),host=randomUUID(),project=randomUUID(),code=proof.code();
 assert.match(code,/^\d{6}$/u);const sealed=proof.seal(id,host,project,code);assert.equal(proof.open(id,host,project,sealed),code);
 for(const context of [[randomUUID(),host,project],[id,randomUUID(),project],[id,host,randomUUID()]])assert.throws(()=>proof.open(context[0],context[1],context[2],sealed));
 assert.notEqual(proof.hash(id,code),proof.hash(randomUUID(),code));assert.notEqual(proof.hash(id,code),new LinkProof({TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')}).hash(id,code));
 assert.match(proofHash(browserProof()),/^[a-f0-9]{64}$/u);assert.throws(()=>proofHash('forged'));
});
test('Photon sends the frozen identity only after final authorization and preserves acceptance versus delivery',async()=>{
 const f=fixture(),id=randomUUID(),route=await f.transport.prepare(phone);let authorized=0;
 const original=f.client.messages.sendText;f.client.messages.sendText=async(...args)=>{assert.equal(authorized,1);return original(...args);};
 assert.deepEqual(await f.transport.send(route,phone,'Synthetic code',id,async()=>{authorized++;}),{status:'accepted',providerReference:'fixture-message'});
 assert.deepEqual(f.calls,[[spaceId,'Synthetic code',{clientMessageId:id,enableDataDetection:false,enableLinkPreview:false}]]);assert.equal(f.closed(),1);
 f.client.messages.get=async()=>message({isDelivered:true});assert.equal((await f.transport.reconcile(route,'fixture-message')).status,'delivered');assert.equal(f.calls.length,1);
 f.client.messages.get=async()=>message({chatGuids:['any;+;group'],isDelivered:true});assert.equal((await f.transport.reconcile(route,'fixture-message')).status,'uncertain');
 f.client.messages.get=async()=>message({isFromMe:false,isDelivered:true});assert.equal((await f.transport.reconcile(route,'fixture-message')).status,'uncertain');
});
test('revoked preflight never sends, known unavailable addresses fail, and lost acknowledgements never trigger another send',async()=>{
 const f=fixture(),route=await f.transport.prepare(phone),id=randomUUID();
 await assert.rejects(f.transport.send(route,phone,'private',id,async()=>{throw new ApplicationError('UNAUTHORIZED',401);}));assert.equal(f.calls.length,0);assert.equal(f.closed(),1);
 f.client.addresses.isIMessageAvailable=async()=>false;
 assert.equal((await f.transport.send(route,phone,'private',id,async()=>{})).status,'failed');assert.equal(f.calls.length,0);
 f.client.addresses.isIMessageAvailable=async()=>true;
 f.client.messages.sendText=async()=>{throw new Error('private provider body');};
 assert.deepEqual(await f.transport.send(route,phone,'private',id,async()=>{}),{status:'uncertain',providerReference:null});
 assert.deepEqual(await f.transport.reconcile(route,null),{status:'uncertain',providerReference:null});
 f.client.messages.sendText=async()=>{throw new IMessageError('private duplicate body',{code:'duplicateMessage',grpcCode:6,retryable:false});};
 assert.deepEqual(await f.transport.send(route,phone,'private',id,async()=>{}),{status:'accepted',providerReference:null});
});
test('route changes and ambiguous dedicated lines cannot redirect a frozen recipient',async()=>{
 const a=randomUUID(),b=randomUUID(),fetcher:typeof fetch=async()=>Response.json({succeed:true,data:{type:'dedicated',auth:{[a]:'one',[b]:'two'},numbers:{[a]:'+15550100002',[b]:'+15550100003'},expiresIn:300}});
 const t=new PhotonTransport(env,fetcher,()=>{throw new Error('must not connect');});
 await assert.rejects(t.prepare(phone));await assert.rejects(t.send({line:'shared',spaceId},phone,'private',randomUUID(),async()=>{}));
 const explicit=new PhotonTransport({...env,PHOTON_LINE:'+15550100003'},fetcher);assert.equal((await explicit.prepare(phone)).line,'+15550100003');
 await assert.rejects(explicit.send({line:'shared',spaceId:'any;+;group'},phone,'private',randomUUID(),async()=>{}));
});
