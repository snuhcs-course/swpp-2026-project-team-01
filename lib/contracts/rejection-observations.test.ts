import test from 'node:test';
import assert from 'node:assert/strict';
import {rejectionCategory,rejectionSnapshot} from './rejection-observations.ts';

const fixture=()=>({version:1,scope:'database_rpc',delivery:'best_effort',observedAt:'2026-10-09T04:30:00Z',windowStart:'2026-10-08T05:00:00Z',hourlyBuckets:24,bucketLimit:1_000_000,partialCurrentHour:true,
 coverage:{preDatabaseDenials:'not_recorded',uncategorizedRejections:'not_recorded',releaseReadiness:'not_assessed'},
 signals:[{category:'authorization_denied',count:1,lastSeenAt:'2026-10-09T04:15:00Z',saturated:false},{category:'stale_action',count:0,lastSeenAt:null,saturated:false}]});
test('rejection snapshot accepts only bounded observations with explicit incomplete coverage',()=>{
 assert.equal(rejectionSnapshot.safeParse(fixture()).success,true);
 for(const patch of [{delivery:'complete'},{partialCurrentHour:false},{hourlyBuckets:25},{bucketLimit:2},{scope:'all_requests'},{privateText:'secret'},{windowStart:'2026-10-08T05:01:00Z'},{windowStart:'2026-10-08T04:00:00Z'},{windowStart:'2026-10-09T04:00:00Z'}])assert.equal(rejectionSnapshot.safeParse({...fixture(),...patch}).success,false);
 assert.equal(rejectionSnapshot.safeParse({...fixture(),coverage:{...fixture().coverage,preDatabaseDenials:'recorded'}}).success,false);
 assert.equal(rejectionCategory.safeParse('private-error-text').success,false);
});
test('rejection counts cannot masquerade as absent, unbounded or saturated observations',()=>{
 for(const patch of [{count:-1},{count:1.1},{count:24_000_001},{count:0},{lastSeenAt:null},{lastSeenAt:'2026-10-09T05:00:00Z'},{lastSeenAt:'2026-10-08T04:59:59Z'},{saturated:true},{category:'stale_action'},{email:'secret@example.test'}])assert.equal(rejectionSnapshot.safeParse({...fixture(),signals:[{...fixture().signals[0],...patch},fixture().signals[1]]}).success,false);
 assert.equal(rejectionSnapshot.safeParse({...fixture(),signals:[{...fixture().signals[0],count:1_000_000,saturated:true},fixture().signals[1]]}).success,true);
 assert.equal(rejectionSnapshot.safeParse({...fixture(),signals:[...fixture().signals,...fixture().signals]}).success,false);
});
