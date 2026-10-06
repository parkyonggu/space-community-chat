const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('node:http');
const { createBoardApi } = require('./board-api');

const users = {
  alice: { id: 'u-alice', nickname: '앨리스', emailVerified: true, admin: false },
  bob: { id: 'u-bob', nickname: '밥', emailVerified: true, admin: false },
  carol: { id: 'u-carol', nickname: '캐럴', emailVerified: true, admin: false },
  dave: { id: 'u-dave', nickname: '데이브', emailVerified: false, admin: false },
  admin: { id: 'u-admin', nickname: '운영자', emailVerified: true, admin: true },
};

async function authenticate(request, { csrf = false } = {}) {
  const user = users[request.headers['x-test-user']] || null;
  if (csrf && request.headers['x-csrf-token'] !== 'ok') return { error: { status: 403, message: 'csrf' } };
  return { user };
}

test('boards persist posts, protect research, require members to write and support report-based moderation', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'space-board-test-'));
  let handler = createBoardApi(directory, { authenticate, requireVerifiedEmail: true });
  const server = createServer((request, response) => handler(request, response, new URL(request.url, 'http://x').pathname));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const get = (board, user) => fetch(`${origin}/api/board?board=${board}`, { headers: user ? { 'x-test-user': user } : {} });
  const post = (route, body, user, csrf = 'ok') => fetch(origin + route, {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf, ...(user ? { 'x-test-user': user } : {}) },
  });

  assert.equal((await get('community')).status, 200);
  assert.equal((await get('research')).status, 401);
  assert.equal((await get('research', 'bob')).status, 200);
  assert.equal((await get('unknown')).status, 400);

  assert.equal((await post('/api/board/posts', { board: 'community', text: '안녕하세요' })).status, 401);
  assert.equal((await post('/api/board/posts', { board: 'community', text: '안녕하세요' }, 'alice', 'bad')).status, 403);
  assert.equal((await post('/api/board/posts', { board: 'community', text: '안녕하세요' }, 'dave')).status, 403);
  assert.equal((await post('/api/board/posts', { board: 'community', text: '   ' }, 'alice')).status, 400);
  assert.equal((await post('/api/board/posts', { board: 'voice', category: '아무거나', text: '내용' }, 'alice')).status, 400);
  assert.equal((await post('/api/board/posts', { board: 'research', category: '논문', text: '제목 없음' }, 'alice')).status, 400);

  const created = await post('/api/board/posts', { board: 'community', text: '<b>첫 글</b>' }, 'alice');
  assert.equal(created.status, 201);
  const { post: first } = await created.json();
  assert.equal(first.authorName, '앨리스');
  assert.equal(first.mine, true);
  assert.equal(first.authorId, undefined);
  const research = await post('/api/board/posts', { board: 'research', category: '논문', title: '연구 제목', text: '초록' }, 'bob');
  assert.equal(research.status, 201);
  const policy = await (await post('/api/board/posts', { board: 'policy', category: 'education', text: '교육 의견' }, 'bob')).json();

  // persisted across restarts
  handler = createBoardApi(directory, { authenticate, requireVerifiedEmail: true });
  let list = await (await get('community')).json();
  assert.equal(list.posts.length, 1);
  assert.equal(list.posts[0].text, '<b>첫 글</b>');
  assert.equal(list.posts[0].reportCount, undefined, 'report details are admin-only');

  // likes toggle on policy only
  assert.equal((await post('/api/board/like', { postId: first.id }, 'bob')).status, 400);
  let like = await (await post('/api/board/like', { postId: policy.post.id }, 'alice')).json();
  assert.deepEqual(like, { likes: 1, liked: true });
  like = await (await post('/api/board/like', { postId: policy.post.id }, 'alice')).json();
  assert.deepEqual(like, { likes: 0, liked: false });

  // reports: duplicate blocked, three reports hide the post
  assert.equal((await post('/api/board/report', { postId: first.id, reason: '' }, 'bob')).status, 400);
  assert.equal((await post('/api/board/report', { postId: first.id, reason: '욕설' }, 'bob')).status, 200);
  assert.equal((await post('/api/board/report', { postId: first.id, reason: '욕설' }, 'bob')).status, 409);
  assert.equal((await post('/api/board/report', { postId: first.id, reason: '허위' }, 'carol')).status, 200);
  const third = await (await post('/api/board/report', { postId: first.id, reason: '광고' }, 'dave')).json();
  assert.equal(third.hidden, true);
  assert.equal((await (await get('community')).json()).posts.length, 0);
  const adminView = await (await get('community', 'admin')).json();
  assert.equal(adminView.posts[0].hidden, true);
  assert.equal(adminView.posts[0].reportCount, 3);

  // only admins moderate; authors cannot delete
  assert.equal((await post('/api/board/moderate', { postId: first.id, action: 'delete' }, 'alice')).status, 403);
  assert.equal((await post('/api/board/moderate', { postId: first.id, action: 'restore' }, 'admin')).status, 200);
  list = await (await get('community')).json();
  assert.equal(list.posts.length, 1);
  assert.equal((await post('/api/board/moderate', { postId: first.id, action: 'delete' }, 'admin')).status, 200);
  assert.equal((await (await get('community', 'admin')).json()).posts.length, 0);

  // account deletion anonymizes authorship
  await handler.anonymizeUser('u-bob');
  const researchList = await (await get('research', 'alice')).json();
  assert.equal(researchList.posts[0].authorName, '탈퇴한 회원');
  const stored = JSON.parse(await fs.readFile(path.join(directory, 'board.json'), 'utf8'));
  assert.ok(!JSON.stringify(stored).includes('u-bob'));
  assert.equal((await fetch(`${origin}/api/board`, { method: 'POST' })).status, 405);
});

test('authors can edit their own posts; others, hidden posts and empty edits are refused; admins see earlier versions', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'space-board-edit-'));
  const handler = createBoardApi(directory, { authenticate, requireVerifiedEmail: true });
  const server = createServer((request, response) => handler(request, response, new URL(request.url, 'http://x').pathname));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body, user) => fetch(origin + route, { method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': 'ok', ...(user ? { 'x-test-user': user } : {}) } });
  const list = async (board, user) => (await (await fetch(`${origin}/api/board?board=${board}`, { headers: user ? { 'x-test-user': user } : {} })).json()).posts;

  const { post: voice } = await (await post('/api/board/posts', { board: 'voice', category: '민원이 불편했어요', text: '처음 내용' }, 'alice')).json();
  const edited = await post('/api/board/edit', { postId: voice.id, category: '이 정책, 이상해요', text: '고친 내용' }, 'alice');
  assert.equal(edited.status, 200);
  const { post: after } = await edited.json();
  assert.equal(after.text, '고친 내용');
  assert.equal(after.category, '이 정책, 이상해요');
  assert.ok(after.editedAt);
  assert.equal((await list('voice'))[0].text, '고친 내용');
  assert.equal((await post('/api/board/edit', { postId: voice.id, category: '이 정책, 이상해요', text: '고친 내용' }, 'alice')).status, 400, 'no change');
  assert.equal((await post('/api/board/edit', { postId: voice.id, text: '남의 글' }, 'bob')).status, 403);
  assert.equal((await post('/api/board/edit', { postId: voice.id, text: '인증 전' }, 'dave')).status, 403);
  assert.equal((await post('/api/board/edit', { postId: voice.id, text: '로그인 전' })).status, 401);
  assert.equal((await post('/api/board/edit', { postId: voice.id, category: '없는 분류', text: '바꿈' }, 'alice')).status, 400);
  assert.equal((await post('/api/board/edit', { postId: 'missing', text: '바꿈' }, 'alice')).status, 404);
  assert.deepEqual((await list('voice', 'admin'))[0].history.map(entry => entry.text), ['처음 내용']);
  assert.equal((await list('voice', 'bob'))[0].history, undefined);

  const { post: research } = await (await post('/api/board/posts', { board: 'research', category: '논문', title: '제목', text: '본문' }, 'bob')).json();
  assert.equal((await post('/api/board/edit', { postId: research.id, title: '', text: '본문2' }, 'bob')).status, 400, 'title required');
  assert.equal((await post('/api/board/edit', { postId: research.id, title: '새 제목', text: '본문2' }, 'bob')).status, 200);

  for (const user of ['bob', 'carol', 'admin']) await post('/api/board/report', { postId: voice.id, reason: '허위' }, user);
  assert.equal((await post('/api/board/edit', { postId: voice.id, text: '숨김 뒤 수정' }, 'alice')).status, 409);
});
