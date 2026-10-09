// Test-only preload for the built server; no production configuration switch.
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const url=new URL(input instanceof Request?input.url:String(input));
 if(url.hostname==='www.googleapis.com'){
  const headers=new Headers(init?.headers??(input instanceof Request?input.headers:undefined));
  if(url.pathname!=='/calendar/v3/users/me/calendarList'||headers.get('authorization')!=='Bearer intake-browser-fixture')throw Error('Unexpected Google request in intake fixture');
  return Response.json({items:[{id:'private-calendar',summary:'Private calendar title',accessRole:'owner',timeZone:'Asia/Seoul'}]});
 }
 return originalFetch(input,init);
};
