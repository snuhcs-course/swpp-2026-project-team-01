import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

// Tests built production servers without credentials or a model call. Keep the
// default runtime routes closed and custom routes authenticated.
const children = [];
let databaseTrap;
async function unusedPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function start(args, port, health, environment = {}) {
  const child = spawn(process.execPath, args, {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port),
      APP_ORIGIN:`http://127.0.0.1:${port}`, SUPABASE_URL:'http://127.0.0.1:1', SUPABASE_PUBLISHABLE_KEY:'synthetic-public-key',
      HOST: '127.0.0.1', OPENAI_MODEL: 'gpt-6-luna', NEXT_TELEMETRY_DISABLED: '1',
      PHOTON_PROJECT_ID:'10000000-0000-4000-8000-000000000001',
      PHOTON_WEBHOOK_ID:'20000000-0000-4000-8000-000000000001',
      IMESSAGE_WEBHOOK_SECRET:'synthetic-runtime-webhook-secret', ...environment },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let log = '';
  child.stdout.on('data', (chunk) => { log = (log + chunk).slice(-4000); });
  child.stderr.on('data', (chunk) => { log = (log + chunk).slice(-4000); });
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    assert.equal(child.exitCode, null, `Server exited: ${log}`);
    try {
      const response = await fetch(origin + health, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return origin;
    } catch { /* startup is bounded below */ }
    await delay(100);
  }
  throw new Error(`Server did not become healthy: ${log}`);
}
try {
  const web = await start(['node_modules/next/dist/bin/next', 'start', 'apps/web'], await unusedPort(), '/api/health');
  const health = await fetch(`${web}/api/health`);
  assert.deepEqual(await health.json(), { service: 'find-me-a-time', status: 'reachable', releaseReady: false });
  assert.match(health.headers.get('cache-control'), /no-store/);
  const page = await fetch(web);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('<title>Find Me a Time</title>'), 'Web service serves the application');
  const photon = await fetch(web+'/api/providers/photon',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(photon.status,401,'Photon receiver rejects unsigned delivery before database access');
  assert.match(photon.headers.get('cache-control'),/no-store/u);

  for (const audience of ['host','guest']) {
    const receipt = await fetch(web+'/api/browser/booking-receipt?audience='+audience+'&requestId=00000000-0000-4000-8000-000000000001');
    assert.equal(receipt.status,401,'Receipt rejects anonymous '+audience+' access');
    assert.match(receipt.headers.get('cache-control'),/no-store/u);
  }
  const contactState = await fetch(web+'/api/browser/contact-verification/state?requestId=00000000-0000-4000-8000-000000000001');
  assert.equal(contactState.status,401,'Contact status rejects callers without request authority');
  assert.match(contactState.headers.get('cache-control'),/no-store/u);
  const bookingDispatch = await fetch(web+'/api/internal/booking/dispatch',{method:'POST'});
  assert.equal(bookingDispatch.status,401,'Booking worker rejects anonymous dispatch');
  assert.match(bookingDispatch.headers.get('cache-control'),/no-store/u);
  const bookingDelivery = await fetch(web+'/api/internal/booking/delivery',{method:'POST'});
  assert.equal(bookingDelivery.status,401,'Booking email worker rejects anonymous dispatch');
  assert.match(bookingDelivery.headers.get('cache-control'),/no-store/u);
  const contactDelivery = await fetch(web+'/api/internal/contact/delivery',{method:'POST'});
  assert.equal(contactDelivery.status,401,'Contact email worker rejects anonymous dispatch');
  assert.match(contactDelivery.headers.get('cache-control'),/no-store/u);
  const photonDispatch = await fetch(web+'/api/internal/photon/dispatch',{method:'POST'});
  assert.equal(photonDispatch.status,401,'Code worker rejects anonymous dispatch');
  assert.match(photonDispatch.headers.get('cache-control'),/no-store/u);
  const photonReplies = await fetch(web+'/api/internal/photon/replies',{method:'POST'});
  const photonContacts = await fetch(web+'/api/internal/photon/contacts',{method:'POST'});
  assert.equal(photonContacts.status,401);
  assert.equal(photonReplies.status,401,'Reply worker rejects anonymous dispatch');
  assert.match(photonReplies.headers.get('cache-control'),/no-store/u);
  const photonHandoffs = await fetch(web+'/api/internal/photon/handoffs',{method:'POST'});
  assert.equal(photonHandoffs.status,401,'Handoff worker rejects anonymous dispatch');
  assert.match(photonHandoffs.headers.get('cache-control'),/no-store/u);

  let databaseCalls = 0;
  databaseTrap = createHttpServer((_request, response) => { databaseCalls++; response.writeHead(500); response.end(); });
  databaseTrap.listen(0, '127.0.0.1');
  await once(databaseTrap, 'listening');
  const misconfigured = await start(['node_modules/next/dist/bin/next', 'start', 'apps/web'], await unusedPort(), '/api/health', {
    SUPABASE_URL:`http://127.0.0.1:${databaseTrap.address().port}`, SUPABASE_SECRET_KEY:'sb_publishable_smoke_fixture',
  });
  const publicKeyRequest=await fetch(misconfigured+'/api/browser/waitlist',{method:'POST',headers:{origin:misconfigured,'content-type':'application/json'},
    body:JSON.stringify({email:'configuration@example.test',idempotencyKey:'00000000-0000-4000-8000-000000000001'})});
  assert.equal(publicKeyRequest.status,503);
  assert.equal((await publicKeyRequest.json()).error.code,'CONFIGURATION_UNAVAILABLE');
  assert.match(publicKeyRequest.headers.get('cache-control'),/no-store/u);
  assert.equal(databaseCalls,0,'A mislabeled publishable key is rejected before any database request');
  console.log('PASS: built browser RPC rejects a publishable server key before database access.');
  const dispatchSecret = 'a'.repeat(64);
  const preview = await start(['node_modules/next/dist/bin/next', 'start', 'apps/web'], await unusedPort(), '/api/health', {
    VERCEL:'1', VERCEL_ENV:'preview', VERCEL_TARGET_ENV:'preview',
    SUPABASE_URL:`http://127.0.0.1:${databaseTrap.address().port}`, SUPABASE_SECRET_KEY:'synthetic-service',
    RUNTIME_DISPATCH_SECRET:dispatchSecret,
    CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32), CLOUDFLARE_EMAIL_FROM:'no-reply@findmeatime.com', CLOUDFLARE_EMAIL_API_TOKEN:'synthetic',
    PHOTON_PROJECT_SECRET:'synthetic', AGENTMAIL_API_KEY:'synthetic', AGENTMAIL_INBOX_ID:'inbox@example.test',
    AGENTMAIL_RECEIVER_ID:'00000000-0000-4000-8000-000000000001',
  });
  for (const action of ['booking/delivery','contact/delivery','recovery/delivery','invitations/delivery','photon/dispatch','photon/replies','photon/contacts','agentmail/replies']) {
    const response = await fetch(preview+'/api/internal/'+action, {method:'POST',headers:{authorization:'Bearer '+dispatchSecret}});
    assert.equal(response.status,503,action+' denies authenticated preview wakeup');
    assert.equal((await response.json()).error.code,'CONFIGURATION_UNAVAILABLE');
    assert.match(response.headers.get('cache-control'),/no-store/u);
  }
  assert.equal(databaseCalls,0,'Preview messaging never reaches the database');
  console.log('PASS: all eight built messaging routes deny authenticated preview wakeups before database access.');

  const eve = await start(['.output/server/index.mjs'], await unusedPort(), '/eve/v1/health');
  for (const path of ['/session', '/session/test', ...['cancel', 'compact', 'clear', 'reset'].map((action) => `/session/test/${action}`)]) {
    const response = await fetch(`${eve}/eve/v1${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Unauthorized smoke test' }),
    });
    assert.equal(response.status, 401, `POST ${path} must reject unauthenticated callers`);
  }
  const stream = await fetch(`${eve}/eve/v1/session/test/stream`);
  assert.equal(stream.status, 401);
  for (const [method, path] of [['POST', '/api/agent/conversations/read'], ['POST', '/api/internal/conversations/dispatch'], ['POST', '/api/conversations'], ['GET', '/api/conversations/test'],
    ['POST', '/api/conversations/test/messages'], ['GET', '/api/conversations/test/stream']]) {
    const response = await fetch(eve + path, { method });
    assert.equal(response.status, 401, `${method} ${path} must reject anonymous access`);
    assert.match(response.headers.get('cache-control'), /no-store/u);
  }
  console.log('PASS: built web health/page/headers, unsigned Photon denial and all thirteen conversation/session routes reject anonymous access.');
} finally {
  if (databaseTrap?.listening) await new Promise(resolve => databaseTrap.close(resolve));
  await Promise.all(children.map(async (child) => {
    if (child.exitCode !== null) return;
    const closed = once(child, 'close');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    await closed;
    clearTimeout(timer);
  }));
}
