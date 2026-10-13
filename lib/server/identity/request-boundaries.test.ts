import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {guestCredential} from './credentials.ts';
import {RequestReview} from './request-review.ts';
import {Database} from '../database/client.ts';
import {TokenCipher} from '../calendar/encryption.ts';
import {ContactVerification} from '../contact/verification.ts';
import {SchedulingPublication} from '../scheduling/publication.ts';
import {AvailabilityEvaluation} from '../scheduling/availability.ts';
import {CandidateRanking} from '../scheduling/ranking.ts';
import {ApplicationError} from '../errors.ts';

test('Review decisions cannot carry unconfirmed or caller-supplied patch and authority fields to SQL',async()=>{
 let calls=0;
 const database=new Database({SUPABASE_URL:'https://database.example.test',SUPABASE_SECRET_KEY:'synthetic'},async()=>{calls++;throw new Error('Invalid review reached SQL');});
 const credential=guestCredential(randomUUID(),randomBytes(32).toString('base64url')),service=new RequestReview(database);
 const decision={reviewId:randomUUID(),expectedRevision:3,confirmed:true,idempotencyKey:randomUUID()};
 for(const input of [{...decision,confirmed:false},{...decision,patch:{purpose:'injected'}},{...decision,requestId:randomUUID()},{...decision,actor:{kind:'host'}},{...decision,requesterAgreed:true}])assert.throws(()=>service.decide('apply',credential,input));
 await assert.rejects(service.decide('apply',{...credential},decision),{code:'UNAUTHORIZED'});
 assert.equal(calls,0);
});

test('Denied requester state cannot trigger availability or ranking providers',async()=>{
 let reads=0,providerCalls=0;
 const database=new Database();database.rpc=async()=>{reads++;throw new ApplicationError('NOT_FOUND',404);};
 const evaluation=new AvailabilityEvaluation(database);evaluation.batch=async()=>{providerCalls++;throw new Error('Unauthorized availability');};
 const ranking=new CandidateRanking(database);ranking.rank=async()=>{providerCalls++;throw new Error('Unauthorized ranking');};
 const requestId=randomUUID(),credential=guestCredential(requestId,randomBytes(32).toString('base64url'));
 await assert.rejects(new SchedulingPublication(database,evaluation,ranking).evaluate(credential,{requestId,revision:1}),{code:'NOT_FOUND'});
 assert.equal(reads,1);assert.equal(providerCalls,0);
});

test('Contact initiation sends only a scoped code hash and encrypted code to SQL and returns no secret',async()=>{
 const env={SUPABASE_URL:'https://database.example.test',SUPABASE_SECRET_KEY:'synthetic',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
 const requestId=randomUUID(),credential=guestCredential(requestId,randomBytes(32).toString('base64url'));
 let captured:Record<string,string>={};
 const state={requestId,revision:1,email:'guest@example.test',status:'pending',challengeId:'',expiresAt:'2030-01-01T01:00:00Z',attemptsRemaining:5,nextSendAt:null,deliveryStatus:'pending'};
 const database=new Database(env,async(_url,init)=>{const body=JSON.parse(String(init?.body));assert.equal(body.p_operation,'start');captured=body.p_input;state.challengeId=captured.challengeId;return Response.json({outcome:'created',state});});
 const result=await new ContactVerification(database,env).start(credential,{requestId,revision:1,email:state.email,idempotencyKey:randomUUID()});
 const {code}=new TokenCipher(env).open(captured.encryptedCode,'contact-verification:'+requestId+':'+captured.challengeId) as {code:string};
 assert.match(code,/^[0-9]{6}$/u);assert.equal('code' in captured,false);
 const key=createHmac('sha256',Buffer.from(env.TOKEN_ENCRYPTION_KEY,'base64')).update('contact-verification-code-hash:v1').digest();
 assert.equal(captured.codeHash,createHmac('sha256',key).update(requestId+':'+captured.challengeId+':'+code).digest('hex'));
 assert.deepEqual(result,{outcome:'created',state});assert.doesNotMatch(JSON.stringify(result),/codeHash|encryptedCode|"code"/);
});
