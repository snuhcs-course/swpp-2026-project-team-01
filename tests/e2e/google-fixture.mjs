// Loaded only by the isolated browser-test server. Production has no fixture switch.
const originalFetch=globalThis.fetch;
let unavailableReads=0;
globalThis.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.origin==='https://spectrum.photon.codes'){
    if(url.pathname!==`/projects/${process.env.PHOTON_PROJECT_ID}/imessage/tokens`)return new Response(null,{status:401});
    return Response.json({succeed:true,data:{type:'shared',token:'browser-photon-fixture',expiresIn:300}});
  }
  if(url.origin==='https://www.googleapis.com'&&url.pathname==='/calendar/v3/users/me/calendarList'){
    const headers=new Headers(init?.headers??(input instanceof Request?input.headers:undefined));
    if(!['Bearer browser-calendar-fixture','Bearer browser-requester-fixture'].includes(headers.get('authorization')))return new Response(null,{status:401});
    return Response.json({items:[
      {id:'personal@example.test',summary:'My calendar',accessRole:'owner',primary:true,timeZone:'Asia/Seoul'},
      {id:'readonly@example.test',summary:'My calendar',accessRole:'reader',timeZone:'America/New_York'},
      {id:'unavailable@example.test',summary:'Temporarily unavailable',accessRole:'reader'},
    ]});
  }
  if(url.origin==='https://www.googleapis.com'&&url.pathname.endsWith('/events')){
    if(new Headers(init?.headers).get('authorization')!=='Bearer browser-calendar-fixture')return new Response(null,{status:401});
    if(decodeURIComponent(url.pathname).includes('unavailable@example.test'))return new Response(null,{status:503});
    const start=new Date(url.searchParams.get('timeMin'));
    return Response.json({timeZone:'Asia/Seoul',accessRole:'owner',items:Array.from({length:8},(_,i)=>({id:'instance-'+i,start:{dateTime:new Date(start.getTime()+(i+1)*86400000+9*3600000).toISOString()},end:{dateTime:new Date(start.getTime()+(i+1)*86400000+10*3600000).toISOString()},location:'Library meeting room'}))});
  }
  if(url.origin==='https://www.googleapis.com'&&url.pathname==='/calendar/v3/freeBusy'){
    if(new Headers(init?.headers).get('authorization')!=='Bearer browser-requester-fixture')return new Response(null,{status:401});
    const body=JSON.parse(init.body);return Response.json({timeMin:body.timeMin,timeMax:body.timeMax,calendars:Object.fromEntries(body.items.map(({id})=>[id,id==='unavailable@example.test'&&++unavailableReads%2===1?{errors:[{reason:'internalError'}],busy:[]}:{busy:[]}]))});
  }
  return originalFetch(input,init);
};
