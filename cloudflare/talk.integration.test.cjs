// End-to-end test for 스페이스 톡 against `wrangler dev` (npm run dev:worker).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const origin = process.env.WORKER_TEST_URL || 'http://localhost:3003';
const runId = randomUUID().slice(0, 8);

async function member(nickname) {
  // Each test member gets its own client address so the per-address sign-up limit is not shared.
  const client = { cookie: '', csrf: '', ip: `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` };
  client.call = async (route, input, { method, raw, type, headers = {} } = {}) => {
    const response = await fetch(origin + route, {
      method: method || (input !== undefined || raw ? 'POST' : 'GET'),
      headers: { Cookie: client.cookie, Origin: origin, 'X-CSRF-Token': client.csrf, 'CF-Connecting-IP': client.ip, ...(input !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(raw ? { 'Content-Type': type } : {}), ...headers },
      body: raw || (input !== undefined ? JSON.stringify(input) : undefined),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) client.cookie = setCookie.split(';')[0];
    const result = response.headers.get('content-type')?.includes('json') ? await response.json() : await response.arrayBuffer();
    if (result?.csrfToken) client.csrf = result.csrfToken;
    return { status: response.status, result, response };
  };
  await client.call('/api/auth/session');
  const registered = await client.call('/api/auth/register', { email: `talk-${nickname}-${runId}@example.test`, password: 'Talk-Safe-Test-Password-2026', nickname: `${nickname}${runId}`, terms: true, privacy: true });
  assert.equal(registered.status, 201, JSON.stringify(registered.result));
  client.socket = () => new Promise((resolve, reject) => {
    const socket = new WebSocket(`${origin.replace('http', 'ws')}/ws/talk`, { headers: { Cookie: client.cookie, Origin: origin, 'CF-Connecting-IP': client.ip } });
    socket.events = [];
    socket.addEventListener('message', event => socket.events.push(JSON.parse(event.data)));
    socket.addEventListener('open', () => resolve(socket));
    socket.addEventListener('error', reject);
  });
  return client;
}
const until = async (check, timeout = 4000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('timed out');
};

test('스페이스 톡: rooms, invites, realtime delivery, read receipts, photos, 1:1 and moderation', async () => {
  const guest = await fetch(`${origin}/api/chat/rooms`, { headers: { 'CF-Connecting-IP': '10.78.0.1' } });
  assert.equal(guest.status, 401);
  const alice = await member('앨리스');
  const bob = await member('밥');

  assert.equal((await alice.call('/api/chat/rooms', { name: '모임' }, { headers: { Origin: 'https://evil.example' } })).status, 403, 'cross-site write refused');
  assert.equal((await alice.call('/api/chat/rooms', { name: '모임' }, { headers: { 'X-CSRF-Token': 'bad' } })).status, 403, 'csrf enforced');
  const me = (await alice.call('/api/chat/me')).result;
  assert.ok(me.vapidPublicKey.length > 80, 'VAPID key generated');
  const created = await alice.call('/api/chat/rooms', { name: '동네 모임', maxMembers: 10 });
  assert.equal(created.status, 201, JSON.stringify(created.result));
  const room = created.result.room;
  assert.equal((await bob.call(`/api/chat/rooms/${room.id}/messages`)).status, 403);
  assert.equal((await bob.call(`/api/chat/invite/${room.inviteCode}`)).result.name, '동네 모임');
  assert.equal((await bob.call('/api/chat/join', { code: room.inviteCode })).status, 200);

  const aliceSocket = await alice.socket();
  const bobSocket = await bob.socket();
  await until(() => aliceSocket.events.find(event => event.type === 'hello'));
  aliceSocket.send(JSON.stringify({ type: 'send', roomId: room.id, clientId: 'c1', text: '안녕하세요 https://withpluces.com' }));
  const sent = await until(() => aliceSocket.events.find(event => event.type === 'sent' && event.clientId === 'c1'));
  const received = await until(() => bobSocket.events.find(event => event.type === 'message' && event.message.id === sent.message.id));
  assert.equal(received.message.text, '안녕하세요 https://withpluces.com');
  assert.equal((await bob.call('/api/chat/rooms')).result.rooms[0].unread, 1);
  bobSocket.send(JSON.stringify({ type: 'read', roomId: room.id, seq: sent.message.seq }));
  const read = await until(() => aliceSocket.events.find(event => event.type === 'read'));
  assert.equal(read.seq, sent.message.seq);
  assert.equal((await bob.call('/api/chat/rooms')).result.rooms[0].unread, 0);
  bobSocket.send(JSON.stringify({ type: 'typing', roomId: room.id }));
  await until(() => aliceSocket.events.find(event => event.type === 'typing'));

  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  const uploaded = await bob.call(`/api/chat/rooms/${room.id}/images`, undefined, { raw: png, type: 'image/png' });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.result));
  bobSocket.send(JSON.stringify({ type: 'send', roomId: room.id, clientId: 'c2', imageId: uploaded.result.imageId }));
  await until(() => aliceSocket.events.find(event => event.type === 'message' && event.message.kind === 'image'));
  const image = await alice.call(`/api/chat/images/${uploaded.result.imageId}`);
  assert.equal(image.response.headers.get('content-type'), 'image/png');
  assert.equal(new Uint8Array(image.result).length, png.length);

  const dm = await bob.call('/api/chat/dm', { userId: (await alice.call('/api/chat/me')).result.user.id });
  assert.equal(dm.status, 200, JSON.stringify(dm.result));
  assert.equal(dm.result.room.kind, 'dm');
  const reported = await bob.call(`/api/chat/rooms/${room.id}/messages/${sent.message.id}/report`, { reason: '테스트 신고' });
  assert.equal(reported.status, 200);
  assert.equal((await bob.call('/api/chat/admin/reports')).status, 403);
  assert.equal((await alice.call(`/api/chat/rooms/${room.id}/kick`, { userId: (await bob.call('/api/chat/me')).result.user.id })).status, 200);
  await until(() => bobSocket.events.find(event => event.type === 'removed'));
  assert.equal((await bob.call(`/api/chat/rooms/${room.id}/messages`)).status, 403);

  assert.equal((await bob.call('/api/chat/push', { endpoint: 'https://push.example.test/sub/abcdef12345' })).status, 200);
  aliceSocket.close();
  bobSocket.close();
});
