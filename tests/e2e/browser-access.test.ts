import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID,createHash,randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {LocalSql} from '../integration/local-sql.ts';

test('browser access verifies email, invitation, logout, and request cookies without leaking credentials', {timeout:180000}, async()=>{
  const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  assert.ok(['localhost','127.0.0.1'].includes(new URL(local.API_URL).hostname));
  const origin='http://localhost:3000';
  const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','apps/web','-p','3000'],{env:{...process.env,APP_ORIGIN:origin,SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY},stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',v=>log+=v);child.stderr.on('data',v=>log+=v);
  const sql=new LocalSql();const email=`browser-${randomUUID()}@example.test`,invitation=randomUUID(),requestId=randomUUID();
  const token=randomBytes(32).toString('base64url'),code='ABCDEFGHIJKLMNOP';let userId:string|undefined,callback='';
  const browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1280,height:900}});const page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(20000);
  page.on('request',request=>{if(request.url().startsWith(origin+'/auth/callback?code='))callback=request.url();});
  const adminHeaders={apikey:local.SERVICE_ROLE_KEY,authorization:'Bearer '+local.SERVICE_ROLE_KEY,'content-type':'application/json'};
  await mkdir('.local/rebuild/browser-screenshots',{recursive:true});
  try {
    for(let i=0;i<100;i++){assert.equal(child.exitCode,null,log.slice(-2000));try{if((await fetch(origin+'/api/health')).ok)break;}catch{}await delay(100);}
    await page.goto(origin+'/app');await page.getByLabel('Email address').waitFor();
    await page.keyboard.press('Tab');assert.equal(await page.getByRole('link',{name:'Find Me a Time'}).evaluate(e=>e===document.activeElement),true);
    await page.keyboard.press('Tab');assert.equal(await page.getByLabel('Email address').evaluate(e=>e===document.activeElement),true);
    await page.keyboard.press('Tab');assert.equal(await page.getByRole('button',{name:'Email me a sign-in link'}).evaluate(e=>e===document.activeElement),true);
    assert.notEqual(await page.getByRole('button',{name:'Email me a sign-in link'}).evaluate(e=>getComputedStyle(e).outlineStyle),'none');
    await page.screenshot({path:'.local/rebuild/browser-screenshots/host-desktop.png',fullPage:true});
    const csrf=await context.request.post(origin+'/api/browser/auth/start',{headers:{origin:'https://wrong.test'},data:{email}});assert.equal(csrf.status(),403);
    await page.getByLabel('Email address').fill(email);await page.getByRole('button',{name:'Email me a sign-in link'}).click();
    await page.getByRole('status').filter({hasText:'Check your email'}).waitFor();
    let link='';
    for(let n=0;n<50;n++){
      const list=await fetch(local.MAILPIT_URL+'/api/v1/messages').then(r=>r.json());
      const found=list.messages.find((m:{To:{Address:string}[]})=>m.To.some(to=>to.Address===email));
      if(found){const mail=await fetch(local.MAILPIT_URL+'/api/v1/message/'+found.ID).then(r=>r.json());link=mail.Text.match(/https?:\/\/[^\s<>]+\/auth\/v1\/verify[^\s<>]+/u)?.[0]??'';if(link)break;}await delay(100);
    }
    assert.ok(link,'Local Auth email contains a sign-in link');
    await page.goto(link);await page.getByRole('heading',{name:'Your invitation, please.'}).waitFor();
    const row=await sql.query(`select id from auth.users where email='${email}';`);assert.match(row,/^[a-f0-9-]{36}$/u);userId=row;
    await sql.query(`insert into fmat.invitations(id,email,token_hash,expires_at,issued_by) values('${invitation}','${email}','${createHash('sha256').update(code).digest('hex')}',now()+interval '1 day','browser-test');`);
    await page.getByLabel('Invitation code').fill('ZZZZ-ZZZZ-ZZZZ-ZZZZ');await page.getByRole('button',{name:'Use invitation'}).click();await page.getByRole('alert').filter({hasText:'This invitation cannot be used'}).waitFor();
    await page.getByLabel('Invitation code').fill('ABCD-EFGH-IJKL-MNOP');await page.getByRole('button',{name:'Use invitation'}).click();await page.getByRole('heading',{name:'Host access confirmed'}).waitFor();
    await page.reload();await page.getByRole('heading',{name:'Host access confirmed'}).waitFor();
    assert.equal(await page.evaluate(()=>document.cookie),'');
    const cookies=await context.cookies();assert.ok(cookies.some(c=>c.name.startsWith('fmat-auth')&&c.httpOnly&&c.sameSite==='Lax'));
    const hostResponse=await context.request.get(origin+'/api/browser/host/state');assert.equal(hostResponse.status(),200);assert.match(hostResponse.headers()['cache-control'],/private.*no-store/u);
    const copied=await browser.newContext();await copied.addCookies(cookies);
    await page.getByRole('button',{name:'Sign out'}).click();await page.getByLabel('Email address').waitFor();
    assert.equal((await context.request.get(origin+'/api/browser/host/state')).status(),401);
    assert.equal((await copied.request.get(origin+'/api/browser/host/state')).status(),401,'Logout invalidates a copied, unexpired session');await copied.close();
    assert.ok(callback);const replay=await context.request.get(callback,{maxRedirects:0});assert.equal(replay.status(),303);assert.equal(replay.headers().location,origin+'/app?auth=expired');
    const forged=await browser.newContext();await forged.addCookies([{name:'fmat-auth',value:'base64-forged',url:origin}]);assert.equal((await forged.request.get(origin+'/api/browser/host/state')).status(),401);await forged.close();
    await sql.query(`insert into fmat.requests(id,host_id,details,token_hash,expires_at) values('${requestId}','${userId}','{"purpose":"A protected discussion"}','${createHash('sha256').update(token).digest('hex')}',now()+interval '1 day');`);
    await page.goto(origin+'/booking/'+requestId);await page.getByRole('heading',{name:'This link is private.'}).waitFor();
    await page.goto(origin+'/booking/'+requestId+'#token='+token);await page.getByRole('heading',{name:'A protected discussion'}).waitFor();
    assert.equal(new URL(page.url()).hash,'');assert.equal(await page.evaluate(()=>document.cookie),'');
    await page.reload();await page.getByRole('heading',{name:'A protected discussion'}).waitFor();
    const guestResponse=await context.request.get(origin+'/api/browser/guest/state?requestId='+requestId);assert.match(guestResponse.headers()['cache-control'],/private.*no-store/u);
    assert.ok((await context.cookies()).some(c=>c.name==='fmat-request-'+requestId&&c.httpOnly&&c.sameSite==='Lax'));
    const other=await browser.newContext();const denied=await other.request.get(origin+'/api/browser/guest/state?requestId='+requestId);assert.equal(denied.status(),401);await other.close();
    await sql.query(`update fmat.requests set status='declined',token_revoked_at=now() where id='${requestId}';`);
    await page.reload();await page.getByRole('heading',{name:'Meeting status'}).waitFor();assert.equal(await page.getByText('A protected discussion').count(),0);
    await page.setViewportSize({width:390,height:844});await page.goto(origin+'/app');await page.getByLabel('Email address').waitFor();
    await page.screenshot({path:'.local/rebuild/browser-screenshots/host-mobile.png',fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.setViewportSize({width:320,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>{document.documentElement.style.zoom='2';});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:'.local/rebuild/browser-screenshots/host-css-zoom-200.png',fullPage:true});
    await page.evaluate(()=>{document.documentElement.style.zoom='';});await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'Not invited yet? Join the waitlist'}).click();await page.getByLabel('Email address').fill(email);await page.getByRole('button',{name:'Join the waitlist',exact:true}).click();await page.getByRole('status').filter({hasText:'You’re on the list'}).waitFor();
    assert.equal(await sql.query(`select count(*) from fmat.waitlist where email='${email}';`),'1');
    const repeated=await context.request.post(origin+'/api/browser/waitlist',{headers:{origin},data:{email:' '+email.toUpperCase()+' ',name:'',idempotencyKey:randomUUID()}});assert.equal(repeated.status(),200);
    assert.equal(await sql.query(`select count(*) from fmat.waitlist where email='${email}';`),'1');
  }finally{
    await page.screenshot({path:'.local/rebuild/browser-screenshots/last-state.png',fullPage:true}).catch(()=>{});
    await browser.close();if(child.exitCode===null){const closed=once(child,'close');child.kill('SIGTERM');await closed;}await writeFile('.local/rebuild/browser-server.log',log);
    userId ||= await sql.query(`select id from auth.users where email='${email}';`);
    const cleanupId=userId||'00000000-0000-4000-8000-000000000000';
    await sql.query(`delete from fmat.request_history where request_id='${requestId}';delete from fmat.requests where id='${requestId}';delete from fmat.idempotency where actor_scope='host:${cleanupId}' or input->>'email'='${email}';delete from fmat.audit_events where subject_id in ('${cleanupId}','${invitation}');delete from fmat.hosts where id='${cleanupId}';delete from fmat.invitations where id='${invitation}';delete from fmat.waitlist where email='${email}';`).finally(()=>sql.close());
    if(userId)await fetch(local.API_URL+'/auth/v1/admin/users/'+userId,{method:'DELETE',headers:adminHeaders});
  }
});
