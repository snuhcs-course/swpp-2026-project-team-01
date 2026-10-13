import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {contactSnapshot,contactDiagnosticCategories} from '../contracts/contact-diagnostics.ts';
import {diagnosticArguments,OperatorDiagnostics} from './diagnostics.ts';
import {Database} from '../server/database/client.ts';
const at='2026-10-09T00:00:00Z';
const snapshot=()=>({version:1,scope:'photon_contacts',observedAt:at,ageThresholdSeconds:300,sampleLimit:10,
 coverage:{deviceDelivery:'not_observed',contactSaving:'not_observed',releaseReadiness:'not_assessed'},
 signals:contactDiagnosticCategories.map(category=>({category,count:0,oldestAt:null as string|null,samples:[] as {id:string;since:string}[]}))});
test('contact diagnostic mode is explicit, bounded and separate from existing snapshots',()=>{
 assert.deepEqual(diagnosticArguments(['--project','local','--contacts','--samples','0']),{project:'local',contacts:true,sampleLimit:0});
 for(const args of [['--contacts'],['--project','local','--contacts','--contacts'],['--project','local','--contacts','--rejections'],['--project','local','--contacts','--samples','21']])assert.throws(()=>diagnosticArguments(args));
 const value=snapshot();assert.ok(contactSnapshot.safeParse(value).success);
 for(const patch of [{phone:'+15550100001'},{coverage:{...value.coverage,deviceDelivery:'delivered'}},{signals:[value.signals[0],value.signals[0],value.signals[2]]}])assert.equal(contactSnapshot.safeParse({...value,...patch}).success,false);
 value.signals[0]={category:'aged_contact_shares',count:1,oldestAt:at,samples:[{id:randomUUID(),since:at}]};assert.ok(contactSnapshot.safeParse(value).success);
 assert.equal(contactSnapshot.safeParse({...value,sampleLimit:0}).success,false);value.signals[0].oldestAt=null;assert.equal(contactSnapshot.safeParse(value).success,false);
});
test('contact inspector calls one fixed read-only RPC and rejects mismatched or private output',async()=>{
 const env={SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_SECRET_KEY:'sb_secret_'+'x'.repeat(32)};let calls=0,value:unknown=snapshot();
 const db={async rpc(name:string,input:unknown){calls++;assert.equal(name,'fmat_photon_contact_snapshot');assert.deepEqual(input,{p_sample_limit:10});return value;}} as Database;
 const service=new OperatorDiagnostics(env,db);
 assert.deepEqual(await service.inspect({project:'local',contacts:true}),{project:'local',...snapshot()});
 await assert.rejects(service.inspect({project:'abcdefghijklmnopqrst',contacts:true}));assert.equal(calls,1);
 value={...snapshot(),credential:'private'};await assert.rejects(service.inspect({project:'local',contacts:true}));
 value={...snapshot(),sampleLimit:0};await assert.rejects(service.inspect({project:'local',contacts:true}));
});
