import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyTranscript,reduceConversation} from './conversation-state.ts';

test('replay keeps chronological user and assistant messages, deduplicates cursors, and replaces final blocks',()=>{
  let state=emptyTranscript();
  state=reduceConversation(state,{type:'user',cursor:1,turnId:'one',sequence:1,text:'First question'});
  state=reduceConversation(state,{type:'text',cursor:2,turnId:'one',stepIndex:0,text:'Partial'});
  assert.equal(reduceConversation(state,{type:'text',cursor:2,turnId:'one',text:'Partial'}),state);
  state=reduceConversation(state,{type:'message',cursor:3,turnId:'one',stepIndex:0,text:'Complete answer'});
  state=reduceConversation(state,{type:'user',cursor:4,turnId:'two',sequence:2,text:'Follow-up'});
  state=reduceConversation(state,{type:'message',cursor:5,turnId:'two',stepIndex:0,text:'Second answer'});
  assert.deepEqual(state.messages.map(m=>[m.role,m.text]),[['user','First question'],['assistant','Complete answer'],['user','Follow-up'],['assistant','Second answer']]);
  assert.equal(state.cursor,5);
});

test('hidden events advance replay and failure ends working without discarding saved history',()=>{
  let state=reduceConversation(emptyTranscript(),{type:'turn.started',cursor:1});
  assert.equal(state.working,true);
  state=reduceConversation(state,{type:'message',cursor:2,turnId:'one',text:'Saved'});
  state=reduceConversation(state,{type:'cursor',cursor:3});
  state=reduceConversation(state,{type:'failed',cursor:4});
  assert.equal(state.working,false);assert.equal(state.cursor,4);assert.equal(state.messages[0].text,'Saved');
  assert.throws(()=>reduceConversation(state,{type:'text',cursor:5,turnId:'one',text:'x'.repeat(200_001)}));
});
