const test = require('node:test');
const assert = require('node:assert/strict');
const { createSlackNotifier, maskEmail } = require('./slack-notify');

const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/xxxx';

test('웹후크 주소가 없거나 슬랙 주소가 아니면 보내지 않는다', async () => {
  let called = 0;
  const fetchImpl = async () => { called += 1; return { ok: true }; };
  assert.equal(createSlackNotifier({ fetchImpl }).ready, false);
  assert.equal(createSlackNotifier({ webhookUrl: 'https://example.com/hook', fetchImpl }).ready, false);
  assert.equal(await createSlackNotifier({ fetchImpl }).signup({ nickname: '가' }), false);
  assert.equal(called, 0);
});

test('가입 알림은 이메일을 가리고, 사용자 글의 <>&는 바꿔서 보낸다', async () => {
  const sent = [];
  const slack = createSlackNotifier({ webhookUrl: WEBHOOK, fetchImpl: async (url, options) => { sent.push({ url, body: JSON.parse(options.body) }); return { ok: true }; } });
  await slack.signup({ nickname: '홍길동', email: 'gildong@example.com' });
  await slack.comment({ name: '<b>', text: '좋아요 <@everyone> & 감사' });
  assert.equal(sent[0].url, WEBHOOK);
  assert.match(sent[0].body.text, /홍길동 \(gi\*+@example\.com\)/);
  assert.ok(!sent[0].body.text.includes('gildong@'));
  assert.match(sent[1].body.text, /&lt;b&gt;/);
  assert.match(sent[1].body.text, /&lt;@everyone&gt; &amp; 감사/);
  assert.equal(sent[1].body.unfurl_links, false);
});

test('새 글은 게시판 이름과 글 주소를, 공유는 우리 사이트 주소일 때만 보낸다', async () => {
  const sent = [];
  const slack = createSlackNotifier({ webhookUrl: WEBHOOK, siteUrl: 'https://withpluces.com', fetchImpl: async (url, options) => { sent.push(JSON.parse(options.body).text); return { ok: true }; } });
  await slack.post({ board: 'voice', title: '', text: '첫 줄 제목\n본문', authorName: '시민', no: 12 });
  assert.match(sent[0], /시민의 소리/);
  assert.match(sent[0], /첫 줄 제목/);
  assert.match(sent[0], /https:\/\/withpluces\.com\/post\/12/);
  assert.equal(await slack.share({ title: '외부', url: 'https://evil.example/x' }), false);
  await slack.share({ title: '학술행사 안내', url: 'https://withpluces.com/post/12' });
  assert.equal(sent.length, 2);
  assert.equal(maskEmail('ab@x.kr'), 'ab*@x.kr');
});

test('붙여 넣을 때 섞인 앞뒤 빈칸·줄바꿈·따옴표는 떼고 쓴다', () => {
  assert.equal(createSlackNotifier({ webhookUrl: `  ${WEBHOOK}\n` }).ready, true);
  assert.equal(createSlackNotifier({ webhookUrl: `"${WEBHOOK}"` }).ready, true);
});
