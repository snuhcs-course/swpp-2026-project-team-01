import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localTimeToInstant,instantToLocalTime} from './availability-time.ts';
test('Manual local times use the chosen IANA zone and reject ambiguous or nonexistent DST times',()=>{
 assert.equal(localTimeToInstant('2030-01-02T09:30','Asia/Seoul'),'2030-01-02T00:30:00Z');
 assert.equal(instantToLocalTime('2030-01-02T00:30:00Z','Asia/Seoul'),'2030-01-02T09:30');
 assert.throws(()=>localTimeToInstant('2030-03-10T02:30','America/New_York'),/clock change/);
 assert.throws(()=>localTimeToInstant('2030-11-03T01:30','America/New_York'),/clock change/);
 assert.throws(()=>localTimeToInstant('2030-01-02T09:30','Unknown/Zone'),/timezone/);
});
