// Loaded only by the isolated browser-test server. Production has no fixture switch.
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.origin==='https://www.googleapis.com'&&url.pathname==='/calendar/v3/users/me/calendarList'){
    const headers=new Headers(init?.headers??(input instanceof Request?input.headers:undefined));
    if(headers.get('authorization')!=='Bearer browser-calendar-fixture')return new Response(null,{status:401});
    return Response.json({items:[
      {id:'personal@example.test',summary:'My calendar',accessRole:'owner',primary:true,timeZone:'Asia/Seoul'},
      {id:'readonly@example.test',summary:'My calendar',accessRole:'reader',timeZone:'America/New_York'},
    ]});
  }
  return originalFetch(input,init);
};
