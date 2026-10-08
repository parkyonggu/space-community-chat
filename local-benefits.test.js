const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalBenefits, parseDeadline, arrange, cleanManual } = require('./local-benefits');
const { createPortalApi } = require('./portal-api');

const NOW = Date.parse('2026-10-08T09:00:00Z'); // 2026-10-08 18:00 KST

test('parses deadlines in common Korean formats', () => {
  assert.deepEqual(parseDeadline('2026.11.02 ~ 2026.11.30', NOW), { due: 20261130, start: 20261102, always: false });
  assert.equal(parseDeadline('2026년 12월 31일까지', NOW).due, 20261231);
  assert.equal(parseDeadline('매년 2.1 ~ 3.31', NOW).due, 20270331, 'past month-day rolls to next year');
  assert.equal(parseDeadline('11월 15일까지 신청', NOW).due, 20261115);
  assert.deepEqual(parseDeadline('상시신청', NOW), { due: null, start: null, always: true });
  assert.equal(parseDeadline('예산 소진 시까지', NOW).due, null);
});

const service = (fields) => ({
  서비스ID: fields.id, 서비스명: fields.name, 서비스목적요약: '요약', 지원대상: fields.target || '', 지원내용: '지원',
  신청기한: fields.deadline || '상시신청', 신청방법: fields.method || '방문', 접수기관: fields.reception || '', 소관기관명: fields.agency,
  소관기관유형: fields.type || '지방자치단체', 서비스분야: fields.field || '생활안정', 상세조회URL: 'https://www.gov.kr/portal/rcvfvrSvc/dtlEx/' + fields.id,
  수정일시: '20260901',
});

const DATA = [
  service({ id: 'U1', name: '의령군 농업인 영농자재 지원', target: '관내 농업인', agency: '경상남도 의령군', reception: '읍면 행정복지센터', deadline: '2026.10.01 ~ 2026.10.31', field: '농림축산어업' }),
  service({ id: 'U2', name: '의령군 출산장려금', target: '출산 가정', agency: '경상남도 의령군', reception: '읍·면사무소' }),
  service({ id: 'U3', name: '의령군 군청 직접 접수 사업', agency: '경상남도 의령군', reception: '의령군청 농업기술센터' }),
  service({ id: 'U4', name: '지난 사업', agency: '경상남도 의령군', reception: '읍면사무소', deadline: '2026.03.01 ~ 2026.03.31' }),
  service({ id: 'Y1', name: '양산시 청년 월세', agency: '경상남도 양산시', reception: '동 행정복지센터' }),
  service({ id: 'P1', name: '경상남도 임업인 산림소득 지원', target: '산주, 임업인', agency: '경상남도', reception: '시군 읍면사무소', deadline: '2026.11.20까지' }),
  service({ id: 'N1', name: '공익직불금', target: '농업인', agency: '농림축산식품부', type: '중앙행정기관', reception: '농지 소재지 읍면동 행정복지센터', field: '농림축산어업', deadline: '2026.12.15' }),
  service({ id: 'N2', name: '중앙 온라인 사업', agency: '농림축산식품부', type: '중앙행정기관', reception: '온라인', field: '농림축산어업' }),
];

// cond 필터를 흉내 낸다(LIKE/EQ). ignoreCond면 필터를 무시하고 전부 돌려준다.
function fakeFetch(calls, { ignoreCond = false } = {}) {
  return async url => {
    calls.push(url);
    const params = new URL(url).searchParams;
    let rows = DATA;
    if (!ignoreCond) {
      for (const [name, value] of params) {
        const match = /^cond\[(.+)::(LIKE|EQ)\]$/.exec(name);
        if (!match) continue;
        rows = rows.filter(row => (match[2] === 'EQ' ? String(row[match[1]]) === value : String(row[match[1]]).includes(value)));
      }
    }
    const page = Number(params.get('page'));
    const per = Number(params.get('perPage'));
    const slice = rows.slice((page - 1) * per, page * per);
    return { ok: true, status: 200, text: async () => JSON.stringify({ page, perPage: per, totalCount: DATA.length, matchCount: rows.length, currentCount: slice.length, data: slice }) };
  };
}

test('collects region, province and town-office national services', async () => {
  for (const ignoreCond of [false, true]) {
    const calls = [];
    const benefits = createLocalBenefits({ key: 'a+b', fetchImpl: fakeFetch(calls, { ignoreCond }), now: () => NOW });
    const local = await benefits.region('uiryeong');
    assert.deepEqual(local.map(item => item.id).sort(), ['U1', 'U2', 'U3', 'U4']);
    const u1 = local.find(item => item.id === 'U1');
    assert.equal(u1.townOffice, true);
    assert.ok(u1.audiences.includes('farm'));
    assert.equal(u1.due, 20261031);
    assert.equal(local.find(item => item.id === 'U3').townOffice, false);
    assert.deepEqual((await benefits.province()).map(item => item.id), ['P1']);
    assert.deepEqual((await benefits.national()).map(item => item.id), ['N1']);
    assert.ok(calls[0].includes('serviceKey=a%2Bb'));
    assert.ok(calls[0].includes(encodeURIComponent('cond[소관기관명::LIKE]')));
  }
});

test('arranges by deadline and drops expired', () => {
  const items = [
    { id: 'a', due: null, always: true, townOffice: true, updated: '' },
    { id: 'b', due: 20261231, townOffice: true, updated: '' },
    { id: 'c', due: 20261020, townOffice: true, updated: '' },
    { id: 'd', due: 20260101, townOffice: true, updated: '' },
    { id: 'e', due: null, always: false, townOffice: true, updated: '' },
  ];
  assert.deepEqual(arrange(items, NOW).map(item => item.id), ['c', 'b', 'a', 'e']);
});

test('validates manual notices', () => {
  const item = cleanManual({ name: '2027년 산림사업(조림·숲가꾸기) 신청', region: 'uiryeong', deadlineText: '2026.11.30까지', target: '산주' }, NOW);
  assert.equal(item.due, 20261130);
  assert.ok(item.audiences.includes('forest'));
  assert.throws(() => cleanManual({ name: '', region: 'uiryeong' }), /제목/);
  assert.throws(() => cleanManual({ name: 'x', region: 'seoul' }), /지역/);
  assert.throws(() => cleanManual({ name: 'x', region: 'all', url: 'javascript:alert(1)' }), /https/);
});

function call(api, method, url, body, headers = {}) {
  return new Promise(resolve => {
    const chunks = body ? [Buffer.from(JSON.stringify(body))] : [];
    const request = { method, url, headers, socket: { remoteAddress: '1.2.3.4' }, async *[Symbol.asyncIterator]() { yield* chunks; } };
    const response = { statusCode: 200, writeHead(code) { this.statusCode = code; }, end(payload) { resolve({ status: this.statusCode, body: JSON.parse(payload) }); } };
    api(request, response, new URL(url, 'http://x').pathname);
  });
}

test('portal benefits endpoint filters, counts and accepts admin notices', async () => {
  const api = createPortalApi({
    benefitKey: 'key', fetchImpl: fakeFetch([]), now: () => NOW,
    authenticate: async request => (request.headers.admin ? { user: { admin: true } } : { user: { admin: false } }),
  });
  let result = await call(api, 'GET', '/api/portal/benefits?region=uiryeong');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.items.map(item => item.id), ['U1', 'P1', 'N1', 'U2'], 'town-office only, expired dropped, by deadline');
  assert.equal(result.body.counts.farm, 2);
  result = await call(api, 'GET', '/api/portal/benefits?region=uiryeong&town=0&aud=forest');
  assert.deepEqual(result.body.items.map(item => item.id), ['P1']);
  result = await call(api, 'GET', '/api/portal/benefits?region=yangsan');
  assert.ok(result.body.items.some(item => item.id === 'Y1') && !result.body.items.some(item => item.id === 'U1'));

  assert.equal((await call(api, 'POST', '/api/portal/benefits/manual', { name: 'x', region: 'uiryeong' })).status, 403);
  const added = await call(api, 'POST', '/api/portal/benefits/manual', { name: '2027년 산림사업 신청 안내', region: 'uiryeong', deadlineText: '2026.10.25까지' }, { admin: '1' });
  assert.equal(added.status, 200);
  result = await call(api, 'GET', '/api/portal/benefits?region=uiryeong&aud=forest');
  assert.equal(result.body.items[0].id, added.body.item.id, 'manual notice shown first (earliest deadline)');
  assert.equal(result.body.items[0].scope, 'manual');
  await call(api, 'POST', '/api/portal/benefits/manual', { remove: added.body.item.id }, { admin: '1' });
  result = await call(api, 'GET', '/api/portal/benefits?region=uiryeong&aud=forest');
  assert.ok(!result.body.items.some(item => item.id === added.body.item.id));
});

test('reports a key error instead of failing', async () => {
  const api = createPortalApi({ benefitKey: 'bad', now: () => NOW,
    fetchImpl: async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ code: -4, msg: '등록되지 않은 인증키 입니다.' }) }) });
  const result = await call(api, 'GET', '/api/portal/benefits?region=gimhae');
  assert.equal(result.status, 200);
  assert.equal(result.body.items.length, 0);
  assert.match(result.body.problems[0], /등록되지 않은 인증키/);
});

test('farm service field does not tag fishers', () => {
  const { compact } = require('./local-benefits');
  const item = compact({ 서비스명: '영농자재 지원', 지원대상: '농업인', 서비스분야: '농림축산어업' }, NOW);
  assert.ok(item.audiences.includes('farm'));
  assert.ok(!item.audiences.includes('fish'));
});
