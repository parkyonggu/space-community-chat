const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRss, pickIssues, cleanManual } = require('./news-issues');
const { createPortalApi } = require('./portal-api');
const { createBoardApi } = require('./board-api');

const rss = items => `<?xml version='1.0' encoding='UTF-8'?><rss version="2.0"><channel><title><![CDATA[매일경제]]></title>${items.map(([no, path, title, at = 'Sat, 10 Oct 2026 07:41:33 +09:00']) => `
  <item><no>${no}</no><title><![CDATA[${title}]]></title><link><![CDATA[https://www.mk.co.kr/news/${path}/${no}]]></link>
  <category><![CDATA[헤드라인]]></category><pubDate>${at}</pubDate><description><![CDATA[본문 요약은 쓰지 않는다]]></description></item>`).join('')}</channel></rss>`;

const FEEDS = {
  '30000001': rss([[1, 'economy', '매경이 전하는 세상의 지식 (매-세-지, 10월 10일)'], [2, 'economy', '“강남집 내놨는데 문의도 없네요”'], [3, 'politics', '여야, 국정감사 첫날부터 충돌'],
    [4, 'politics', '北 탄도미사일 발사…합참 “정밀 분석 중”'], [5, 'world', '미중 관세 전쟁 다시 격화'], [6, 'society', '건보공단 청구에 법원은?']]),
  '30200030': rss([[3, 'politics', '여야, 국정감사 첫날부터 충돌'], [4, 'politics', '北 탄도미사일 발사…합참 “정밀 분석 중”'], [7, 'politics', '대통령실 개편안 발표']]),
  '30100041': rss([[2, 'economy', '“강남집 내놨는데 문의도 없네요”']]),
  '50400012': rss([[6, 'society', '건보공단 청구에 법원은?']]),
  '30300018': rss([[5, 'world', '미중 관세 전쟁 다시 격화'], [8, 'world', '나토 정상들 방위비 합의']]),
  '30000023': rss([[9, 'culture', '부산국제영화제 폐막']]),
};

test('parses MK RSS without keeping article text and skips daily corners', () => {
  const items = parseRss(FEEDS['30000001']);
  assert.equal(items.length, 5, 'the 매-세-지 corner is skipped');
  assert.deepEqual(Object.keys(items[0]).sort(), ['at', 'link', 'no', 'path', 'title']);
  assert.equal(items[0].link, 'https://www.mk.co.kr/news/economy/2');
  assert.equal(items[0].at, '2026-10-09T22:41:33.000Z');
});

test('picks one issue per field, defense first, in headline order', () => {
  const feeds = Object.fromEntries(Object.entries({ headline: '30000001', politics: '30200030', economy: '30100041', society: '50400012', world: '30300018', culture: '30000023' })
    .map(([name, code]) => [name, parseRss(FEEDS[code])]));
  const picks = Object.fromEntries(pickIssues(feeds).map(item => [item.field, item]));
  assert.equal(picks.defense.title, '北 탄도미사일 발사…합참 “정밀 분석 중”');
  assert.equal(picks.politics.title, '여야, 국정감사 첫날부터 충돌');
  assert.equal(picks.economy.id, 'mk-2');
  assert.equal(picks.world.title, '미중 관세 전쟁 다시 격화', '"관세 전쟁" is not defense');
  assert.equal(picks.society.headline, true);
  assert.equal(picks.culture.title, '부산국제영화제 폐막', 'falls back to the section feed');
  assert.equal(picks.culture.headline, false);
});

test('validates manual picks', () => {
  assert.equal(cleanManual({ field: 'defense', title: ' 국방 기사 ', link: 'https://www.mk.co.kr/news/politics/12170000' }).id, 'mk-12170000');
  assert.match(cleanManual({ field: 'culture', title: '다른 신문', link: 'https://example.com/a/b' }).id, /^m-/);
  assert.throws(() => cleanManual({ field: 'culture', title: 'x', link: 'javascript:alert(1)' }), /주소/);
  assert.throws(() => cleanManual({ field: 'sports', title: 'x', link: 'https://a.b' }), /분야/);
});

function mkFetch(calls) {
  return async url => {
    calls.push(url);
    const code = /rss\/(\d+)\//.exec(url)?.[1];
    return { ok: true, status: 200, text: async () => FEEDS[code] || '' };
  };
}
function call(api, url, { method = 'GET', body } = {}) {
  return new Promise(resolve => {
    const chunks = body ? [Buffer.from(JSON.stringify(body))] : [];
    const request = { method, url, headers: { 'content-type': 'application/json' }, socket: { remoteAddress: '1.1.1.1' }, async *[Symbol.asyncIterator]() { yield* chunks; } };
    const response = { writeHead(code) { this.code = code; }, setHeader() {}, end(payload) { resolve({ status: this.code, body: JSON.parse(payload) }); } };
    api(request, response, new URL(url, 'http://x').pathname);
  });
}

test('issues endpoint refreshes hourly until noon, then locks; admin can override', async () => {
  const calls = [];
  let clock = Date.parse('2026-10-09T23:00:00Z'); // 10/10 08:00 KST
  const admin = { user: { id: 'a', admin: true } };
  const api = createPortalApi({ fetchImpl: mkFetch(calls), now: () => clock, authenticate: async () => admin });
  const first = await call(api, '/api/portal/issues');
  assert.equal(first.status, 200);
  assert.equal(first.body.today, '20261010');
  assert.equal(first.body.items.length, 6);
  assert.equal(first.body.locked, false);
  assert.deepEqual(first.body.dates, ['20261010']);
  const count = calls.length;
  await call(api, '/api/portal/issues');
  assert.equal(calls.length, count, 'served from storage within the hour');

  const set = await call(api, '/api/portal/issues/admin', { method: 'POST', body: { action: 'set', field: 'culture', title: '운영자가 고른 문화 기사', link: 'https://www.mk.co.kr/news/culture/12170001' } });
  assert.equal(set.status, 200);
  clock = Date.parse('2026-10-10T03:30:00Z'); // 12:30 KST → refresh and lock
  const noon = await call(api, '/api/portal/issues');
  assert.equal(noon.body.locked, true);
  assert.equal(noon.body.items.find(item => item.field === 'culture').title, '운영자가 고른 문화 기사');
  const locked = calls.length;
  clock += 2 * 60 * 60 * 1000;
  await call(api, '/api/portal/issues');
  assert.equal(calls.length, locked, 'no refetch after the day is locked');

  await call(api, '/api/portal/issues/admin', { method: 'POST', body: { action: 'hide', field: 'society' } });
  const hidden = await call(api, '/api/portal/issues');
  assert.equal(hidden.body.items.find(item => item.field === 'society').hidden, true);

  const past = await call(api, '/api/portal/issues?date=20261010');
  assert.equal(past.body.date, '20261010');
  const denied = createPortalApi({ fetchImpl: mkFetch([]), authenticate: async () => ({ user: { id: 'u' } }) });
  assert.equal((await call(denied, '/api/portal/issues/admin', { method: 'POST', body: { action: 'hide', field: 'society' } })).status, 403);
});

test('members can post a review attached to an issue', async () => {
  let store = { posts: [], likes: [], reports: [] };
  const storage = { read: async () => JSON.parse(JSON.stringify(store)), write: async value => { store = value; } };
  const user = { id: 'u1', nickname: '시민', emailVerified: true };
  const api = createBoardApi('/tmp/unused', { storage, authenticate: async () => ({ user }) });
  const issue = { id: 'mk-4', date: '20261010', title: '北 탄도미사일 발사', link: 'https://www.mk.co.kr/news/politics/4', source: '매일경제' };
  const created = await call(api, '/api/board/posts', { method: 'POST', body: { board: 'issue', category: '국방', text: '평론입니다.', issue } });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.post.issue, issue);
  const bad = await call(api, '/api/board/posts', { method: 'POST', body: { board: 'issue', category: '국방', text: '평론', issue: { ...issue, link: 'javascript:x' } } });
  assert.equal(bad.status, 400);
  const missing = await call(api, '/api/board/posts', { method: 'POST', body: { board: 'issue', category: '스포츠', text: '평론', issue } });
  assert.equal(missing.status, 400);
  const liked = await call(api, '/api/board/like', { method: 'POST', body: { postId: created.body.post.id } });
  assert.deepEqual(liked.body, { likes: 1, liked: true });
  const list = await call(api, '/api/board?board=issue');
  assert.equal(list.body.posts[0].issue.id, 'mk-4');
});
