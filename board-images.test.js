const test = require('node:test');
const assert = require('node:assert/strict');
const { createBoardApi, createMemoryImageStore } = require('./board-api');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 7)]);

function call(api, url, { method = 'GET', body, type = 'application/json' } = {}) {
  return new Promise(resolve => {
    const chunks = body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))];
    const request = { method, url, headers: { 'content-type': type }, socket: { remoteAddress: '1.1.1.1' }, async *[Symbol.asyncIterator]() { yield* chunks; } };
    const response = {
      headers: {}, setHeader() {},
      writeHead(code, headers = {}) { this.code = code; Object.assign(this.headers, headers); },
      end(payload) {
        const json = String(this.headers['Content-Type'] || '').includes('json');
        resolve({ status: this.code, headers: this.headers, body: json ? JSON.parse(payload) : payload });
      },
    };
    api(request, response, new URL(url, 'http://x').pathname);
  });
}

function setup() {
  let store = { posts: [], likes: [], reports: [] };
  const storage = { read: async () => JSON.parse(JSON.stringify(store)), write: async value => { store = value; } };
  const users = { a: { id: 'a', nickname: '주민', emailVerified: true }, b: { id: 'b', nickname: '이웃', emailVerified: true }, admin: { id: 'z', nickname: '운영자', admin: true, emailVerified: true } };
  let who = 'a';
  const images = createMemoryImageStore();
  const api = createBoardApi('/tmp/unused', { storage, images, authenticate: async () => ({ user: who ? users[who] : null }) });
  return { api, images, as: name => { who = name; } };
}

test('members upload a photo and attach it to a 시민의 소리 post', async () => {
  const { api, as } = setup();
  const up = await call(api, '/api/board/image', { method: 'POST', body: JPEG, type: 'image/jpeg' });
  assert.equal(up.status, 201);
  assert.match(up.body.id, /^[0-9a-f]{32}$/);
  const created = await call(api, '/api/board/posts', { method: 'POST', body: { board: 'voice', category: '민원이 불편했어요', text: '밤길이 너무 어두웠어요', images: [up.body.id] } });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.post.images, [up.body.id]);

  as(null);
  const photo = await call(api, `/api/board/image?id=${up.body.id}`);
  assert.equal(photo.status, 200, 'anyone can see a photo on a public post');
  assert.equal(photo.headers['Content-Type'], 'image/jpeg');
  assert.ok(Buffer.from(photo.body).equals(JPEG));

  as('b');
  const reuse = await call(api, '/api/board/posts', { method: 'POST', body: { board: 'voice', category: '민원이 불편했어요', text: '남의 사진', images: [up.body.id] } });
  assert.equal(reuse.status, 400, "cannot attach someone else's photo");
});

test('rejects non-images, oversized files and more than four photos', async () => {
  const { api } = setup();
  assert.equal((await call(api, '/api/board/image', { method: 'POST', body: Buffer.from('<svg></svg>'.padEnd(200)), type: 'image/svg+xml' })).status, 415);
  assert.equal((await call(api, '/api/board/image', { method: 'POST', body: Buffer.alloc(300, 1), type: 'image/jpeg' })).status, 400, 'magic bytes checked');
  assert.equal((await call(api, '/api/board/image', { method: 'POST', body: Buffer.concat([JPEG, Buffer.alloc(1600 * 1024)]), type: 'image/jpeg' })).status, 413);
  const ids = [];
  for (let index = 0; index < 5; index += 1) ids.push((await call(api, '/api/board/image', { method: 'POST', body: JPEG, type: 'image/jpeg' })).body.id);
  assert.equal((await call(api, '/api/board/posts', { method: 'POST', body: { board: 'community', text: '사진 다섯 장', images: ids } })).status, 400);
});

test('unattached photos are private; editing can remove photos; admin delete removes them', async () => {
  const { api, as, images } = setup();
  const first = (await call(api, '/api/board/image', { method: 'POST', body: JPEG, type: 'image/jpeg' })).body.id;
  as('b');
  assert.equal((await call(api, `/api/board/image?id=${first}`)).status, 404, 'not yet posted');
  as('a');
  const post = (await call(api, '/api/board/posts', { method: 'POST', body: { board: 'community', text: '사진 글', images: [first] } })).body.post;
  const edited = await call(api, '/api/board/edit', { method: 'POST', body: { postId: post.id, text: '사진 글', images: [] } });
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.body.post.images, []);
  assert.equal(await images.get(first), null, 'removed photo is deleted');

  const second = (await call(api, '/api/board/image', { method: 'POST', body: JPEG, type: 'image/jpeg' })).body.id;
  await call(api, '/api/board/edit', { method: 'POST', body: { postId: post.id, text: '사진 글', images: [second] } });
  as('admin');
  assert.equal((await call(api, '/api/board/moderate', { method: 'POST', body: { postId: post.id, action: 'delete' } })).status, 200);
  assert.equal(await images.get(second), null);
});

test('시민의 소리 authors record official complaint progress; others cannot', async () => {
  const { api, as } = setup();
  const post = (await call(api, '/api/board/posts', { method: 'POST', body: { board: 'voice', category: '민원이 불편했어요', title: '가로등 설치가 필요합니다', text: '○○길이 너무 어둡습니다.' } })).body.post;
  const saved = await call(api, '/api/board/progress', { method: 'POST', body: { postId: post.id, channel: '국민신문고', status: '접수함', receipt: '1AA-2610-0012345', answer: '' } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.post.progress.status, '접수함');
  assert.equal(saved.body.post.progress.by, '글쓴이');
  as('b');
  assert.equal((await call(api, '/api/board/progress', { method: 'POST', body: { postId: post.id, channel: '국민신문고', status: '해결됨' } })).status, 403);
  as('a');
  assert.equal((await call(api, '/api/board/progress', { method: 'POST', body: { postId: post.id, channel: '카톡', status: '접수함' } })).status, 400);
  const answered = await call(api, '/api/board/progress', { method: 'POST', body: { postId: post.id, channel: '국민신문고', status: '답변 받음', receipt: '1AA-2610-0012345', answer: '내년 상반기 설치 예정' } });
  assert.equal(answered.body.post.progress.answer, '내년 상반기 설치 예정');
  const community = (await call(api, '/api/board/posts', { method: 'POST', body: { board: 'community', text: '안부' } })).body.post;
  assert.equal((await call(api, '/api/board/progress', { method: 'POST', body: { postId: community.id, channel: '국민신문고', status: '접수함' } })).status, 400);
  const cleared = await call(api, '/api/board/progress', { method: 'POST', body: { postId: post.id, clear: true } });
  assert.equal(cleared.body.post.progress, undefined);
});
