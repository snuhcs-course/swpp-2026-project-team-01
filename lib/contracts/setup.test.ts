import {test} from 'node:test';
import assert from 'node:assert/strict';
import {draftInput,confirmSetupInput,setupPatch,weeklyWindow} from './setup.ts';
import {conversationTool} from './conversation-tools.ts';
test('setup drafts accept bounded partial preferences and reject hidden authority or malformed weekly times',()=>{
 assert.ok(draftInput.safeParse({expectedRevision:0,patch:{rules:{meetingMode:'online'}},unresolved:[]}).success);
 for(const patch of [{},{hostId:'other'},{rules:{approved:true}},{rules:{bufferMinutes:-1}},{rules:{availability:[{days:[7],start:'13:00',end:'14:00'}]}}])assert.equal(setupPatch.safeParse(patch).success,false);
 assert.equal(weeklyWindow.safeParse({days:[1],start:'17:00',end:'13:00'}).success,false);
 assert.equal(draftInput.safeParse({expectedRevision:0,patch:{displayName:'Name'},unresolved:[],provenance:'host'}).success,false);
});
test('model can propose setup but cannot confirm and browser confirmation requires explicit current identifiers',()=>{
 assert.ok(conversationTool.safeParse({operation:'setup_draft',input:{expectedRevision:0,patch:{displayName:'Name'},unresolved:[]}}).success);
 assert.equal(conversationTool.safeParse({operation:'setup_confirm',input:{confirmed:true}}).success,false);
 assert.equal(confirmSetupInput.safeParse({confirmed:true}).success,false);
});
