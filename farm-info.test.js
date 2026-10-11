const test = require('node:test');
const assert = require('node:assert/strict');
const { parseKamis, pickWatched, parseNongsaro, farmNewsItems, createFarmInfo } = require('./farm-info');
const { createPortalApi } = require('./portal-api');

const row = (overrides) => ({ category_code: '100', category_name: '식량작물', day1: '당일', day2: '1일전', day3: '1개월전', day4: '1년전', direction: '1',
  dpr1: '55,094', dpr2: '55,053', dpr3: '52,723', dpr4: '51,034', item_name: '쌀/일반계', lastest_day: '2026-10-09', productName: '쌀/일반계',
  product_cls_code: '01', product_cls_name: '소매', productno: '272', unit: '20kg', value: '0.1', ...overrides });
const KAMIS = { condition: [['20261009']], error_code: '000', price: [
  row({}),
  row({ item_name: '쌀/햇일반계', productno: '273', dpr3: [] }),
  row({ item_name: '배추/월동', category_name: '채소류', unit: '1포기', dpr1: '4,210', dpr2: '4,300', dpr3: '5,000', dpr4: [], direction: '0', productno: '211' }),
  row({ item_name: '배추/월동', product_cls_code: '02', product_cls_name: '도매', unit: '10kg', dpr1: '12,000', productno: '211' }),
  row({ item_name: '사과/후지', category_name: '과일류', unit: '10개', dpr1: [], productno: '411' }),
] };

test('KAMIS dailySalesList: comma prices, empty values, retail/wholesale and the watch list order', () => {
  const rows = parseKamis(KAMIS);
  assert.equal(rows.length, 4, 'items without today price are dropped');
  const retail = pickWatched(rows, 'retail');
  assert.deepEqual(retail.map(item => item.name), ['쌀/일반계', '배추/월동'], 'one variety per item, in watch order');
  assert.equal(retail[0].price, 55094);
  assert.equal(retail[1].prevYear, null);
  assert.equal(retail[1].direction, 'down');
  assert.deepEqual(pickWatched(rows, 'wholesale').map(item => [item.name, item.price]), [['배추/월동', 12000]]);
  assert.throws(() => parseKamis({ error_code: '900' }), /인증키/);
});

const XML = `<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
<body><items><item><cntntsNo>1001</cntntsNo><subject><![CDATA[주간농사정보 제41호 &amp; 가을걷이]]></subject><regDt>2026-10-06</regDt><downFile>https://www.nongsaro.go.kr/cms/a.pdf</downFile></item>
<item><cntntsNo>1000</cntntsNo><subject>주간농사정보 제40호</subject><regDt>2026-09-29</regDt></item></items></body></response>`;

test('농사로 XML: items, CDATA, entities and result codes', () => {
  const items = farmNewsItems(parseNongsaro(XML));
  assert.deepEqual(items[0], { title: '주간농사정보 제41호 & 가을걷이', date: '2026-10-06', link: 'https://www.nongsaro.go.kr/cms/a.pdf', file: true });
  assert.equal(items[1].link, 'https://www.nongsaro.go.kr/');
  assert.throws(() => parseNongsaro('<response><header><resultCode>30</resultCode><resultMsg>SERVICE KEY IS NOT REGISTERED</resultMsg></header></response>'), /30: SERVICE KEY/);
});

test('farm endpoint: hidden without keys, uses keys in requests, admin-only raw view', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (url.includes('kamis')) return { ok: true, status: 200, text: async () => JSON.stringify(KAMIS) };
    return { ok: true, status: 200, text: async () => XML };
  };
  const call = (api, url) => new Promise(resolve => {
    const request = { method: 'GET', url, headers: {}, socket: { remoteAddress: '1.1.1.1' } };
    const response = { writeHead(code) { this.code = code; }, end(payload) { resolve({ status: this.code, body: JSON.parse(payload) }); } };
    api(request, response, new URL(url, 'http://x').pathname);
  });
  const empty = createPortalApi({ fetchImpl });
  assert.deepEqual((await call(empty, '/api/portal/farm')).body.connected, { prices: false, news: false });
  assert.equal(calls.length, 0);
  let admin = false;
  const api = createPortalApi({ fetchImpl, farmKeys: { kamisKey: 'k', kamisId: 'id', nongsaroKey: 'n' }, authenticate: async () => ({ user: admin ? { id: 'z', admin: true } : { id: 'u' } }) });
  const result = await call(api, '/api/portal/farm');
  assert.equal(result.body.prices.retail[0].name, '쌀/일반계');
  assert.equal(result.body.news.items.length, 2);
  assert.ok(calls.some(url => url.includes('action=dailySalesList') && url.includes('p_cert_key=k') && url.includes('p_cert_id=id') && url.includes('p_returntype=json')));
  assert.ok(calls.some(url => url.startsWith('http://api.nongsaro.go.kr/service/weekFarmInfo/weekFarmInfoList?apiKey=n')));
  assert.equal((await call(api, '/api/portal/farm/raw?source=kamis')).status, 403);
  admin = true;
  const raw = await call(api, '/api/portal/farm/raw?source=nongsaro&service=monthFarmTech&operation=monthFarmTechLst');
  assert.equal(raw.status, 200);
  assert.match(raw.body.text, /주간농사정보/);
  assert.ok(calls.at(-1).includes('/monthFarmTech/monthFarmTechLst?'));
  assert.equal((await call(api, '/api/portal/farm/raw?source=nongsaro&service=../x')).body.error, 'service·operation 이름을 확인해 주세요.');
});

test('every browser script in public/ parses (a duplicate name would break the whole page)', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  for (const file of fs.readdirSync('public').filter(name => name.endsWith('.js'))) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(`public/${file}`, 'utf8'), { filename: file }), file);
  }
});
