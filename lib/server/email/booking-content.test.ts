import test from 'node:test';
import assert from 'node:assert/strict';
import {bookingEmail} from './booking-content.ts';
const receipt={confirmedAt:'2030-01-01T00:00:00Z',title:'Planning <meeting>',purpose:'Discuss <script>alert("x")</script> & decisions',start:'2030-01-02T10:00:00Z',end:'2030-01-02T10:30:00Z',timezone:'Asia/Seoul',mode:'online',location:'https://meet.example.test/room',participants:[{email:'guest@example.test'},{email:'host@example.test'}],calendarUrl:null,organizer:{email:'calendar-owner@example.test'}};
const input={id:'00000000-0000-4000-8000-000000000001',accountId:'a'.repeat(32),to:'guest@example.test',receipt,viewUrl:'https://release.findmeatime.com/booking/fixture#receipt=synthetic'};
test('Confirmation contains shared details and actual organizer in HTML and plain text',()=>{
 const {message}=bookingEmail(input);
 for(const value of ['Asia/Seoul','30 minutes','calendar-owner@example.test','guest@example.test','host@example.test',receipt.location,input.viewUrl]){assert.ok(message.text.includes(value));assert.ok(message.html.includes(value));}
 assert.equal(message.from,'no-reply@findmeatime.com');assert.ok(message.text.includes(receipt.purpose));
 assert.ok(!message.html.includes('<script>'));assert.ok(message.html.includes('&lt;script&gt;'));assert.ok(message.html.includes('&amp; decisions'));
 assert.ok(message.text.includes('7:00 PM'));assert.ok(message.html.includes('Join meeting'));
});
test('Physical receipt has a location without a join action and subject cannot inject headers',()=>{
 const {message}=bookingEmail({...input,receipt:{...receipt,title:'Planning\r\nmeeting',mode:'in_person',location:'Room A'}});
 assert.ok(message.text.includes('Location: Room A'));assert.ok(!message.text.includes('Join meeting:'));assert.ok(!message.html.includes('>Join meeting<'));assert.equal(message.subject,'Confirmed: Planning meeting');
});
test('Missing organizer, unsafe receipt link and private fields fail closed',()=>{
 assert.throws(()=>bookingEmail({...input,receipt:{...receipt,organizer:null}}));
 for(const viewUrl of ['http://example.test','javascript:alert(1)','https://user:password@example.test'])assert.throws(()=>bookingEmail({...input,viewUrl}));
 assert.throws(()=>bookingEmail({...input,receipt:{...receipt,privateNotes:'secret'}}));
});
