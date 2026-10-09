import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Server,ServerCredentials,loadPackageDefinition,status,type ServiceDefinition,type ServerUnaryCall,type sendUnaryData} from '@grpc/grpc-js';
import {loadSync} from '@grpc/proto-loader';
import {createGrpcClient} from '@photon-ai/advanced-imessage/grpc';
import {PhotonTransport} from '../../lib/server/photon/transport.ts';

test('installed Photon SDK serializes frozen identity, disables resend and reconciles by exact reference over gRPC',{timeout:15000},async()=>{
 assert.equal(JSON.parse(readFileSync('node_modules/@photon-ai/advanced-imessage/package.json','utf8')).version,'2.2.0');
 const root=resolve('node_modules/@photon-ai/advanced-imessage/proto');
 const definition=loadSync(['photon/imessage/v1/message_service.proto','photon/imessage/v1/address_service.proto'],{includeDirs:[root]});
 const services=loadPackageDefinition(definition) as unknown as {photon:{imessage:{v1:{MessageService:{service:ServiceDefinition};AddressService:{service:ServiceDefinition}}}}};
 const server=new Server(),phone='+15550100001',spaceId='any;-;'+phone,reference=randomUUID(),sent:Record<string,unknown>[]=[];
 let unavailable=false,reads=0,authorized=0,closed=0;
 const message=(delivered:boolean)=>({guid:reference,content:{text:'Synthetic wire message'},dateCreated:{seconds:Math.floor(Date.now()/1000),nanos:0},chatGuids:[spaceId],isFromMe:true,isDelivered:delivered,sendErrorCode:0});
 const check=(call:ServerUnaryCall<Record<string,unknown>,unknown>)=>assert.deepEqual(call.metadata.get('authorization'),['Bearer synthetic-sdk-token']);
 server.addService(services.photon.imessage.v1.AddressService.service,{
  getIMessageAvailability(call:ServerUnaryCall<Record<string,unknown>,unknown>,done:sendUnaryData<unknown>){check(call);assert.equal(call.request.address,phone);done(null,{isAvailable:true});},
 });
 server.addService(services.photon.imessage.v1.MessageService.service,{
  sendTextMessage(call:ServerUnaryCall<Record<string,unknown>,unknown>,done:sendUnaryData<unknown>){check(call);assert.ok(authorized>sent.length,'authorization precedes each send');sent.push(call.request);if(unavailable)done({code:status.UNAVAILABLE,message:'synthetic unavailable'});else done(null,{message:message(false)});},
  getMessage(call:ServerUnaryCall<Record<string,unknown>,unknown>,done:sendUnaryData<unknown>){check(call);reads++;assert.equal(call.request.messageGuid,reference);done(null,{message:message(true)});},
 });
 const port=await new Promise<number>((resolve,reject)=>server.bindAsync('127.0.0.1:0',ServerCredentials.createInsecure(),(error,port)=>error?reject(error):resolve(port)));
 const env={PHOTON_PROJECT_ID:randomUUID(),PHOTON_PROJECT_SECRET:'synthetic-sdk-secret'};
 const transport=new PhotonTransport(env,async()=>Response.json({succeed:true,data:{type:'shared',token:'synthetic-sdk-token',expiresIn:300}}),options=>{
  assert.equal(options.tls,true);assert.equal(options.retry,false);assert.equal(options.autoIdempotency,false);assert.equal(options.address,'imessage.spectrum.photon.codes:443');
  // Override only the test network destination/TLS; execute the installed SDK.
  const client=createGrpcClient({...options,address:'127.0.0.1:'+port,tls:false});
  return {messages:client.messages,chats:client.chats,addresses:client.addresses,async close(){closed++;await client.close();}};
 });
 try{
  const route=await transport.prepare(phone),id=randomUUID();
  assert.deepEqual(await transport.send(route,phone,'Synthetic wire message',id,async()=>{authorized++;}),{status:'accepted',providerReference:reference});
  assert.equal(sent.length,1);assert.equal(sent[0].chatGuid,spaceId);assert.equal(sent[0].clientMessageId,id);assert.equal(sent[0].text,'Synthetic wire message');assert.equal(sent[0].enableDataDetection,false);assert.equal(sent[0].enableLinkPreview,false);
  assert.deepEqual(await transport.reconcile(route,reference),{status:'delivered',providerReference:reference});assert.equal(reads,1);assert.equal(sent.length,1,'reconciliation is read-only');
  unavailable=true;const uncertainId=randomUUID();
  assert.deepEqual(await transport.send(route,phone,'Synthetic uncertain send',uncertainId,async()=>{authorized++;}),{status:'uncertain',providerReference:null});
  assert.equal(sent.length,2,'retryable gRPC failure cannot dispatch twice');assert.equal(sent[1].clientMessageId,uncertainId);
  assert.deepEqual(await transport.reconcile(route,null),{status:'uncertain',providerReference:null});assert.equal(reads,1);assert.equal(sent.length,2);assert.equal(closed,3);
 }finally{server.forceShutdown();}
});

test('installed Photon native contact RPC uses the bound chat and does not retry an ambiguous response',{timeout:15000},async()=>{
 const root=resolve('node_modules/@photon-ai/advanced-imessage/proto');
 const definition=loadSync(['photon/imessage/v1/chat_service.proto','photon/imessage/v1/address_service.proto'],{includeDirs:[root]});
 const services=loadPackageDefinition(definition) as unknown as {photon:{imessage:{v1:{ChatService:{service:ServiceDefinition};AddressService:{service:ServiceDefinition}}}}};
 const server=new Server(),phone='+15550100001',spaceId='any;-;'+phone;
 let shares=0,authorized=0,unavailable=false;
 server.addService(services.photon.imessage.v1.AddressService.service,{
  getIMessageAvailability(call:ServerUnaryCall<Record<string,unknown>,unknown>,done:sendUnaryData<unknown>){assert.equal(call.request.address,phone);done(null,{isAvailable:true});},
 });
 server.addService(services.photon.imessage.v1.ChatService.service,{
  shareContactInfo(call:ServerUnaryCall<Record<string,unknown>,unknown>,done:sendUnaryData<unknown>){
   assert.deepEqual(call.metadata.get('authorization'),['Bearer synthetic-contact-token']);
   assert.deepEqual(call.request,{chatGuid:spaceId});assert.ok(authorized>shares);shares++;
   if(unavailable)done({code:status.UNAVAILABLE,message:'synthetic contact response lost'});else done(null,{});
  },
 });
 const port=await new Promise<number>((resolve,reject)=>server.bindAsync('127.0.0.1:0',ServerCredentials.createInsecure(),(error,port)=>error?reject(error):resolve(port)));
 const transport=new PhotonTransport({PHOTON_PROJECT_ID:randomUUID(),PHOTON_PROJECT_SECRET:'synthetic'},async()=>Response.json({succeed:true,data:{type:'shared',token:'synthetic-contact-token',expiresIn:300}}),options=>{
  assert.equal(options.retry,false);assert.equal(options.autoIdempotency,false);assert.equal(options.timeout,10_000);
  return createGrpcClient({...options,address:'127.0.0.1:'+port,tls:false});
 });
 try{
  assert.deepEqual(await transport.shareContact({line:'shared',spaceId},phone,async()=>{authorized++;}),{status:'accepted'});assert.equal(shares,1);
  unavailable=true;
  assert.deepEqual(await transport.shareContact({line:'shared',spaceId},phone,async()=>{authorized++;}),{status:'uncertain'});assert.equal(shares,2,'retryable native RPC error must not resend');
 }finally{server.forceShutdown();}
});
