import test from 'node:test';import assert from 'node:assert/strict';
import {bookingJoinUrl,confirmedBookingReceipt,bookingReceiptState} from './booking-receipt.ts';
const receipt={confirmedAt:'2030-01-01T00:00:00Z',title:'Meeting',purpose:'Discussion',start:'2030-01-02T10:00:00Z',end:'2030-01-02T10:30:00Z',timezone:'UTC',mode:'online' as const,location:'https://meet.example.test/room',participants:[{email:'guest@example.test'}],calendarUrl:null};
test('Receipt joining links cannot execute scripts, disclose URL credentials or turn a physical location into a join action',()=>{
 assert.equal(bookingJoinUrl(receipt),receipt.location);
 for(const location of ['javascript:alert(1)','data:text/html,test','http://meet.example.test','https://user:secret@meet.example.test','/relative'])assert.equal(bookingJoinUrl({...receipt,location}),null);
 assert.equal(bookingJoinUrl({...receipt,mode:'in_person'}),null);
});
test('Receipt accepts only the shared projection and a genuine Google Calendar link',()=>{
 assert.equal(confirmedBookingReceipt.safeParse({...receipt,privateNotes:'secret'}).success,false);
 for(const calendarUrl of ['https://www.google.com.evil.test/calendar/event','https://user@www.google.com/calendar/event','javascript:alert(1)'])assert.equal(confirmedBookingReceipt.safeParse({...receipt,calendarUrl}).success,false);
 assert.equal(confirmedBookingReceipt.safeParse({...receipt,calendarUrl:'https://www.google.com/calendar/event?eid=fixture'}).success,true);
 assert.equal(bookingReceiptState.safeParse({requestId:'00000000-0000-4000-8000-000000000001',revision:1,status:'booking',closed:false,receipt:null,emailStatus:'delivered'}).success,false);
});
