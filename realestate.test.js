const test = require('node:test');
const assert = require('node:assert/strict');
const { createRealEstate, parseResponse, REGIONS } = require('./realestate');

const xml = items => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body><items>${items.map(item => `<item>${Object.entries(item).map(([key, value]) => `<${key}>${value}</${key}>`).join('')}</item>`).join('')}</items><numOfRows>1000</numOfRows><pageNo>1</pageNo><totalCount>${items.length}</totalCount></body></response>`;

test('parses MOLIT XML and gateway errors', () => {
  const parsed = parseResponse(xml([{ aptNm: '래미안&amp;자이', dealAmount: '  285,000', dealYear: '2026', dealMonth: '9', dealDay: '30' }]));
  assert.equal(parsed.items[0].aptNm, '래미안&자이');
  assert.equal(parsed.items[0].dealAmount, '285,000');
  assert.throws(() => parseResponse('<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>'), /SERVICE_KEY_IS_NOT_REGISTERED_ERROR/);
  assert.throws(() => parseResponse('<response><header><resultCode>03</resultCode><resultMsg>NO_DATA</resultMsg></header></response>'), /NO_DATA/);
});

function fakeFetch(calls) {
  return async url => {
    calls.push(url);
    const { pathname, searchParams } = new URL(url);
    const lawd = searchParams.get('LAWD_CD');
    const ym = searchParams.get('DEAL_YMD');
    const day = ym === '202610' ? '5' : '20';
    const month = ym.slice(4);
    let items = [];
    if (pathname.includes('AptTrade') && lawd === '11680') {
      items = [
        { aptNm: '은마', umdNm: '대치동', excluUseAr: '84.43', dealYear: '2026', dealMonth: month, dealDay: day, dealAmount: '300,000', floor: '7', cdealType: ' ' },
        { aptNm: '해제단지', umdNm: '대치동', excluUseAr: '84', dealYear: '2026', dealMonth: month, dealDay: day, dealAmount: '100,000', floor: '3', cdealType: 'O' },
      ];
    }
    if (pathname.includes('LandTrade') && lawd === '41830') {
      items = [
        { jimok: '임야', umdNm: '양서면', dealArea: '1000', dealYear: '2026', dealMonth: month, dealDay: day, dealAmount: '5,000' },
        { jimok: '답', umdNm: '양서면', dealArea: '500', dealYear: '2026', dealMonth: month, dealDay: day, dealAmount: '10,000' },
        { jimok: '대', umdNm: '양서면', dealArea: '300', dealYear: '2026', dealMonth: month, dealDay: day, dealAmount: '30,000' },
        { jimok: '전', umdNm: '양서면', dealArea: '200', dealYear: '2026', dealMonth: month, dealDay: day, dealAmount: '2,000', shareDealingType: '지분' },
      ];
    }
    if (pathname.includes('NrgTrade') && lawd === '26350') {
      items = [{ buildingUse: '제2종근린생활', umdNm: '우동', buildingAr: '320.5', dealYear: '2026', dealMonth: month, dealDay: day, dealAmount: '180,000', floor: '' }];
    }
    return { ok: true, status: 200, text: async () => xml(items) };
  };
}

test('fills units in batches within limits and summarises apartments, buildings, forest and farmland', async () => {
  const memory = new Map();
  const store = { get: async key => memory.get(key), set: async (key, value) => { memory.set(key, value); } };
  const calls = [];
  const clock = Date.parse('2026-10-07T04:00:00Z');
  const realEstate = createRealEstate({ key: 'abc+/=', fetchImpl: fakeFetch(calls), store, now: () => clock });
  const total = REGIONS.length * 3 * 2;
  let result;
  for (let round = 0; round < 20; round += 1) {
    result = await realEstate.load();
    if (result.complete) break;
  }
  assert.equal(result.coverage.total, total);
  assert.equal(calls.length, total, 'each unit fetched exactly once');
  assert.ok(calls.every(url => url.includes('serviceKey=abc%2B%2F%3D')), 'decoded key is URL-encoded');
  const byId = Object.fromEntries(result.categories.map(category => [category.id, category]));
  assert.equal(byId.apt.count, 2, 'cancelled deal excluded, both months counted');
  assert.equal(byId.apt.regions[0].median, 300000);
  assert.equal(byId.apt.recent[0].date, '20261005');
  assert.equal(byId.bldg.count, 2);
  assert.equal(byId.forest.count, 2);
  assert.equal(byId.forest.regions[0].median, 50000, '원/㎡');
  assert.equal(byId.farm.count, 2, 'share deal and 대 excluded');
  assert.equal(byId.farm.regions[0].median, 200000);
  assert.equal(result.from, '20260907');
  await realEstate.load();
  assert.equal(calls.length, total, 'fresh units are not refetched');
});

test('reports an invalid key without throwing', async () => {
  const memory = new Map();
  const store = { get: async key => memory.get(key), set: async (key, value) => { memory.set(key, value); } };
  const realEstate = createRealEstate({ key: 'bad', store, now: () => Date.parse('2026-10-07T04:00:00Z'),
    fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'Unauthorized' }) });
  const result = await realEstate.load();
  assert.equal(result.coverage.ready, 0);
  assert.match(result.problems[0], /HTTP 401 Unauthorized/);
});

test('uses a separate key per API and retries at once when a key changes', async () => {
  const memory = new Map();
  const store = { get: async key => memory.get(key), set: async (key, value) => { memory.set(key, value); } };
  const calls = [];
  const clock = Date.parse('2026-10-07T04:00:00Z');
  const fetchImpl = async url => {
    calls.push(url);
    const ok = url.includes('LandTrade') ? url.includes('serviceKey=LANDKEY') : url.includes('serviceKey=APTKEY');
    if (!ok) return { ok: false, status: 403, text: async () => '<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</errMsg><returnAuthMsg>등록되지 않은 서비스키</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>' };
    return { ok: true, status: 200, text: async () => xml([]) };
  };
  let realEstate = createRealEstate({ key: 'LANDKEY', fetchImpl, store, now: () => clock });
  for (let round = 0; round < 10; round += 1) await realEstate.load();
  const first = await realEstate.load();
  assert.equal(first.coverage.ready, REGIONS.length * 2, 'only land works with the shared key');
  calls.length = 0;
  realEstate = createRealEstate({ key: 'LANDKEY', keys: { apt: 'APTKEY' }, fetchImpl, store, now: () => clock });
  await realEstate.load();
  assert.ok(calls.length > 0 && calls.every(url => url.includes('AptTrade')), 'changed key is retried immediately');
  assert.ok(calls.every(url => url.includes('serviceKey=APTKEY')));
});
