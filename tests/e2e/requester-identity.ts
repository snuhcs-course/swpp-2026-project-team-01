import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {expect,type Browser} from '@playwright/test';
import type {LocalSql} from '../integration/local-sql.ts';
export async function verifyRequesterIdentity(browser:Browser,origin:string,sql:LocalSql,host:string){
 const handle='browser-'+host.slice(0,8),context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/New_York'}),page=await context.newPage();page.setDefaultTimeout(15000);
 let callback='',denied=false,selectedEmail='identity-browser@gmail.com';const hashes:string[]=[],requests:string[]=[];
 try{
  await page.route(/^https:\/\/accounts\.google\.com\//,async route=>{
   const url=new URL(route.request().url());assert.deepEqual(url.searchParams.get('scope')?.split(' '),['openid','email','profile']);assert.equal(url.searchParams.get('access_type'),'online');assert.equal(url.searchParams.get('include_granted_scopes'),'false');assert.equal(url.searchParams.get('prompt'),'select_account');
   const state=url.searchParams.get('state')!;assert.match(state,/^identity\.[A-Za-z0-9_-]{43}$/u);
   const code='identity-fixture.'+Buffer.from(JSON.stringify({subject:selectedEmail,email:selectedEmail,name:'Google Guest',nonce:url.searchParams.get('nonce'),challenge:url.searchParams.get('code_challenge')})).toString('base64url');
   callback=origin+'/connections/google/callback?state='+state+(denied?'&error=access_denied&error_description=private-provider-error':'&code='+code);
   const wrong=await browser.newContext();const rejected=await wrong.request.get(callback,{maxRedirects:0});assert.equal(rejected.headers().location,origin+'/?identity=expired');await wrong.close();
   await route.fulfill({status:302,headers:{location:callback}});
  });
  await page.route('**/api/browser/requester-identity/state?*',route=>route.abort('failed'));
  await page.goto(origin+'/'+handle);await page.getByLabel('Your name',{exact:true}).waitFor();await expect(page.getByText('Saved Google details could not be restored. Try again, or enter your contact details manually.')).toBeVisible();await page.unroute('**/api/browser/requester-identity/state?*');
  const token=(await context.cookies()).find(c=>c.name==='fmat-intake-'+handle)!.value;hashes.push(createHash('sha256').update(token).digest('hex'));
  await page.getByLabel('Your name',{exact:true}).fill('Draft name');await page.getByLabel('Email address',{exact:true}).fill('draft@example.test');await page.getByLabel('What would you like to discuss?').fill('Preserved purpose');await page.getByLabel('Your timezone').fill('Asia/Seoul');
  denied=true;await page.getByRole('button',{name:'Continue with Google',exact:true}).click();await expect(page.getByText('Google identity was not completed. Try again or continue without Google.')).toBeVisible();
  await expect(page.getByLabel('Your name',{exact:true})).toHaveValue('Draft name');await expect(page.getByLabel('Your timezone')).toHaveValue('Asia/Seoul');assert.equal(new URL(page.url()).search,'');assert.equal(await page.getByText('private-provider-error').count(),0);
  denied=false;await page.getByRole('button',{name:'Continue with Google',exact:true}).click();await expect(page.getByLabel('Your name',{exact:true})).toHaveValue('Google Guest');await expect(page.getByLabel('Email address',{exact:true})).toHaveValue(selectedEmail);await expect(page.getByLabel('What would you like to discuss?')).toHaveValue('Preserved purpose');await expect(page.getByLabel('Your timezone')).toHaveValue('Asia/Seoul');
  await expect(page.getByText('Google verified this address. Review it before continuing.')).toBeVisible();
  assert.equal((await context.request.get(callback,{maxRedirects:0})).headers().location,origin+'/?identity=expired');
  await page.reload();await expect(page.getByLabel('Your timezone')).toHaveValue('Asia/Seoul');await expect(page.getByLabel('Email address',{exact:true})).toHaveValue(selectedEmail);
  selectedEmail='third-party@example.test';await page.getByRole('button',{name:'Use another Google account',exact:true}).click();await expect(page.getByLabel('Email address',{exact:true})).toHaveValue(selectedEmail);await expect(page.getByText(/This address needs an email code/)).toBeVisible();
  await page.getByRole('button',{name:'Continue without Google',exact:true}).click();await expect(page.getByLabel('Your name',{exact:true})).toBeFocused();await expect(page.getByText(/This address needs an email code/)).toBeVisible();
  selectedEmail='switched-browser@gmail.com';await page.getByRole('button',{name:'Continue with Google',exact:true}).click();await expect(page.getByLabel('Email address',{exact:true})).toHaveValue(selectedEmail);
  await page.getByLabel('Your name',{exact:true}).fill('My preferred name');await page.getByLabel('Email address',{exact:true}).fill('alternate-browser@gmail.com');await expect(page.getByText(/This address needs an email code/)).toBeVisible();
  await page.setViewportSize({width:320,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.local/rebuild/browser-screenshots/identity-intake-mobile.png',fullPage:true});
  await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>{document.documentElement.style.zoom='2';});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.local/rebuild/browser-screenshots/identity-intake-zoom.png',fullPage:true});await page.evaluate(()=>{document.documentElement.style.zoom='';});
  await page.getByRole('button',{name:'Continue to my conversation'}).click();await page.waitForURL('**/booking/*');const id=new URL(page.url()).pathname.split('/').pop()!;requests.push(id);
  assert.equal(await sql.query(`select contact_verified_email is null and details->>'requesterName'='My preferred name' from fmat.requests where id='${id}';`),'t');
  const google=page.getByRole('region',{name:'Optional Google contact',exact:true});await google.getByRole('button',{name:'Continue with Google',exact:true}).waitFor();selectedEmail='alternate-browser@gmail.com';
  await google.getByRole('button',{name:'Continue with Google',exact:true}).click();await google.getByRole('button',{name:'Use verified Google email',exact:true}).waitFor();
  assert.equal(await sql.query(`select contact_verified_email is null from fmat.requests where id='${id}';`),'t','callback does not apply proof automatically');
  await page.setViewportSize({width:320,height:844});await google.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'.local/rebuild/browser-screenshots/identity-request-mobile.png',fullPage:true});await page.setViewportSize({width:1280,height:900});
  let lost=false;await page.route('**/api/browser/requester-identity/apply',async route=>{await route.fetch();lost=true;await route.abort('failed');});
  await google.getByRole('button',{name:'Use verified Google email',exact:true}).click();await expect(google.getByRole('alert')).toBeVisible();await page.unroute('**/api/browser/requester-identity/apply');await google.getByRole('button',{name:'Retry Google contact verification',exact:true}).click();
  await page.getByText('Your contact email is verified.',{exact:true}).waitFor();assert.equal(lost,true);assert.equal(await sql.query(`select count(*) from fmat.audit_events where subject_id='${id}' and operation='google_contact_verified';`),'1');
  assert.equal((await context.request.get(origin+'/api/browser/host/state')).status(),401);assert.equal(await sql.query(`select count(*) from fmat.calendar_connections where principal_kind='guest' and principal_id='${id}';`),'0');
  assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
  const state=await context.request.get(origin+'/api/browser/requester-identity/state?kind=guest&requestId='+id);assert.equal(state.status(),200);assert.match(state.headers()['cache-control'],/no-store/);assert.ok(!JSON.stringify(await state.json()).includes('subject'));
  for(const operation of ['start','skip','apply'])assert.equal((await context.request.post(origin+'/api/browser/requester-identity/'+operation,{headers:{origin:'https://wrong.test'},data:{target:{kind:'guest',requestId:id}}})).status(),403);
 }finally{
  await context.close();
  for(const id of requests)await sql.query(`delete from fmat.runtime_messages where conversation_id in(select id from fmat.conversation_scopes where request_id='${id}');delete from fmat.conversation_grants where conversation_id in(select id from fmat.conversation_scopes where request_id='${id}');delete from fmat.conversation_scopes where request_id='${id}';delete from fmat.request_history where request_id='${id}';delete from fmat.audit_events where subject_id='${id}';delete from fmat.requests where id='${id}';`);
  for(const hash of hashes)await sql.query(`delete from fmat.requester_identity_flows where token_hash='${hash}';delete from fmat.idempotency where actor_scope='public:${hash}';`);
 }
}
