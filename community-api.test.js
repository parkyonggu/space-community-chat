const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('node:http');
const { createCommunityApi } = require('./community-api');

test('community API validates and persists shared comments', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'space-community-test-'));
  let handler = createCommunityApi(directory);
  const server = createServer((request, response) => handler(request, response, request.url));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body, headers = {}) => fetch(origin + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  assert.deepEqual(await fetch(origin + '/api/comments').then(r => r.json()), { comments: [] });
  assert.equal((await post('/api/comments', { name: ' ', text: 'Test' })).status, 400);
  assert.equal((await post('/api/comments', { name: 'Reader', text: 'x'.repeat(2001) })).status, 400);
  assert.equal((await post('/api/comments', { name: 'Reader', text: 'Test' }, { Origin: 'https://invalid.example' })).status, 403);
  const responses = await Promise.all([
    post('/api/comments', { name: 'Reader one', text: '<script>alert(1)</script>' }),
    post('/api/comments', { name: 'Reader two', text: 'Second comment' }),
  ]);
  responses.forEach(response => assert.equal(response.status, 201));
  handler = createCommunityApi(directory);
  const result = await fetch(origin + '/api/comments').then(r => r.json());
  assert.equal(result.comments.length, 2);
  assert.ok(result.comments.some(comment => comment.text === '<script>alert(1)</script>'));
  const store = JSON.parse(await fs.readFile(path.join(directory, 'community.json'), 'utf8'));
  assert.equal(store.comments.length, 2);
  assert.equal((await fetch(origin + '/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await post('/api/comments', { name: 'Reader', text: 'x'.repeat(9000) })).status, 413);
});
