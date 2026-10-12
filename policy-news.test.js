const test = require('node:test');
const assert = require('node:assert/strict');
const { weeklyPolicyNews, recentPolicyNews, dailyBriefingText, pickDailyTheme, parseNews, isTypeOne } = require('./policy-news');
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
  assert.equal(calls.length, 2, 'few news in the last days → also looks at the three days before');
  assert.ok(calls[0].includes('startDate=20261006') && calls[0].includes('endDate=20261008'));
  assert.ok(calls[1].includes('startDate=20261003') && calls[1].includes('endDate=20261005'));
  assert.deepEqual(items.map(item => [item.title, item.economy, item.kind]), [['국민성장펀드 200조원으로 확대', true, 'news'], ['가을 축제 안내', false, 'news'], ['소상공인 정책자금 금리 인하', true, 'news']]);
  assert.equal(items[2].url, 'https://www.korea.kr/news/4');
});

test('decodes double-encoded symbols in titles', () => {
  const [news] = parseNews(xml([item({ Title: '청년&amp;middot;지방&middot;교육 &#8216;지원&#8217; &quot;확대&quot;', OriginalUrl: '/x', KoglType: '1' })]));
  assert.equal(news.Title, "청년·지방·교육 ‘지원’ \"확대\"");
});

test('"사실은 이렇습니다" items are kept apart from policy news', async () => {
  const facts = [...sample, item({ NewsItemId: '9', Title: '[사실은 이렇습니다] 기초연금 삭감 보도 관련', MinisterCode: '보건복지부', ApproveDate: '10/08/2026 11:00:00', OriginalUrl: '/news/9', KoglType: '1' })];
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => xml(facts) });
  const items = await recentPolicyNews(fetchImpl, 'P', Date.parse('2026-10-08T03:00:00Z'));
  const fact = items.find(entry => entry.kind === 'fact');
  assert.equal(fact.title, '기초연금 삭감 보도 관련', 'prefix removed');
  assert.equal(fact.economy, false);
  const weekly = await weeklyPolicyNews(fetchImpl, 'P', Date.parse('2026-10-08T03:00:00Z'));
  assert.ok(!weekly.lines.join('').includes('기초연금 삭감'), 'not in the newsletter policy list');
});

test('daily 스페이스 톡 briefing picks the single most important policy theme today', () => {
  const now = Date.parse('2026-10-08T09:00:00Z');
  const item = (title, dept, extra = {}) => ({ title, dept, url: `https://www.korea.kr/${encodeURIComponent(title)}`, kind: 'news', economy: false, at: now - 3600e3, sub: '', ...extra });
  const items = [
    item('누리호 5차 발사 성공', '우주항공청'),
    item('과기정통부 장관, 연구기관 방문', '과학기술정보통신부'),
    item('AI 포럼 개최', '과학기술정보통신부'),
    item('청년 월세 지원 대상 확대', '국토교통부', { sub: '무주택 청년 주거비 부담 완화, 11월부터 신청' }),
    item('공공주택 5만 호 추가 공급 대책 발표', '국토교통부', { at: now - 1800e3 }),
    item('국토부 차관, 현장 간담회', '국토교통부'),
    item('기초연금 보도 관련', '보건복지부', { kind: 'fact' }),
    item('어제 소식', '국토교통부', { at: now - 30 * 3600e3 }),
  ];
  const text = dailyBriefingText(items, now);
  const lines = text.split('\n');
  assert.equal(lines[0], '📰 10월 8일 아침 정책브리핑 — 🏠 부동산·주거', 'life-affecting housing news beats routine science events');
  assert.ok(text.indexOf('청년 월세') < text.indexOf('국토부 차관'), 'most important item first');
  assert.ok(text.includes('11월부터 신청'), 'subtitle shown');
  assert.ok(!text.includes('누리호') && !text.includes('어제 소식') && !text.includes('기초연금 보도') && !text.includes('다른 분야'), 'only the chosen theme');
  assert.match(text, /다른 정책 소식은 정책브리핑에서: https:\/\/withpluces\.com\/#policy-panel/);
  assert.match(text, /공공누리 제1유형/);
  const tied = [item('A 금융 지원', '금융위원회'), item('B 주택 지원', '국토교통부')];
  const first = pickDailyTheme(tied, now).theme.id;
  assert.notEqual(pickDailyTheme(tied, now, { previous: first }).theme.id, first, 'avoid repeating yesterday on a near tie');
  assert.equal(dailyBriefingText([], now), null);
  // 연휴 다음 날 아침: 지난 24시간에 정책뉴스가 없으면 최근 나흘 안의 소식으로 채운다(보도 설명 자료는 빼고).
  const holiday = [item('연휴 전 청년 월세 지원 확대', '국토교통부', { at: now - 60 * 3600e3 }), item('보도 설명', '보건복지부', { kind: 'fact', at: now - 3600e3 }), item('오래된 소식', '국토교통부', { at: now - 120 * 3600e3 })];
  const after = dailyBriefingText(holiday, now);
  assert.ok(after.includes('연휴 전 청년 월세') && !after.includes('오래된 소식') && !after.includes('보도 설명'));
});

