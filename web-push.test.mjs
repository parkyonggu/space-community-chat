import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

// cloudflare/web-push.js is an ES module bundled by wrangler; this package is CommonJS, so load its source directly.
const source = readFileSync(new URL('./cloudflare/web-push.js', import.meta.url), 'utf8');
const { loadVapid, sendPush } = await import(`data:text/javascript,${encodeURIComponent(source)}`);

const fromB64 = value => Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

test('VAPID keys persist and push requests carry a valid ES256 JWT', async () => {
  const meta = new Map();
  const vapid = await loadVapid(async key => meta.get(key), async (key, value) => meta.set(key, value));
  assert.equal(fromB64(vapid.publicKey).length, 65, 'uncompressed P-256 public key');
  const again = await loadVapid(async key => meta.get(key), async () => assert.fail('must reuse stored keys'));
  assert.equal(again.publicKey, vapid.publicKey);

  const received = [];
  const server = createServer((request, response) => {
    received.push(request.headers);
    response.writeHead(request.url === '/gone' ? 410 : 201).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await sendPush(`${base}/ok`, vapid, 'mailto:test@example.com'), 'ok');
  assert.equal(await sendPush(`${base}/gone`, vapid, 'mailto:test@example.com'), 'gone');
  server.close();

  const [, token, key] = received[0].authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(key, vapid.publicKey);
  assert.equal(received[0].ttl, '86400');
  const [header, claims, signature] = token.split('.');
  assert.deepEqual(JSON.parse(fromB64(header)), { typ: 'JWT', alg: 'ES256' });
  const payload = JSON.parse(fromB64(claims));
  assert.equal(payload.aud, base);
  assert.equal(payload.sub, 'mailto:test@example.com');
  const publicKey = await crypto.subtle.importKey('raw', fromB64(vapid.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, fromB64(signature), new TextEncoder().encode(`${header}.${claims}`)));
});
