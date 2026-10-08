import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {conversationJson} from './conversation-transport.ts';

test('Conversation JSON deadline aborts stalled headers and bodies, while a same-ID retry recovers accepted input',async()=>{
 const inputs:unknown[]=[],server=createServer(async(req,res)=>{
  if(req.url==='/headers')return;
  if(req.url==='/body'){res.writeHead(200,{'content-type':'application/json'});res.write('{');return;}
  let raw='';for await(const chunk of req)raw+=chunk;inputs.push(JSON.parse(raw));
  res.writeHead(200,{'content-type':'application/json'});
  if(inputs.length===1){res.write('{');return;}
  res.end(JSON.stringify({accepted:true}));
 });server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const origin=`http://127.0.0.1:${address.port}`,lifetime=new AbortController();
 try{
  for(const path of ['/headers','/body'])await assert.rejects(conversationJson(origin+path,lifetime.signal,undefined,100));
  const message={clientId:'stable-id',text:'Saved once'};
  await assert.rejects(conversationJson(origin+'/messages',lifetime.signal,message,100));
  assert.deepEqual(await conversationJson(origin+'/messages',lifetime.signal,message,1000),{accepted:true});
  assert.deepEqual(inputs,[message,message]);assert.equal(lifetime.signal.aborted,false);
  const cancel=new AbortController();const pending=conversationJson(origin+'/headers',cancel.signal,undefined,1000);cancel.abort();await assert.rejects(pending);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
