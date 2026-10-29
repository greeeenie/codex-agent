import test from 'node:test';
import assert from 'node:assert/strict';
import {agentConnectResponse} from './agent-connect-response.mjs';
test('pairing preserves the Site Origin for form navigation to the local agent',async()=>{
 const response=agentConnectResponse(62031,'a'.repeat(64),'fixture-token');const html=await response.text();
 assert.equal(response.headers.get('Referrer-Policy'),'origin');
 assert.match(html,/<meta name="referrer" content="origin">/);
 assert.doesNotMatch(html,/no-referrer|unsafe-url/);
 assert.match(html,/<form method="POST" action="http:\/\/127\.0\.0\.1:62031\/connect">/);
});
test('pairing keeps the token in the POST body, escapes HTML, and prevents caching',async()=>{
 const token='fixture-"<&';const response=agentConnectResponse(62031,'b'.repeat(64),token);const html=await response.text();
 assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.match(html,/name="token" value="fixture-&quot;&lt;&amp;"/);
 assert.doesNotMatch(html,/action="[^"]*[?&]/);
 assert.match(response.headers.get('Content-Security-Policy'),/form-action http:\/\/127\.0\.0\.1:62031; frame-ancestors 'none'/);
 const nonce=html.match(/<script nonce="([a-f0-9]+)">/)?.[1];assert.ok(nonce);assert.ok(response.headers.get('Content-Security-Policy').includes("'nonce-"+nonce+"'"));
});
