import {test} from 'node:test';
import assert from 'node:assert/strict';
import {intervalLabel,readTimezonePreference,saveTimezonePreference,timezonePreferenceKey} from './timezone-preference.ts';
test('Display offsets follow the instant across DST and conversions preserve input instants',()=>{
 const start='2030-03-10T06:30:00Z',end='2030-03-10T07:30:00Z';
 const ny=intervalLabel(start,end,'America/New_York');assert.match(ny,/GMT-5/);assert.match(ny,/GMT-4/);
 assert.match(intervalLabel(start,end,'Asia/Seoul'),/GMT\+9/);
 assert.equal(start,'2030-03-10T06:30:00Z');assert.match(intervalLabel(start,end,''),/Choose an IANA/);
});
test('Preference persists only a zone; invalid or cleared input requires clarification and blocked storage is recoverable',()=>{
 const values=new Map<string,string>();const original=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
 try{
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)}});
  assert.equal(readTimezonePreference(),null);assert.equal(saveTimezonePreference('Asia/Seoul'),true);assert.equal(readTimezonePreference(),'Asia/Seoul');
  assert.deepEqual([...values],[[timezonePreferenceKey,'Asia/Seoul']]);
  saveTimezonePreference('Unknown/Zone');assert.equal(readTimezonePreference(),'');saveTimezonePreference('');assert.equal(readTimezonePreference(),'');
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,get(){throw new Error('Unavailable');}});
  assert.equal(readTimezonePreference(),null);assert.equal(saveTimezonePreference('UTC'),false);
 }finally{if(original)Object.defineProperty(globalThis,'sessionStorage',original);else Reflect.deleteProperty(globalThis,'sessionStorage');}
});
