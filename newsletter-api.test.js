const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('node:http');
const { createNewsletterApi, renderMarkup } = require('./newsletter-api');

const admin = { id: 'u-admin', email: 'admin@example.com', nickname: '운영자', emailVerified: true, admin: true };
const member = { id: 'u-member', email: 'member@example.com', nickname: '회원', emailVerified: true, admin: false };
async function authenticate(request, { csrf = false } = {}) {
  const user = { admin, member }[request.headers['x-test-user']] || null;
  if (csrf && request.headers['x-csrf-token'] !== 'ok') return { error: { status: 403, message: 'csrf' } };
  return { user };
}

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'space-newsletter-test-'));
  const sent = [];
  const mailer = { configured: true, failFor: new Set(), async send(message) {
    if (this.failFor.has(message.to)) { const error = new Error('fail'); error.code = 'E_TEST'; throw error; }
    sent.push(message);
  } };
  let clock = Date.parse('2026-10-06T03:00:00Z');
  let legacy = options.legacy || [];
  const config = { authenticate, mailer, siteUrl: 'https://withpluces.com', now: () => clock, dailyLimit: options.dailyLimit || 300, batchSize: 2,
    legacySubscribers: async () => legacy, clearLegacySubscribers: async () => { legacy = []; }, senderName: '(주)테스트', contactEmail: 'help@example.com', ...(options.extra || {}) };
  let handler = createNewsletterApi(directory, config);
  const server = createServer((request, response) => handler(request, response, new URL(request.url, 'http://x').pathname));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body, user) => fetch(origin + route, { method: 'POST', redirect: 'manual', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': 'ok', ...(user ? { 'x-test-user': user } : {}) } });
  const get = (route, user) => fetch(origin + route, { redirect: 'manual', headers: user ? { 'x-test-user': user } : {} });
  const tokenFrom = (message, kind) => message.text.match(new RegExp(`${kind}=([a-f0-9]{48})`))[1];
  return { directory, sent, mailer, post, get, tokenFrom, legacy: () => legacy,
    advance: ms => { clock += ms; }, now: () => clock, generate: options => handler.generateWeekly(options), restart: () => { handler = createNewsletterApi(directory, config); },
    drain: async () => { let result; do { result = await handler.processQueue(); } while (result.more && result.delay < 3600000); return result; },
    process: () => handler.processQueue() };
}

test('markup renders safely with tracked links and no script injection', () => {
  const { html, links } = renderMarkup('# 제목 <script>\n\n**굵게** [링크](https://example.com/a) javascript:alert(1)\n\n![이미지](https://example.com/x.png)\n\n- 하나\n- [둘](javascript:alert(1))', (i, url) => `https://t/${i}`);
  assert.ok(html.includes('<h1'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<strong>굵게</strong>'));
  assert.ok(html.includes('href="https://t/0"'));
  assert.ok(!html.includes('href="javascript'));
  assert.ok(html.includes('<img src="https://example.com/x.png"'));
  assert.deepEqual(links, ['https://example.com/a']);
});

test('double opt-in, legacy migration, admin sending with daily limit, tracking and unsubscribe', async t => {
  const f = await fixture(t, { legacy: [{ email: 'old@example.com', requestedAt: '2026-10-01T00:00:00Z' }], dailyLimit: 3 });
  // public subscribe requires consent and sends confirmation mail
  assert.equal((await f.post('/api/newsletter', { email: 'a@example.com', consent: false })).status, 400);
  for (const email of ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com']) {
    assert.equal((await f.post('/api/newsletter', { email, consent: true })).status, 200);
  }
  assert.equal(f.sent.length, 4);
  assert.match(f.sent[0].subject, /구독 확인/);
  assert.ok(f.sent[0].html.includes('/newsletter?confirm='));
  assert.equal(f.legacy().length, 0, 'legacy list moved and cleared');

  // admin endpoints are protected
  assert.equal((await f.get('/api/admin/newsletter')).status, 401);
  assert.equal((await f.get('/api/admin/newsletter', 'member')).status, 403);
  let summary = await (await f.get('/api/admin/newsletter', 'admin')).json();
  assert.deepEqual(summary.subscribers, { confirmed: 0, pending: 4, legacy: 1, noticeDue: 0 });
  assert.equal((await f.post('/api/admin/newsletter/send', { subject: '제목', body: '본문' }, 'admin')).status, 400, 'no confirmed subscribers yet');

  // confirm three of them
  for (const message of f.sent.slice(0, 3)) {
    assert.equal((await f.post('/api/newsletter/confirm', { token: f.tokenFrom(message, 'confirm') })).status, 200);
  }
  assert.equal((await f.post('/api/newsletter/confirm', { token: f.tokenFrom(f.sent[0], 'confirm') })).status, 400, 'one-time token');
  assert.equal((await f.post('/api/newsletter', { email: 'a@example.com', consent: true })).status, 200);
  assert.equal(f.sent.length, 4, 'confirmed subscriber gets no extra mail');

  // preview & test send
  const preview = await (await f.post('/api/admin/newsletter/preview', { subject: '10월 소식', body: '# 안녕\n\n[보기](https://withpluces.com/x)', ad: true }, 'admin')).json();
  assert.equal(preview.subject, '(광고) 10월 소식');
  assert.ok(preview.html.includes('수신거부'));
  assert.ok(preview.html.includes('(주)테스트'));
  assert.equal((await f.post('/api/admin/newsletter/test', { subject: '10월 소식', body: '본문' }, 'member')).status, 403);
  assert.equal((await f.post('/api/admin/newsletter/test', { subject: '10월 소식', body: '본문' }, 'admin')).status, 200);
  assert.equal(f.sent.at(-1).to, 'admin@example.com');
  assert.match(f.sent.at(-1).subject, /^\[시험 발송\]/);

  // campaign send respects daily limit (3, 3 already confirmed + 1 failure)
  f.mailer.failFor.add('c@example.com');
  const before = f.sent.length;
  assert.equal((await f.post('/api/admin/newsletter/send', { subject: '10월 소식', body: '# 안녕\n\n[보기](https://withpluces.com/x)', ad: true }, 'admin')).status, 201);
  assert.equal((await f.post('/api/admin/newsletter/send', { subject: '중복', body: '본문' }, 'admin')).status, 409);
  await f.drain();
  const delivered = f.sent.slice(before);
  assert.equal(delivered.length, 2);
  assert.ok(delivered.every(message => message.subject === '(광고) 10월 소식'));
  assert.ok(delivered[0].html.includes('/n/o/'));
  assert.ok(delivered[0].html.includes('수신동의일'));
  summary = await (await f.get('/api/admin/newsletter', 'admin')).json();
  const campaign = summary.campaigns[0];
  assert.equal(campaign.status, 'done');
  assert.equal(campaign.sent, 2);
  assert.equal(campaign.failed, 1);
  assert.equal(summary.sentToday, 3);

  f.mailer.failFor.clear();

  // tracking: open pixel, click redirect only to stored links
  const pixel = delivered[0].html.match(/https:\/\/withpluces\.com(\/n\/o\/[^"]+)/)[1];
  const click = delivered[0].html.match(/https:\/\/withpluces\.com(\/n\/c\/[^"]+)/)[1];
  const opened = await f.get(pixel);
  assert.equal(opened.headers.get('content-type'), 'image/gif');
  const clicked = await f.get(click);
  assert.equal(clicked.status, 302);
  assert.equal(clicked.headers.get('location'), 'https://withpluces.com/x');
  const forged = await f.get(click.replace(/\/0$/, '/9'));
  assert.equal(forged.headers.get('location'), 'https://withpluces.com');
  summary = await (await f.get('/api/admin/newsletter', 'admin')).json();
  assert.equal(summary.campaigns[0].opens, 1);
  assert.equal(summary.campaigns[0].clicks, 1);

  // unsubscribe via token from the email
  const unsubscribeToken = delivered[0].text.match(/unsubscribe=([a-f0-9]{48})/)[1];
  assert.equal((await f.post('/api/newsletter/unsubscribe', { token: unsubscribeToken })).status, 200);
  summary = await (await f.get('/api/admin/newsletter', 'admin')).json();
  assert.equal(summary.campaigns[0].unsubscribes, 1);
  assert.equal(summary.subscribers.confirmed, 2);
  const stored = await fs.readFile(path.join(f.directory, 'newsletter.json'), 'utf8');
  assert.ok(!stored.includes(delivered[0].to));

  // reconfirm legacy + pending waits for the next day because of the daily limit
  assert.equal((await f.post('/api/admin/newsletter/reconfirm', {}, 'admin')).status, 201);
  const waiting = await f.process();
  assert.equal(waiting.more, true);
  assert.ok(waiting.delay > 3600000);
  f.advance(24 * 60 * 60 * 1000);
  const count = f.sent.length;
  await f.drain();
  const confirms = f.sent.slice(count);
  assert.deepEqual(confirms.map(message => message.to).sort(), ['d@example.com', 'old@example.com']);
  assert.ok(confirms.every(message => /구독 확인/.test(message.subject)));

  // two-year notice
  f.advance(2 * 365 * 24 * 60 * 60 * 1000);
  summary = await (await f.get('/api/admin/newsletter', 'admin')).json();
  assert.equal(summary.subscribers.noticeDue, 2);
  assert.equal((await f.post('/api/admin/newsletter/notice', {}, 'admin')).status, 201);
  await f.drain();
  assert.match(f.sent.at(-1).subject, /수신동의 안내/);
  summary = await (await f.get('/api/admin/newsletter', 'admin')).json();
  assert.equal(summary.subscribers.noticeDue, 0);

  // email-based unsubscribe and method checks
  assert.equal((await f.post('/api/newsletter/unsubscribe', { email: 'B@example.com' })).status, 200);
  assert.equal((await f.get('/api/newsletter')).status, 405);
  const list = await (await f.get('/api/admin/newsletter/subscribers', 'admin')).json();
  assert.ok(!list.subscribers.some(entry => entry.email === 'b@example.com'));
  f.restart();
  assert.equal((await (await f.get('/api/admin/newsletter', 'admin')).json()).campaigns.length, 3);
});

test('cancel stops a running campaign', async t => {
  const f = await fixture(t);
  for (const email of ['x1@example.com', 'x2@example.com', 'x3@example.com', 'x4@example.com', 'x5@example.com']) {
    await f.post('/api/newsletter', { email, consent: true });
  }
  for (const message of [...f.sent]) await f.post('/api/newsletter/confirm', { token: f.tokenFrom(message, 'confirm') });
  await f.post('/api/admin/newsletter/send', { subject: 's', body: 'b' }, 'admin');
  await f.process();
  const { campaigns } = await (await f.get('/api/admin/newsletter', 'admin')).json();
  assert.equal(campaigns[0].sent, 2);
  assert.equal((await f.post('/api/admin/newsletter/cancel', { id: campaigns[0].id }, 'admin')).status, 200);
  const after = await (await f.get('/api/admin/newsletter', 'admin')).json();
  assert.equal(after.campaigns[0].status, 'cancelled');
  assert.equal(after.campaigns[0].remaining, 0);
  assert.equal((await f.process()).more, false);
});

test('weekly draft uses ECOS figures and community highlights, blocks unfinished sends and schedules for Monday 07:00 KST', async t => {
  const series = {
    '802Y001/0001000': [['20260925', '6800'], ['20260929', '6870.81'], ['20261002', '7003.74']],
    '802Y001/0089000': [['20260925', '880'], ['20261002', '893.29']],
    '731Y001/0000001': [['20260925', '1370'], ['20261002', '1358.5']],
    '817Y002/010200000': [['20260925', '3.9'], ['20261002', '3.937']],
    '722Y001/0101000': [['20260810', '2.75']],
    '901Y009/0': [['202609', '120.43']],
  };
  const requested = [];
  const fetchImpl = async url => {
    requested.push(url);
    const parts = new URL(url).pathname.split('/');
    const code = parts[8]; const item = parts[12]; const start = parts[10];
    let rows = series[`${code}/${item}`] || [];
    if (code === '901Y009' && start === '202509') rows = [['202509', '118.0']];
    return { ok: true, json: async () => ({ StatisticSearch: { row: rows.map(([TIME, DATA_VALUE]) => ({ TIME, DATA_VALUE })) } }) };
  };
  const highlights = async () => ({ policy: [{ category: 'education', text: '교육 정책 제안 내용', likes: 4 }], voice: [{ category: '이 정책, 이상해요', text: '시민의 소리 내용' }], community: [], researchCount: 2 });
  const f = await fixture(t, { extra: { fetchImpl, highlights, adminEmails: ['admin@example.com'], ecosKey: 'TESTKEY' } });
  // Sunday 2026-10-04 18:00 KST
  f.advance(Date.parse('2026-10-04T09:00:00Z') - f.now());
  const draft = await f.generate({ source: 'auto' });
  assert.ok(requested.every(url => url.includes('/TESTKEY/')));
  assert.match(draft.subject, /10월 5일 주간 경제·정책 브리핑/);
  assert.ok(draft.body.includes('**KOSPI** 7,003.74 (1주 전 대비 +3.00%)'));
  assert.ok(draft.body.includes('**원/달러 환율** 1,358.5원 (1주 전 대비 −11.5원)'));
  assert.ok(draft.body.includes('**국고채 3년 금리** 3.937% (1주 전 대비 +0.037%p)'));
  assert.ok(draft.body.includes('연 2.75%'));
  assert.ok(draft.body.includes('전년 동월 대비 +2.1%'));
  assert.ok(draft.body.includes('**[정책 제안 · 교육부]** 교육 정책 제안 내용 (추천 4)'));
  assert.ok(draft.body.includes('새 글 2편'));
  assert.ok(draft.body.includes('[직접 작성]'));
  assert.ok(draft.body.includes('매매를 권유하지 않습니다'));
  const notice = f.sent.at(-1);
  assert.equal(notice.to, 'admin@example.com');
  assert.match(notice.text, /10월 5일\(월\) 07:00/);

  let summary = await (await f.get('/api/admin/newsletter', 'admin')).json();
  assert.equal(summary.drafts.length, 1);
  assert.equal(summary.nextMonday, '2026-10-04T22:00:00.000Z');
  const loaded = await (await f.post('/api/admin/newsletter/draft/get', { id: summary.drafts[0].id }, 'admin')).json();
  assert.equal(loaded.draft.body, draft.body);

  // a subscriber confirms
  await f.post('/api/newsletter', { email: 'reader@example.com', consent: true });
  await f.post('/api/newsletter/confirm', { token: f.tokenFrom(f.sent.at(-1), 'confirm') });

  // unfinished draft cannot be sent or scheduled; test send is allowed
  assert.equal((await f.post('/api/admin/newsletter/send', { subject: draft.subject, body: draft.body }, 'admin')).status, 400);
  assert.equal((await f.post('/api/admin/newsletter/send', { subject: draft.subject, body: draft.body, schedule: 'monday' }, 'admin')).status, 400);
  assert.equal((await f.post('/api/admin/newsletter/test', { subject: draft.subject, body: draft.body }, 'admin')).status, 200);

  const finished = draft.body.replaceAll('[직접 작성]', '');
  const scheduled = await f.post('/api/admin/newsletter/send', { subject: draft.subject, body: finished, schedule: 'monday' }, 'admin');
  assert.equal(scheduled.status, 201);
  assert.match((await scheduled.json()).message, /10월 5일\(월\) 07:00/);
  assert.equal((await f.post('/api/admin/newsletter/send', { subject: 'x', body: 'y' }, 'admin')).status, 409);
  const before = f.sent.length;
  const waiting = await f.process();
  assert.equal(waiting.more, true);
  assert.ok(Math.abs(waiting.delay - 13 * 60 * 60 * 1000) < 1000, 'waits until Monday 07:00 KST');
  assert.equal(f.sent.length, before);
  // a late subscriber before Monday is included
  await f.post('/api/newsletter', { email: 'late@example.com', consent: true });
  await f.post('/api/newsletter/confirm', { token: f.tokenFrom(f.sent.at(-1), 'confirm') });
  f.advance(13 * 60 * 60 * 1000);
  await f.drain();
  const delivered = f.sent.slice(before + 1).filter(message => message.subject === draft.subject);
  assert.deepEqual(delivered.map(message => message.to).sort(), ['late@example.com', 'reader@example.com']);
  summary = await (await f.get('/api/admin/newsletter', 'admin')).json();
  assert.equal(summary.campaigns[0].status, 'done');
  assert.equal(summary.campaigns[0].sent, 2);

  // scheduling can be cancelled
  assert.equal((await f.post('/api/admin/newsletter/send', { subject: 's2', body: 'b2', schedule: 'monday' }, 'admin')).status, 201);
  summary = await (await f.get('/api/admin/newsletter', 'admin')).json();
  const pending = summary.campaigns.find(entry => entry.status === 'scheduled');
  assert.equal((await f.post('/api/admin/newsletter/cancel', { id: pending.id }, 'admin')).status, 200);
  assert.equal((await f.process()).more, false);
});

test('draft generation degrades gracefully when ECOS is unavailable', async t => {
  const f = await fixture(t, { extra: { fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) } });
  const draft = await f.generate({ notify: false });
  assert.ok(draft.body.includes('**KOSPI** 자료를 불러오지 못했습니다'));
  assert.ok(draft.body.includes('새로 올라온 글이 없습니다'));
});
