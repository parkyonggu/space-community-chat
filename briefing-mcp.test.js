const test = require('node:test');
const assert = require('node:assert/strict');
const { createNewsletterApi } = require('./newsletter-api');
const { DatabaseSync } = require('node:sqlite');
const { createBriefingMcp, briefingMarkup } = require('./briefing-mcp');
const { createBriefingStore, renderBriefingPage, renderBriefingList } = require('./briefing-pages');
const { renderMarkup } = require('./newsletter-api');

// Durable Object의 sql.exec 와 같은 모양(행 배열을 돌려줌)으로 node:sqlite를 감싼다.
function memorySql() {
  const db = new DatabaseSync(':memory:');
  return { exec(query, ...params) { const statement = db.prepare(query); return /^\s*SELECT/i.test(query) ? statement.all(...params) : (statement.run(...params), []); } };
}

const token = n => String(n).repeat(48).slice(0, 48);
function fixture(audience) {
  const sent = [];
  let store = {
    subscribers: [
      { id: '11111111-1111-4111-8111-111111111111', email: 'kim@example.com', status: 'confirmed', consentAt: '2026-10-07T00:00:00Z', unsubToken: token('a') },
      { id: '22222222-2222-4222-8222-222222222222', email: 'lee@example.com', status: 'confirmed', consentAt: '2026-10-08T00:00:00Z', unsubToken: token('b') },
      { id: '33333333-3333-4333-8333-333333333333', email: 'wait@example.com', status: 'pending', unsubToken: token('c') },
    ],
    campaigns: [], meta: [{ id: 'state', day: '', sentToday: 0, migrated: true }], drafts: [],
  };
  const storage = { async read() { return JSON.parse(JSON.stringify(store)); }, async write(next) { store = JSON.parse(JSON.stringify(next)); } };
  const mailer = { configured: true, async send(message) { sent.push(message); } };
  const api = createNewsletterApi('/unused', {
    storage, mailer, authenticate: async () => ({ user: null }), siteUrl: 'https://withpluces.com',
    now: () => Date.parse('2026-10-31T00:00:00Z'), adminEmails: ['dragon600120@gmail.com'], batchSize: 10, senderName: '(주)위드플러시아',
  });
  let clock = Date.parse('2026-10-31T00:00:00Z');
  const pages = createBriefingStore(memorySql(), () => clock);
  const handle = createBriefingMcp({
    status: () => api.autoStatus(audience),
    send: input => api.autoBriefing({ ...input, audience }),
    publish: async input => { const saved = pages.upsert(input); return { updated: saved.updated, url: `https://withpluces.com${saved.path}` }; },
  });
  let id = 0;
  const call = async (name, args) => (await handle('POST', { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } })).body.result;
  return { api, handle, call, sent, store: () => store, pages, tick: ms => { clock += ms; } };
}

const ARGS = {
  subject: '주간시장동향분석 및 전망 (10/26~10/30)',
  body: '[주간시장동향 10/26~10/30]\n· 나스닥 −2.00%(−518.34p)\n· 코스피 +3.25%(+180.44p)\n※ 투자 판단과 책임은 투자자 본인에게 있습니다.',
  link_url: 'https://claude.ai/artifact/CnvsYX6WyzGjtPn49wPcgy',
  dedupe_key: 'weekly-2026-10-30',
};

test('MCP handshake and tool list', async () => {
  const { handle } = fixture('operator');
  const init = await handle('POST', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(init.body.result.protocolVersion, '2025-06-18');
  assert.equal((await handle('POST', { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
  const list = await handle('POST', { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(list.body.result.tools.map(tool => tool.name), ['briefing_publish', 'spaceletter_status', 'spaceletter_send_briefing']);
  assert.equal((await handle('GET')).status, 405);
});

test('operator mode sends one [검토용] mail to the admin only, once per key', async () => {
  const { call, sent, store } = fixture('operator');
  const status = JSON.parse((await call('spaceletter_status', {})).content[0].text);
  assert.equal(status.audience, 'operator');
  assert.equal(status.recipients, 1);
  const first = await call('spaceletter_send_briefing', ARGS);
  assert.ok(!first.isError, first.content[0].text);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'dragon600120@gmail.com');
  assert.match(sent[0].subject, /^\[검토용\] 주간시장동향/);
  assert.match(sent[0].html, /전문 보기/);
  assert.match(sent[0].text, /수신거부/);
  const again = await call('spaceletter_send_briefing', ARGS);
  assert.match(again.content[0].text, /이미 처리한 브리핑/);
  assert.equal(sent.length, 1);
  assert.equal(store().campaigns.length, 0, 'operator mode must not create a subscriber campaign');
});

test('subscribers mode queues a normal campaign for confirmed subscribers only', async () => {
  const { api, call, sent, store } = fixture('subscribers');
  const status = JSON.parse((await call('spaceletter_status', {})).content[0].text);
  assert.equal(status.recipients, 2);
  const result = await call('spaceletter_send_briefing', ARGS);
  assert.ok(!result.isError, result.content[0].text);
  assert.match(result.content[0].text, /구독자 2명/);
  assert.equal(store().campaigns.length, 1);
  assert.equal(store().campaigns[0].createdBy, '자동 브리핑');
  await api.processQueue();
  assert.deepEqual(sent.map(mail => mail.to).sort(), ['kim@example.com', 'lee@example.com']);
  for (const mail of sent) {
    assert.equal(mail.subject, ARGS.subject);
    assert.match(mail.html, /unsubscribe=/);
    assert.match(mail.html, /\/n\/c\//, 'links are tracked like other letters');
  }
  assert.equal(store().campaigns[0].status, 'done');
  const again = await call('spaceletter_send_briefing', ARGS);
  assert.match(again.content[0].text, /이미 처리한 브리핑/);
  assert.equal(store().campaigns.length, 1);
});

test('rejects bad input without sending', async () => {
  const { call, sent } = fixture('subscribers');
  assert.equal((await call('spaceletter_send_briefing', { ...ARGS, dedupe_key: 'X' })).isError, true);
  assert.equal((await call('spaceletter_send_briefing', { ...ARGS, link_url: 'javascript:alert(1)' })).isError, true);
  assert.equal((await call('spaceletter_send_briefing', { ...ARGS, subject: '' })).isError, true);
  assert.equal(sent.length, 0);
});

test('email markup: one line per paragraph, provider line, link at the end', () => {
  const markup = briefingMarkup('주간 시장동향 (10/26~10/30)', '첫 줄\n· 나스닥 −2.00%\n\n· 코스피 +3.25%', 'https://withpluces.com/briefing/weekly/2026-10-30');
  assert.equal(markup, '# 주간 시장동향 (10/26~10/30)\n\n제공: 스페이스커뮤니티\n\n첫 줄\n\n▪ 나스닥 −2.00%\n\n▪ 코스피 +3.25%\n\n**전문 보기** → [스페이스커뮤니티에서 전체 분석 읽기](https://withpluces.com/briefing/weekly/2026-10-30)');
  const html = renderMarkup(markup).html;
  assert.equal((html.match(/<p /g) || []).length, 5, 'each line is its own paragraph on phones');
  assert.match(html, /href="https:\/\/withpluces\.com\/briefing\/weekly\/2026-10-30"/);
});

test('briefing_publish stores weekly and monthly pages separately and renders them', async () => {
  const { call, pages, tick } = fixture('operator');
  const body = '## 1. 요약\n나스닥이 내렸습니다.\n\n| 지수 | 종가 | 주간 |\n| --- | --- | --- |\n| 나스닥 | 25,437.00 | −2.00%(−518.34p) |\n\n[출처](https://example.com/a)';
  let out = await call('briefing_publish', { kind: 'weekly', period: '2026-10-30', title: '주간 시장동향 (10/26~10/30)', summary: '나스닥 −2.00%', body });
  assert.ok(!out.isError, out.content[0].text);
  assert.match(out.content[0].text, /게시했습니다: https:\/\/withpluces\.com\/briefing\/weekly\/2026-10-30/);
  tick(60000);
  out = await call('briefing_publish', { kind: 'weekly', period: '2026-10-30', title: '주간 시장동향 (10/26~10/30)', body: body + '\n추가' });
  assert.match(out.content[0].text, /고쳐 올렸습니다/);
  await call('briefing_publish', { kind: 'monthly', period: '2026-10', title: '월간 시장동향 (2026년 10월)', body: '## 요약\n10월' });
  assert.equal((await call('briefing_publish', { kind: 'weekly', period: '2026-10', title: 'x', body: 'y' })).isError, true, 'weekly needs a full date');
  assert.equal((await call('briefing_publish', { kind: 'daily', period: '2026-10-30', title: 'x', body: 'y' })).isError, true);

  const weekly = pages.get('weekly', '2026-10-30');
  assert.ok(weekly.updatedAt > weekly.publishedAt);
  assert.equal(pages.list('weekly').length, 1);
  assert.equal(pages.list('monthly').length, 1);
  const html = renderBriefingPage({ report: weekly, others: pages.list('weekly') });
  assert.match(html, /<table/);
  assert.match(html, /제공 스페이스커뮤니티/);
  assert.match(html, /주간 시장동향/);
  assert.doesNotMatch(html, /주간·월간|월간 시장동향 브리핑/);
  assert.match(html, /투자 판단과 책임은 투자자 본인에게/);
  assert.match(html, /target="_blank"/);
  assert.doesNotMatch(html, /target="_blank"[^>]*target=/, 'no duplicate attributes');
  assert.match(renderBriefingList('monthly', pages.list('monthly')), /월간 시장동향 브리핑/);
});


test('publish reports the 스페이스톡 result, and briefing_post_talk re-posts a missed briefing once', async () => {
  const pages = createBriefingStore(memorySql());
  const posted = new Set();
  const toTalk = report => {
    const key = `${report.kind}:${report.slug}`;
    if (posted.has(key)) return { status: 'skipped' };
    posted.add(key);
    return { status: 'posted', subscribers: 3, channel: '📈 시장동향 브리핑' };
  };
  const handle = createBriefingMcp({
    status: async () => ({}), send: async () => ({}),
    publish: async input => { const saved = pages.upsert(input); return { updated: saved.updated, url: `https://withpluces.com${saved.path}`, talk: toTalk(saved) }; },
    postTalk: async ({ kind, period }) => { const report = pages.get(kind, period); return report ? { found: true, url: 'u', talk: toTalk(report) } : { found: false }; },
  });
  const call = async (name, args) => (await handle('POST', { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } })).body.result;
  const list = await handle('POST', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.ok(list.body.result.tools.some(tool => tool.name === 'briefing_post_talk'));
  const first = await call('briefing_publish', { kind: 'monthly', period: '2026-10', title: '월간 시장동향 (2026년 10월)', body: '## 1. 요약\n내용' });
  assert.match(first.content[0].text, /채널에 올렸습니다\(받는 사람 3명\)/);
  const again = await call('briefing_publish', { kind: 'monthly', period: '2026-10', title: '월간 시장동향 (2026년 10월)', body: '## 1. 요약\n고친 내용' });
  assert.match(again.content[0].text, /고쳐 올렸습니다.*이미 올라간/);
  posted.clear();
  const missed = await call('briefing_post_talk', { kind: 'monthly', period: '2026-10' });
  assert.match(missed.content[0].text, /채널에 올렸습니다/);
  const none = await call('briefing_post_talk', { kind: 'weekly', period: '2026-10-23' });
  assert.equal(none.isError, true);
});
