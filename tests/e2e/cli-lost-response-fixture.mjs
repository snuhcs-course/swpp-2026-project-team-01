// One controlled client-side response loss after the actual server commit.
const originalFetch=globalThis.fetch;let lost=false;
globalThis.fetch=async(input,init)=>{
 const request=new Request(input,init),body=request.method==='POST'?await request.clone().text():'';
 const response=await originalFetch(input,init);
 if(!lost&&new URL(request.url).pathname==='/mcp'&&body.includes('fmat_create_request')){lost=true;await response.clone().arrayBuffer();throw Error('Synthetic lost CLI response');}
 return response;
};
