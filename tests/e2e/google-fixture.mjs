// Loaded only by the isolated browser-test server. Production has no fixture switch.
const originalFetch=globalThis.fetch;
let unavailableReads=0;
globalThis.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.origin==='https://api.openai.com'){
    if(url.pathname!=='/v1/responses'||new Headers(init?.headers).get('authorization')!=='Bearer browser-ranking-fixture')return new Response(null,{status:401});
    const body=JSON.parse(init.body);
    if(body.tool_choice?.name!=='rank_candidates')return new Response(null,{status:400});
    const input=body.input.find(item=>item.role==='user');
    const values=JSON.parse(typeof input.content==='string'?input.content:input.content.find(item=>item.type==='input_text').text);
    if(Object.keys(values).sort().join(',')!=='candidates,timezone'||values.candidates.some(c=>Object.keys(c).sort().join(',')!=='id,interval'))throw new Error('Ranking leaked private fields');
    return Response.json({id:'resp_browser_ranking',object:'response',created_at:Math.floor(Date.now()/1000),model:'gpt-6-luna',status:'completed',error:null,incomplete_details:null,output:[{id:'fc_browser_ranking',call_id:'call_browser_ranking',type:'function_call',name:'rank_candidates',arguments:JSON.stringify({orderedIds:values.candidates.map(c=>c.id)}),status:'completed'}],usage:{input_tokens:10,output_tokens:10,total_tokens:20,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}});
  }
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
    if(!['Bearer browser-requester-fixture','Bearer browser-calendar-fixture'].includes(new Headers(init?.headers).get('authorization')))return new Response(null,{status:401});
    const body=JSON.parse(init.body);return Response.json({timeMin:body.timeMin,timeMax:body.timeMax,calendars:Object.fromEntries(body.items.map(({id})=>[id,id==='unavailable@example.test'&&++unavailableReads%2===1?{errors:[{reason:'internalError'}],busy:[]}:{busy:[]}]))});
  }
  return originalFetch(input,init);
};
