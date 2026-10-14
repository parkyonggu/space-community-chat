const test = require('node:test');
const assert = require('node:assert/strict');
const { createFinanceInfo } = require('./finance-info');

const depositBody = group => JSON.stringify({ result: { err_cd: '000', err_msg: '정상', total_count: 2, max_page_no: 1, now_page_no: 1,
  baseList: [
    { dcls_month: '202610', fin_co_no: group === '020000' ? 'B1' : 'S1', kor_co_nm: group === '020000' ? '가은행' : '나저축은행', fin_prdt_cd: 'P1', fin_prdt_nm: '든든예금', join_way: '영업점,인터넷', spcl_cnd: '첫 거래 우대 0.3%p', join_deny: '1', join_member: '실명의 개인', max_limit: null },
  ],
  optionList: [
    { fin_co_no: group === '020000' ? 'B1' : 'S1', fin_prdt_cd: 'P1', intr_rate_type_nm: '단리', save_trm: '6', intr_rate: 2.5, intr_rate2: 2.7 },
    { fin_co_no: group === '020000' ? 'B1' : 'S1', fin_prdt_cd: 'P1', intr_rate_type_nm: '단리', save_trm: '12', intr_rate: group === '020000' ? 2.9 : 3.3, intr_rate2: group === '020000' ? 3.2 : 3.5 },
  ] } });

test('정기예금: 은행·저축은행을 모아 12개월 최고금리 순으로 정리', async () => {
  const urls = [];
  const info = createFinanceInfo({ key: 'K', fetchImpl: async url => { urls.push(url); const group = new URL(url).searchParams.get('topFinGrpNo'); return { status: 200, text: async () => depositBody(group) }; } });
  const rows = await info.deposits();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].company, '나저축은행');
  assert.equal(rows[0].group, '저축은행');
  assert.equal(rows[0].term, 12);
  assert.equal(rows[0].rate, 3.3);
  assert.equal(rows[0].maxRate, 3.5);
  assert.equal(rows[1].joinDeny, '제한 없음');
  assert.ok(urls[0].startsWith('https://finlife.fss.or.kr/finlifeapi/depositProductsSearch.json?auth=K&topFinGrpNo=020000&pageNo=1'));
});

test('인증키 오류는 바로 알린다', async () => {
  const info = createFinanceInfo({ key: 'K', fetchImpl: async () => ({ status: 200, text: async () => JSON.stringify({ result: { err_cd: '010', err_msg: '미등록 인증키' } }) }) });
  await assert.rejects(info.deposits(), /010: 미등록 인증키/);
});

test('https가 안 되면 http로 다시 받는다', async () => {
  const info = createFinanceInfo({ key: 'K', fetchImpl: async url => { if (url.startsWith('https:')) throw new Error('TLS'); return { status: 200, text: async () => depositBody(new URL(url).searchParams.get('topFinGrpNo')) }; } });
  const rows = await info.deposits();
  assert.equal(rows.length, 2);
});

test('연금저축: 회사 종류(은행·생명보험·손해보험·금융투자)로 나누고 대출 등 다른 자료는 거른다', async () => {
  const bodies = {
    '020000': [{ fin_co_no: 'B', fin_prdt_cd: 'L1', kor_co_nm: '가은행', fin_prdt_nm: '담보대출', loan_type: '담보대출' }],
    '050000': [
      { fin_co_no: 'L', fin_prdt_cd: 'A1', kor_co_nm: '가생명보험', fin_prdt_nm: '연금저축A', pnsn_kind_nm: '연금저축보험(생명)', dcls_rate: 2.9, guar_rate: 1 },
      { fin_co_no: 'N', fin_prdt_cd: 'A2', kor_co_nm: '나화재해상보험', fin_prdt_nm: '연금저축B', pnsn_kind_nm: '연금저축보험(손해)', dcls_rate: 2.7 },
    ],
    '060000': [{ fin_co_no: 'F', fin_prdt_cd: 'A3', kor_co_nm: '다자산운용', fin_prdt_nm: '연금펀드', pnsn_kind_nm: '연금저축펀드', prdt_type_nm: '주식형', avg_prft_rate: 5.1 }],
  };
  const info = createFinanceInfo({ key: 'K', fetchImpl: async url => {
    const group = new URL(url).searchParams.get('topFinGrpNo');
    return { status: 200, text: async () => JSON.stringify({ result: { err_cd: '000', max_page_no: 1, baseList: bodies[group], optionList: [] } }) };
  } });
  const rows = await info.annuities();
  assert.deepEqual(rows.map(row => row.sector), ['금융투자', '생명보험', '손해보험']);
});
