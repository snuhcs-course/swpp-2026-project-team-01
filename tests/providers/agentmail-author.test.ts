import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {verifyAgentMailAuthor} from '../../lib/server/agentmail/author.ts';
import {ApplicationError} from '../../lib/server/errors.ts';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const key='v=DKIM1; k=rsa; p='+publicKey.export({type:'spki',format:'der'}).toString('base64');
const expected={senderClaim:'guest@example.test',messageId:'<message-1@example.test>'};
const resolver=async()=>[[key]];
const code=(c:string)=>(e:unknown)=>e instanceof ApplicationError&&e.code===c;
// Independent RFC6376 simple/simple signer, not the verifier library's signer.
function fixture(options:{domain?:string;limited?:boolean;signId?:boolean;from?:string;recipient?:string;parent?:string;signContext?:boolean}={}){
 const body='Request a meeting.\r\n',from='From: '+(options.from??expected.senderClaim),id='Message-ID: '+expected.messageId,to=options.recipient?'To: '+options.recipient:null,parent=options.parent?'In-Reply-To: '+options.parent:null;
 const context=options.signContext?[to,parent].filter(Boolean) as string[]:[];
 const bh=createHash('sha256').update(options.limited?'':body).digest('base64');
 const unsigned=`DKIM-Signature: v=1; a=rsa-sha256; c=simple/simple; d=${options.domain??'example.test'}; s=fixture; h=from${options.signId===false?'':':message-id'}${context.map(h=>':'+h.split(':')[0].toLowerCase()).join('')}; ${options.limited?'l=0; ':''}bh=${bh}; b=`;
 const signature=sign('RSA-SHA256',Buffer.from(from+'\r\n'+(options.signId===false?'':id+'\r\n')+context.map(h=>h+'\r\n').join('')+unsigned),privateKey).toString('base64');
 return Buffer.from(unsigned+signature+'\r\n'+from+'\r\n'+id+'\r\n'+[to,parent].filter(Boolean).map(h=>h+'\r\n').join('')+'Authentication-Results: attacker; dmarc=pass\r\n\r\n'+body);
}
test('Independent DKIM signature authenticates the exact From, Message-ID and full body',async()=>{
 const raw=fixture(),proof=await verifyAgentMailAuthor(raw,expected,{resolver});assert.equal(proof.sender,expected.senderClaim);assert.equal(proof.signingDomain,'example.test');assert.equal(proof.rawHash,createHash('sha256').update(raw).digest('hex'));assert.equal(proof.messageId,expected.messageId);assert.ok(!JSON.stringify(proof).includes('meeting'));
});
test('Forged verdicts, altered body/From/ID, unsigned IDs and length-limited signatures deny',async()=>{
 const raw=fixture();
 for(const input of [Buffer.from(raw.toString().replace('Request a meeting.','Altered approval.')),Buffer.from(raw.toString().replace('From: guest@','From: other@')),Buffer.from(raw.toString().replace('Message-ID: <message-1','Message-ID: <message-2')),fixture({domain:'attacker.test'}),fixture({limited:true}),fixture({signId:false}),Buffer.from(raw.toString().replace('From: guest@','From: guest@example.test\r\nFrom: guest@'))])await assert.rejects(verifyAgentMailAuthor(input,expected,{resolver}),code('FORBIDDEN'));
 await assert.rejects(verifyAgentMailAuthor(Buffer.from('From: guest@example.test\r\nAuthentication-Results: forged; dkim=pass\r\n\r\nhello'),expected,{resolver}),code('FORBIDDEN'));
});
test('Testing keys and ambiguous From fields cannot authorize a sender',async()=>{
 await assert.rejects(verifyAgentMailAuthor(fixture(),expected,{resolver:async()=>[[key+'; t=y']]}),code('FORBIDDEN'));
 await assert.rejects(verifyAgentMailAuthor(fixture({from:'guest@example.test, other@example.test'}),expected,{resolver}),code('FORBIDDEN'));
 await assert.rejects(verifyAgentMailAuthor(fixture(),{...expected,messageId:'other'},{resolver}),code('FORBIDDEN'));
});
test('DKIM limits bound raw input and stalled DNS verification',async t=>{
 await assert.rejects(verifyAgentMailAuthor(Buffer.alloc(2_097_153),expected,{resolver}),code('FORBIDDEN'));
 t.mock.timers.enable({apis:['setTimeout']});const pending=verifyAgentMailAuthor(fixture(),expected,{resolver:async()=>new Promise(()=>{})});const rejected=assert.rejects(pending,code('PROVIDER_UNAVAILABLE'));t.mock.timers.tick(5000);await rejected;
});

test('Signed recipient and reply parent bind the authenticated message to its application context',async()=>{
 const inbox='scheduler@example.test',parent='<previous@example.test>',input={...expected,inboxId:inbox};
 const raw=fixture({recipient:'"Scheduling" <'+inbox+'>',parent,signContext:true});
 const proof=await verifyAgentMailAuthor(raw,input,{resolver});assert.equal(proof.recipient,inbox);assert.equal(proof.replyParent,parent);
 for(const invalid of [fixture({recipient:inbox,parent}),fixture({recipient:'someone@example.test',parent,signContext:true}),Buffer.from(raw.toString().replace(parent,'<unrelated@example.test>')),Buffer.from(raw.toString().replace('To: "Scheduling"','To: victim@example.test\r\nTo: "Scheduling"'))])await assert.rejects(verifyAgentMailAuthor(invalid,input,{resolver}),code('FORBIDDEN'));
 // A valid author signature plus an injected unsigned reply header is not continuation authority.
 const unsignedParent=fixture({recipient:inbox,signContext:true}).toString().replace('Authentication-Results:', 'In-Reply-To: '+parent+'\r\nAuthentication-Results:');
 await assert.rejects(verifyAgentMailAuthor(Buffer.from(unsignedParent),input,{resolver}),code('FORBIDDEN'));
});
