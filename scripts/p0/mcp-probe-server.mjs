#!/usr/bin/env node
import { createServer } from "node:http";
import path from "node:path";
import {
  activeApplicationGrant,
  beginJourney,
  decodeJwt,
  journeyFile,
  jsonFetch,
  readJson,
  scratch,
  verifyJwt,
  writePrivateJson,
} from "./oauth-probe-lib.mjs";

process.umask(0o077);

const origin = process.env.P0_PROBE_ORIGIN ?? "http://127.0.0.1:8788";
const parsedOrigin = new URL(origin);
if (!/^127\.0\.0\.1$|^localhost$/.test(parsedOrigin.hostname))
  throw new Error("PROBE_ORIGIN_MUST_BE_LOOPBACK");
const authBase = (
  process.env.P0_AUTH_BASE ?? "http://127.0.0.1:55321/auth/v1"
).replace(/\/$/, "");
if (authBase !== "http://127.0.0.1:55321/auth/v1")
  throw new Error("PROBE_REQUIRES_ISOLATED_AUTH_55321");
const resource = process.env.P0_MCP_RESOURCE ?? `${origin}/mcp`;
const publishableKey = process.env.P0_SUPABASE_PUBLISHABLE_KEY;
if (!publishableKey) throw new Error("P0_SUPABASE_PUBLISHABLE_KEY_REQUIRED");
const fixture = await readJson(path.join(scratch, "fixture-credentials.json"));
if (!fixture?.email || !fixture?.userId)
  throw new Error("PROVISIONED_FIXTURE_REQUIRED");

function send(response, status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  response.writeHead(status, {
    "content-type":
      typeof body === "string"
        ? "text/html; charset=utf-8"
        : "application/json",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(text);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.reduce((size, chunk) => size + chunk.length, 0) > 64_000)
    throw new Error("BODY_TOO_LARGE");
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const consentHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>P0 OAuth consent probe</title><style>body{font:16px system-ui;max-width:42rem;margin:3rem auto;padding:1rem}label{display:block;margin:.8rem 0}input,button{font:inherit;padding:.6rem;width:100%;box-sizing:border-box}button{margin:.4rem 0}pre{white-space:pre-wrap;background:#f4f4f4;padding:1rem}</style></head><body><h1>Local synthetic OAuth probe</h1><p>This page accepts only the dedicated disposable local fixture account. It grants identity scopes to the current test client; it does not grant Calendar access.</p><form id="login"><label>Email<input id="email" type="email" autocomplete="username" value=${JSON.stringify(fixture.email)} readonly required></label><label>Password<input id="password" type="password" autocomplete="current-password" required></label><button>Sign in and inspect request</button></form><section id="decision" hidden><pre id="details"></pre><button id="approve">Approve synthetic probe</button><button id="deny">Deny</button></section><pre id="status"></pre><script>
const authorizationId=new URL(location.href).searchParams.get('authorization_id');const status=document.querySelector('#status');let accessToken='';
async function request(url,options={}){const response=await fetch(url,{...options,headers:{apikey:${JSON.stringify(publishableKey)},'content-type':'application/json',...(options.headers||{})}});const text=await response.text();let body={};try{body=text?JSON.parse(text):{}}catch{body={error:'NON_JSON'}}if(!response.ok)throw new Error(body.msg||body.message||body.error_description||body.error||('HTTP_'+response.status));return body}
document.querySelector('#login').onsubmit=async(event)=>{event.preventDefault();try{const session=await request(${JSON.stringify(`${authBase}/token?grant_type=password`)},{method:'POST',body:JSON.stringify({email:email.value,password:password.value})});accessToken=session.access_token;await fetch('/probe/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({access_token:session.access_token,refresh_token:session.refresh_token})});const details=await request(${JSON.stringify(`${authBase}/oauth/authorizations/`)}+encodeURIComponent(authorizationId),{headers:{authorization:'Bearer '+accessToken}});if(details.redirect_url){location.assign(details.redirect_url);return}document.querySelector('#details').textContent=JSON.stringify({client:details.client?.name||details.client_name||details.client_id,scopes:details.scope||details.scopes,redirect_uri:details.redirect_uri},null,2);document.querySelector('#decision').hidden=false;document.querySelector('#login').hidden=true}catch(error){status.textContent=error.message}}
async function decide(action){try{const result=await request(${JSON.stringify(`${authBase}/oauth/authorizations/`)}+encodeURIComponent(authorizationId)+'/consent',{method:'POST',headers:{authorization:'Bearer '+accessToken},body:JSON.stringify({action})});location.assign(result.redirect_url)}catch(error){status.textContent=error.message}}
document.querySelector('#approve').onclick=()=>decide('approve');document.querySelector('#deny').onclick=()=>decide('deny');
</script></body></html>`;

const browserHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>P0 browser OAuth probe</title></head><body><h1>Browser-oriented OAuth probe</h1><p>This is a local harness baseline, not evidence for any named third-party client.</p><button id="start">Start PKCE/DCR journey</button><pre id="output"></pre><script>start.onclick=async()=>{const response=await fetch('/probe/browser/begin',{method:'POST'});const data=await response.json();if(!response.ok){output.textContent=JSON.stringify(data,null,2);return}location.assign(data.authorizationUrl)}</script></body></html>`;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, origin);
    if (request.method === "GET" && url.pathname === "/oauth/consent")
      return send(response, 200, consentHtml);
    if (request.method === "GET" && url.pathname === "/client/browser")
      return send(response, 200, browserHtml);
    if (request.method === "POST" && url.pathname === "/probe/browser/begin") {
      return send(
        response,
        200,
        await beginJourney({
          authBase,
          journey: "browser",
          resource,
          callbackBase: origin,
        }),
      );
    }
    if (request.method === "POST" && url.pathname === "/probe/session") {
      const body = await readBody(request);
      if (!body.access_token || !body.refresh_token)
        return send(response, 400, { error: "SESSION_REQUIRED" });
      let claims;
      try {
        claims = decodeJwt(body.access_token).payload;
      } catch {
        return send(response, 400, { error: "INVALID_SESSION_TOKEN" });
      }
      if (claims.email !== fixture.email || claims.sub !== fixture.userId)
        return send(response, 403, { error: "DEDICATED_FIXTURE_REQUIRED" });
      return await writePrivateJson(
        path.join(scratch, "fixture-session.json"),
        {
          ...body,
          publishable_key: publishableKey,
          savedAt: new Date().toISOString(),
        },
      ).then(() => send(response, 204, ""));
    }
    const callback = url.pathname.match(/^\/callback\/(terminal|browser)$/);
    if (request.method === "GET" && callback) {
      const file = journeyFile(callback[1]);
      const state = await readJson(file);
      if (!state || url.searchParams.get("state") !== state.pkce.state)
        return send(response, 400, { error: "STATE_MISMATCH" });
      state.callback = {
        code: url.searchParams.get("code"),
        error: url.searchParams.get("error"),
        receivedAt: new Date().toISOString(),
      };
      await writePrivateJson(file, state);
      response.writeHead(303, {
        location: `/receipt/${callback[1]}`,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      });
      return response.end();
    }
    const receipt = url.pathname.match(/^\/receipt\/(terminal|browser)$/);
    if (request.method === "GET" && receipt) {
      return send(
        response,
        200,
        `<p>Callback captured for ${receipt[1]}. The authorization code has been removed from this URL. Return to the terminal and run the complete command.</p>`,
        { "referrer-policy": "no-referrer" },
      );
    }
    if (
      request.method === "GET" &&
      url.pathname === "/.well-known/oauth-protected-resource"
    ) {
      return send(response, 200, {
        resource,
        authorization_servers: [authBase],
        bearer_methods_supported: ["header"],
      });
    }
    if (request.method === "POST" && url.pathname === "/mcp") {
      const authorization = request.headers.authorization ?? "";
      if (!authorization.startsWith("Bearer "))
        return send(
          response,
          401,
          { error: "unauthorized" },
          {
            "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
          },
        );
      const token = authorization.slice(7);
      const body = await readBody(request);
      const journey = await Promise.all(
        ["terminal", "browser"].map(async (name) =>
          readJson(journeyFile(name)),
        ),
      );
      const nativeRegistry = await readJson(
        path.join(scratch, "oauth-native-clients.json"),
        { clients: [] },
      );
      const nativeStates = (nativeRegistry.clients ?? []).map((client) => ({
        authBase,
        resource: client.resource,
        discovery: client.discovery,
        client: { client_id: client.clientId },
      }));
      const state = [...journey, ...nativeStates].find(
        (candidate) =>
          candidate?.client?.client_id ===
          (() => {
            try {
              return JSON.parse(Buffer.from(token.split(".")[1], "base64url"))
                .client_id;
            } catch {
              return null;
            }
          })(),
      );
      if (!state) return send(response, 401, { error: "unknown_client" });
      const verification = await verifyJwt(token, { ...state, resource });
      if (!verification.valid)
        return send(response, 401, {
          error: "invalid_token",
          checks: verification.checks,
        });
      const method = body.method;
      const tool = body.params?.name;
      if (method === "notifications/initialized" && body.id === undefined)
        return send(response, 204, "");
      if (method === "initialize")
        return send(response, 200, {
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "fmat-p0-read-only-probe", version: "1.0.0" },
          },
        });
      if (method === "tools/list")
        return send(response, 200, {
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [
              {
                name: "diagnostic.read",
                description: "Return allowlisted OAuth binding diagnostics",
                inputSchema: { type: "object", additionalProperties: false },
                annotations: {
                  readOnlyHint: true,
                  destructiveHint: false,
                  idempotentHint: true,
                  openWorldHint: false,
                },
              },
            ],
          },
        });
      if (method !== "tools/call" || tool !== "diagnostic.read")
        return send(response, 404, {
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32601, message: "Method not found" },
        });
      const grant = await activeApplicationGrant({
        userId: verification.claims.sub,
        clientId: verification.claims.client_id,
        resource,
        tool,
      });
      if (!grant)
        return send(response, 403, { error: "application_grant_denied" });
      return send(response, 200, {
        jsonrpc: "2.0",
        id: body.id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                issuer: verification.claims.iss,
                audience: verification.claims.aud,
                clientId: verification.claims.client_id,
                userId: verification.claims.sub,
                grant: "diagnostic.read",
              }),
            },
          ],
        },
      });
    }
    return send(response, 404, { error: "not_found" });
  } catch (error) {
    return send(response, 500, { error: error.message });
  }
});

server.listen(Number(parsedOrigin.port), parsedOrigin.hostname, () => {
  console.log(
    JSON.stringify({
      listening: origin,
      mcp: resource,
      authBase,
      browserClient: `${origin}/client/browser`,
    }),
  );
});
