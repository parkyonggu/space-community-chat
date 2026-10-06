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
    legacySubscribers: async () => legacy, clearLegacySubscribers: async () => { legacy = []; }, senderName: '(주)테스트', contactEmail: 'help@example.com' };
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
    advance: ms => { clock += ms; }, restart: () => { handler = createNewsletterApi(directory, config); },
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
