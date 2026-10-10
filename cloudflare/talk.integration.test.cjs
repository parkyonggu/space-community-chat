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

test('광장 채팅: 보관된 대화가 나중에 들어온 사람에게 보이고, 보낸 사람만 삭제할 수 있다', async () => {
  const square = client => new Promise((resolve, reject) => {
    const socket = new WebSocket(`${origin.replace('http', 'ws')}/ws/chat`, { headers: { Cookie: client?.cookie || '', Origin: origin, 'CF-Connecting-IP': client?.ip || '10.79.0.9' } });
    socket.events = [];
    socket.addEventListener('message', event => socket.events.push(JSON.parse(event.data)));
    socket.addEventListener('open', () => resolve(socket));
    socket.addEventListener('error', reject);
  });
  const carol = await member('캐럴');
  const dave = await member('데이브');
  const carolSocket = await square(carol);
  await until(() => carolSocket.events.find(event => event.type === 'history'));
  const presence = await until(() => carolSocket.events.find(event => event.type === 'presence' && event.members.includes(`캐럴${runId}`)));
  assert.ok(Number.isInteger(presence.guests));
  const text = `11월 1일 모임 공지 ${runId}`;
  carolSocket.send(JSON.stringify({ text }));
  const sent = await until(() => carolSocket.events.find(event => event.type === 'message' && event.text === text));
  assert.equal(sent.own, true);
  assert.match(sent.id, /^\d+-[a-z0-9]+$/);

  const guest = await square(null);
  const history = await until(() => guest.events.find(event => event.type === 'history'));
  const withGuest = await until(() => carolSocket.events.filter(event => event.type === 'presence').at(-1)?.guests >= 1 && carolSocket.events.filter(event => event.type === 'presence').at(-1));
  assert.ok(!withGuest.members.some(name => name === ''), 'guests are counted, not named');
  const seen = history.messages.find(message => message.text === text);
  assert.ok(seen, 'late visitor sees the stored message');
  assert.equal(seen.own, false);
  assert.equal(seen.uid, undefined, 'user id is not exposed');

  const daveSocket = await square(dave);
  await until(() => daveSocket.events.find(event => event.type === 'history'));
  daveSocket.send(JSON.stringify({ type: 'delete', id: sent.id }));
  assert.match((await until(() => daveSocket.events.find(event => event.error))).error, /내가 보낸 메시지만/);

  carolSocket.send(JSON.stringify({ type: 'delete', id: sent.id }));
  await until(() => guest.events.find(event => event.type === 'deleted' && event.id === sent.id));
  const again = await square(null);
  const after = await until(() => again.events.find(event => event.type === 'history'));
  assert.ok(!after.messages.some(message => message.id === sent.id), 'deleted message is gone for everyone');
  for (const socket of [carolSocket, guest, daveSocket, again]) socket.close();
});

test('모임안내 채널: 회원이 구독하면 읽기 전용 채널이 대화 목록에 추가된다', async () => {
  const memberClient = await member('모임구독');
  const before = await memberClient.call('/api/chat/event-channel');
  assert.equal(before.status, 200, JSON.stringify(before.result));
  assert.equal(before.result.name, '📣 모임안내');
  assert.equal(before.result.subscribed, false);

  const subscribed = await memberClient.call('/api/chat/event-channel/subscribe', {});
  assert.equal(subscribed.status, 200, JSON.stringify(subscribed.result));
  assert.equal(subscribed.result.room.kind, 'channel');
  assert.equal(subscribed.result.room.name, '📣 모임안내');
  const listed = await memberClient.call('/api/chat/rooms');
  assert.ok(listed.result.rooms.some(room => room.id === before.result.roomId));
  assert.equal((await memberClient.call(`/api/chat/rooms/${before.result.roomId}/messages`, undefined, { method: 'POST' })).status, 403);
});

test('스페이스 톡 손님 입장: 초대 링크만으로 회원가입 없이 대화방에 들어와 대화한다', async () => {
  const owner = await member('방장');
  const created = await owner.call('/api/chat/rooms', { name: '동문회', maxMembers: 30 });
  const room = created.result.room;
  const guest = { cookie: '', ip: `10.88.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` };
  const guestCall = async (route, input, extra = {}) => {
    const response = await fetch(origin + route, {
      method: input !== undefined ? 'POST' : 'GET',
      headers: { Cookie: guest.cookie, Origin: origin, 'CF-Connecting-IP': guest.ip, ...(input !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra },
      body: input !== undefined ? JSON.stringify(input) : undefined,
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) guest.cookie = setCookie.split(';')[0];
    return { status: response.status, result: await response.json(), setCookie };
  };
  const preview = await guestCall(`/api/chat/invite/${room.inviteCode}`);
  assert.equal(preview.status, 200);
  assert.equal(preview.result.name, '동문회', 'preview works without login');
  assert.equal((await guestCall('/api/chat/guest', { code: 'wrong-code', nickname: '홍길동' })).status, 404);
  assert.equal((await guestCall('/api/chat/guest', { code: room.inviteCode, nickname: '홍' })).status, 400, 'name too short');
  const entered = await guestCall('/api/chat/guest', { code: room.inviteCode, nickname: '홍길동' });
  assert.equal(entered.status, 201, JSON.stringify(entered.result));
  assert.match(entered.setCookie, /HttpOnly/);
  assert.equal(entered.result.room.id, room.id);
  const me = await guestCall('/api/chat/me');
  assert.equal(me.result.user.guest, true);
  assert.equal(me.result.user.nickname, '홍길동(손님)');
  const sent = await guestCall(`/api/chat/rooms/${room.id}/messages`, { text: '초대 링크로 바로 들어왔어요!' });
  assert.equal(sent.status, 201, JSON.stringify(sent.result));
  const ownerView = await owner.call(`/api/chat/rooms/${room.id}/messages`);
  assert.ok(ownerView.result.messages.some(message => message.text === '초대 링크로 바로 들어왔어요!' && message.nickname === '홍길동(손님)'));
  assert.equal((await guestCall('/api/chat/rooms', { name: '손님방' })).status, 403, 'guests cannot create rooms');
  assert.equal((await guestCall('/api/chat/rooms', { name: 'x' }, { Origin: 'https://evil.example' })).status, 403, 'cross-site refused');
  const forged = await fetch(`${origin}/api/chat/me`, { headers: { 'X-Talk-Guest': 'a'.repeat(64), Origin: origin, 'CF-Connecting-IP': guest.ip } });
  assert.equal(forged.status, 401, 'header from the outside is ignored');
});
