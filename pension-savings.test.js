const test = require('node:test');
const assert = require('node:assert/strict');
const { createPensionSavings, recentQuarters } = require('./pension-savings');

test('최근 분기를 거꾸로 만든다', () => {
  assert.deepEqual(recentQuarters(new Date(2026, 9, 14), 3), [{ year: 2026, quarter: 3 }, { year: 2026, quarter: 2 }, { year: 2026, quarter: 1 }]);
  assert.deepEqual(recentQuarters(new Date(2026, 1, 1), 1), [{ year: 2025, quarter: 4 }]);
});

test('권역별 회사 수익률을 가장 최근 공시 분기에서 모으고 원리금보장 보험도 받는다', async () => {
  const urls = [];
  const info = createPensionSavings({ key: 'K', now: () => new Date(2026, 9, 14), fetchImpl: async url => {
    urls.push(url);
    const q = new URL(url).searchParams;
    let body;
    if (url.includes('psGuaranteedProdList')) body = { code: '000', list: q.get('areaCode') === '4' ? [{ company: '가생명', product: '연금저축A', publishedInterestRate: '2.85', guaranteedInterestRate: '1.0', onlineFeeDesc: '없음|0.5%' }] : [] };
    else if (q.get('quarter') === '3') body = { code: '001', message: '조회 결과가 없습니다.' };
    else body = { code: '000', count: 1, list: [{ area: '권역', company: `회사${q.get('areaCode')}`, avgEarnRate3: '3.1', earnRate1: '4.2', avgFeeRate3: '0.45', reserve: '1000000000000' }] };
    return { status: 200, text: async () => JSON.stringify(body) };
  } });
  const data = await info.load();
  assert.equal(data.basis, '2026년 2분기');
  assert.deepEqual(data.companies.map(row => row.sector), ['은행', '금융투자', '생명보험', '손해보험']);
  assert.equal(data.companies[0].avg3, 3.1);
  assert.equal(data.guaranteed[0].rate, 2.85);
  assert.ok(urls[0].startsWith('https://www.fss.or.kr/openapi/api/psCorpList.json?key=K&year=2026&quarter=3&areaCode=1'));
});

test('인증키 오류는 그대로 알린다', async () => {
  const info = createPensionSavings({ key: 'K', fetchImpl: async () => ({ status: 200, text: async () => JSON.stringify({ code: '100', message: '인증키가 유효하지 않습니다.' }) }) });
  await assert.rejects(info.load(), /100: 인증키가 유효하지 않음/);
});
