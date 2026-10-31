const test = require('node:test');
const assert = require('node:assert/strict');
const { createNewsletterApi } = require('./newsletter-api');
const { createBriefingMcp, briefingMarkup } = require('./briefing-mcp');

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
  const handle = createBriefingMcp({
    status: () => api.autoStatus(audience),
    send: input => api.autoBriefing({ ...input, audience }),
  });
  let id = 0;
  const call = async (name, args) => (await handle('POST', { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } })).body.result;
  return { api, handle, call, sent, store: () => store };
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
  assert.deepEqual(list.body.result.tools.map(tool => tool.name), ['spaceletter_status', 'spaceletter_send_briefing']);
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

test('markup keeps lines and adds the link', () => {
  const markup = briefingMarkup('제목', 'a\nb', 'https://example.com');
  assert.equal(markup, '# 제목\n\na\nb\n\n[전문 보기](https://example.com)');
});
