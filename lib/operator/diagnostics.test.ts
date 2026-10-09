import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnosticCategories,diagnosticInput,operationalSnapshot,type OperationalSnapshot} from '../contracts/operational-diagnostics.ts';
import {operatorConfiguration} from './configuration.ts';
const at='2026-10-09T00:00:00+00:00',id='11111111-1111-4111-8111-111111111111';
const snapshot=():OperationalSnapshot=>({version:1,observedAt:at,ageThresholdSeconds:300,sampleLimit:10,coverage:{authorizationDenialEvents:'not_recorded',rejectedStaleActionEvents:'not_recorded',releaseReadiness:'not_assessed'},signals:diagnosticCategories.map(category=>({category,count:0,oldestAt:null,samples:[] as {id:string;since:string}[]}))});
test('diagnostic input requires an explicit project and bounded integer sample limit',()=>{
 assert.deepEqual(diagnosticInput.parse({project:'local'}),{project:'local',sampleLimit:10});
 for(const sampleLimit of [0,20])assert.ok(diagnosticInput.safeParse({project:'local',sampleLimit}).success);
 for(const input of [{},{project:'LOCAL'},{project:'https://example.test'},{project:'local',sampleLimit:null},{project:'local',sampleLimit:-1},{project:'local',sampleLimit:21},{project:'local',sampleLimit:1.5},{project:'local',sampleLimit:'10'},{project:'local',query:'select private'}])assert.equal(diagnosticInput.safeParse(input).success,false);
});
test('strict snapshot rejects extra private fields, unknown coverage and omitted or duplicate categories',()=>{
 assert.ok(operationalSnapshot.safeParse(snapshot()).success);
 for(const mutate of [(v:any)=>v.privateText='secret',(v:any)=>v.signals[0].payload={secret:true},(v:any)=>v.signals[0].category='private_kind',(v:any)=>v.signals.pop(),(v:any)=>v.signals[1].category=v.signals[0].category,(v:any)=>v.coverage.authorizationDenialEvents=0]){const v=snapshot();mutate(v);assert.equal(operationalSnapshot.safeParse(v).success,false);}
});
test('snapshot enforces count, oldest timestamp, sample bounds and deterministic ordering',()=>{
 const v=snapshot();v.signals[0]={category:'overdue_jobs',count:1,oldestAt:at,samples:[{id,since:at}]} as typeof v.signals[0];assert.ok(operationalSnapshot.safeParse(v).success);
 for(const mutate of [(x:any)=>x.signals[0].count=0,(x:any)=>x.signals[0].oldestAt=null,(x:any)=>x.sampleLimit=0,(x:any)=>x.signals[0].samples.push({id,since:at}),(x:any)=>x.signals[0].samples[0].since='2026-10-08T00:00:00Z',(x:any)=>x.signals[0].samples[0].token='secret']){const x=structuredClone(v);mutate(x);assert.equal(operationalSnapshot.safeParse(x).success,false);}
});
test('operator configuration binds remote and local origins before credential use',()=>{
 const project='abcdefghijklmnopqrst',env={SUPABASE_URL:`https://${project}.supabase.co`,SUPABASE_SECRET_KEY:'sb_secret_'+'x'.repeat(32)};
 operatorConfiguration(project,env);operatorConfiguration('local',{...env,SUPABASE_URL:'http://127.0.0.1:54321'});
 for(const url of ['http://'+project+'.supabase.co','https://'+project+'.supabase.co/path','https://'+project+'.supabase.co.attacker.test','https://'+project+'.supabase.co:444'])assert.throws(()=>operatorConfiguration(project,{...env,SUPABASE_URL:url}));
 for(const key of ['','sb_publishable_'+'x'.repeat(32),'e30.'+Buffer.from('{"role":"authenticated"}').toString('base64url')+'.signature'])assert.throws(()=>operatorConfiguration(project,{...env,SUPABASE_SECRET_KEY:key}));
 assert.throws(()=>operatorConfiguration('local',env));assert.throws(()=>operatorConfiguration('wrongprojectabcdefgh',env));
});
