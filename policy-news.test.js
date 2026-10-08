const test = require('node:test');
const assert = require('node:assert/strict');
const { weeklyPolicyNews, recentPolicyNews, parseNews, isTypeOne } = require('./policy-news');
const { buildWeeklyDraft } = require('./weekly-brief');

const item = fields => `<NewsItem>${Object.entries(fields).map(([key, value]) => `<${key}><![CDATA[${value}]]></${key}>`).join('')}</NewsItem>`;
const xml = items => `<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>0</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body>${items.join('')}</body></response>`;

const sample = [
  item({ NewsItemId: '1', Title: '국민성장펀드 200조원으로 확대', SubTitle1: '첨단산업 경쟁력 강화 위해 지원 대상·직접투자 확대', MinisterCode: '금융위원회', ApproveDate: '10/08/2026 10:30:00', OriginalUrl: 'https://www.korea.kr/news/policyNewsView.do?newsId=1', KoglType: '1', DataContents: '<p>본문은 싣지 않는다</p>' }),
  item({ NewsItemId: '2', Title: '가을 축제 안내', MinisterCode: '문화체육관광부', ApproveDate: '10/07/2026 09:00:00', OriginalUrl: 'https://www.korea.kr/news/2', KoglType: '1' }),
  item({ NewsItemId: '3', Title: '주택 공급 대책 발표', MinisterCode: '국토교통부', ApproveDate: '10/06/2026 14:00:00', OriginalUrl: '/news/3', KoglType: '4' }),
  item({ NewsItemId: '4', Title: '소상공인 정책자금 금리 인하', SubTitle1: '정책서민금융 공급 확대', MinisterCode: '중소벤처기업부', ApproveDate: '10/05/2026 11:00:00', OriginalUrl: '/news/4', KoglType: '제1유형' }),
];

test('parses 정책브리핑 XML and keeps only 공공누리 제1유형 economy news with links, not body text', async () => {
  assert.equal(parseNews(xml(sample)).length, 4);
  assert.ok(isTypeOne('1') && isTypeOne('제1유형') && !isTypeOne('4') && !isTypeOne(''));
  assert.throws(() => parseNews('<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>'), /SERVICE_KEY/);
  const calls = [];
  const fetchImpl = async url => { calls.push(url); return { ok: true, status: 200, text: async () => xml(sample) }; };
  const result = await weeklyPolicyNews(fetchImpl, 'K+/=', Date.parse('2026-10-08T03:00:00Z'));
  assert.equal(calls.length, 3, 'three 3-day windows');
  assert.ok(calls[0].includes('serviceKey=K%2B%2F%3D') && calls[0].includes('startDate=20261001'));
  assert.equal(result.count, 2, 'festival (not economy) and 제4유형 dropped, duplicates merged');
  assert.match(result.lines[0], /\[금융위원회\] 국민성장펀드 200조원으로 확대\*\* \(10\/8\) — 첨단산업/);
  assert.match(result.lines[1], /\(https:\/\/www\.korea\.kr\/news\/4\)/, 'relative links made absolute');
  assert.ok(!result.lines.join('').includes('본문은 싣지 않는다'));
});

test('weekly draft fills "이번 주 정부 정책" from 정책브리핑 when the key is set', async () => {
  const fetchImpl = async url => {
    if (url.includes('policyNewsService2')) return { ok: true, status: 200, text: async () => xml(sample) };
    return { ok: true, status: 200, json: async () => ({ StatisticSearch: { row: [] } }), text: async () => '' };
  };
  const draft = await buildWeeklyDraft({ fetchImpl, ecosKey: 'K', policyKey: 'P', now: Date.parse('2026-10-08T03:00:00Z') });
  const section = draft.body.split('## 이번 주 정부 정책')[1].split('## 커뮤니티')[0];
  assert.match(section, /국민성장펀드 200조원으로 확대/);
  assert.match(draft.body, /대한민국 정책브리핑\(www\.korea\.kr, 공공누리 제1유형\)/);
  const withoutKey = await buildWeeklyDraft({ fetchImpl, ecosKey: 'K', now: Date.parse('2026-10-08T03:00:00Z') });
  assert.match(withoutKey.body, /POLICY_NEWS_KEY/);
});

test('오늘의 정책브리핑: recent 제1유형 news, newest first, marked when economy related', async () => {
  const calls = [];
  const items = await recentPolicyNews(async url => { calls.push(url); return { ok: true, status: 200, text: async () => xml(sample) }; }, 'P', Date.parse('2026-10-08T03:00:00Z'));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('startDate=20261007') && calls[0].includes('endDate=20261008'));
  assert.deepEqual(items.map(item => [item.title, item.economy]), [['국민성장펀드 200조원으로 확대', true], ['가을 축제 안내', false], ['소상공인 정책자금 금리 인하', true]]);
  assert.equal(items[2].url, 'https://www.korea.kr/news/4');
});
