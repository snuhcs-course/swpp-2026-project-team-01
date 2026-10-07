// Shared only by the deterministic local model and browser fixture.
export const describedPreferences='I prefer either online or in-person meetings at Library lounge. I take public transit and want 20 extra minutes around travel. Weekdays from 13:00 to 17:00 in Asia/Seoul, 30 minutes per meeting and a 10-minute meeting buffer.';
export const describedReply='I put your described preferences in the private draft. Review the extracted answers, then confirm your exact settings.';
export const describedRules={timezone:'Asia/Seoul',durationMinutes:30,availability:[{days:[1,2,3,4,5],start:'13:00',end:'17:00'}],bufferMinutes:10,focusBlocks:[],preferences:'',meetingMode:'either',locationPolicy:'preferred',locations:['Library lounge'],travelMode:'TRANSIT',travelBufferMinutes:20};
