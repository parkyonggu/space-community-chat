const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const origin = process.env.WORKER_TEST_URL || 'http://localhost:3003';
const runId = randomUUID();
let cookie = '';
let csrfToken;

async function request(route, input, extra = {}) {
  const response = await fetch(origin + route, {
    method: input ? 'POST' : 'GET',
    headers: {
      Cookie: cookie,
      ...(input ? { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken || '' } : {}),
      ...extra,
    },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const result = await response.json();
  if (result.csrfToken) csrfToken = result.csrfToken;
  return { response, result };
}

test('Worker authentication retains scrypt, CSRF, sessions and logout behavior', async () => {
  let result = await request('/api/auth/session');
  assert.equal(result.response.status, 200);
  assert.equal(result.result.user, null);
  assert.ok(result.response.headers.get('set-cookie').includes('HttpOnly'));
  const email = `worker-${runId}@example.test`;
  const credentials = { email, password: 'Worker-Safe-Test-Password-2026', remember: true };
  result = await request('/api/auth/register', {
    ...credentials, nickname: '워커 테스트', terms: true, privacy: true,
  }, { 'X-CSRF-Token': 'invalid' });
  assert.equal(result.response.status, 403);
  result = await request('/api/auth/register', {
    ...credentials, nickname: '워커 테스트', terms: true, privacy: true,
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.result));
  assert.equal(result.result.user.email, email);
  assert.equal(result.result.mailConfigured, false);
  assert.ok(result.response.headers.get('set-cookie').includes('Max-Age=2592000'));
  result = await request('/api/auth/session');
  assert.equal(result.result.user.email, email);
  result = await request('/api/auth/logout', {});
  assert.equal(result.response.status, 200);
  await request('/api/auth/session');
  result = await request('/api/auth/login', credentials);
  assert.equal(result.response.status, 200, JSON.stringify(result.result));
  result = await request('/api/auth/password/request', { email });
  assert.equal(result.response.status, 503);
  const authenticatedCookie = cookie;
  result = await request('/api/auth/logout', {});
  assert.equal(result.response.status, 200);
  result = await request('/api/auth/session', undefined, { Cookie: authenticatedCookie });
  assert.equal(result.result.user, null);
  result = await request('/api/auth/login', credentials, { Origin: 'https://invalid.example' });
  assert.equal(result.response.status, 403);
  await request('/api/auth/session');
  result = await request('/api/auth/login', credentials);
  assert.equal(result.response.status, 200);
  result = await request('/api/auth/account/delete', { password: 'Wrong-Password-For-Test' });
  assert.equal(result.response.status, 401);
  result = await request('/api/auth/account/delete', { password: credentials.password });
  assert.equal(result.response.status, 200, JSON.stringify(result.result));
  result = await request('/api/auth/session');
  assert.equal(result.result.user, null);
  result = await request('/api/auth/login', credentials);
  assert.equal(result.response.status, 401);
});

test('Worker comments persist, subscriptions remain private, invalid requests fail', async () => {
  let result = await request('/api/comments', { name: '테스트', text: `worker-comment-${runId}` });
  assert.equal(result.response.status, 201, JSON.stringify(result.result));
  const id = result.result.comment.id;
  result = await request('/api/comments');
  assert.ok(result.result.comments.some(comment => comment.id === id));
  const email = `subscriber-${runId}@example.test`;
  result = await request('/api/newsletter', { email, consent: false });
  assert.equal(result.response.status, 400);
  result = await request('/api/newsletter', { email, consent: true });
  assert.equal(result.response.status, 200);
  result = await request('/api/newsletter', { email, consent: true });
  assert.equal(result.response.status, 200);
  result = await request('/api/newsletter/unsubscribe', { email });
  assert.equal(result.response.status, 200, JSON.stringify(result.result));
  result = await request('/api/newsletter');
  assert.equal(result.response.status, 405);
  result = await request('/api/comments');
  assert.ok(!JSON.stringify(result.result).includes(email));
  result = await request('/api/comments', { name: '테스트', text: 'bad' }, { Origin: 'https://invalid.example' });
  assert.equal(result.response.status, 403);
  assert.equal((await fetch(origin + '/api/missing')).status, 404);
});
