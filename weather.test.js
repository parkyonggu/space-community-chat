const test = require('node:test');
const assert = require('node:assert/strict');
const { toGrid, ncstBase, fcstBase, dayBase, summarizeDays } = require('./weather');
const { createPortalApi } = require('./portal-api');

test('converts coordinates to KMA grid and picks base times', () => {
  assert.deepEqual(toGrid(37.5665, 126.9780), { nx: 60, ny: 127 });
  assert.deepEqual(toGrid(35.1798, 129.0750), { nx: 98, ny: 76 });
  const at = Date.parse('2026-10-09T17:30:00Z'); // 10/10 02:30 KST
  assert.deepEqual(ncstBase(at), { date: '20261010', time: '0100' });
  assert.deepEqual(fcstBase(at), { date: '20261010', time: '0200' });
  assert.deepEqual(dayBase(at), { date: '20261010', time: '0200' });
  const early = Date.parse('2026-10-09T16:05:00Z'); // 10/10 01:05 KST
  assert.deepEqual(fcstBase(early), { date: '20261009', time: '2300' });
});

const item = (category, fcstDate, fcstTime, fcstValue) => ({ category, fcstDate, fcstTime, fcstValue: String(fcstValue) });

test('summarises three days with extremes, sky, rain and probability', () => {
  const items = [
    item('TMP', '20261010', '0900', 14), item('TMP', '20261010', '1500', 21), item('SKY', '20261010', '1200', 1), item('POP', '20261010', '1200', 10), item('PTY', '20261010', '1200', 0),
    item('TMX', '20261011', '1500', 19), item('TMN', '20261011', '0600', 11), item('SKY', '20261011', '1200', 4), item('POP', '20261011', '1500', 70), item('PTY', '20261011', '1500', 1), item('PTY', '20261011', '1200', 0),
    item('TMP', '20261012', '1200', 18), item('SKY', '20261012', '1200', 3), item('POP', '20261012', '1200', 30),
  ];
  const days = summarizeDays(items, [item('TMN', '20261010', '0600', 9), item('TMX', '20261010', '1500', 22)], '20261010');
  assert.equal(days.length, 3);
  assert.deepEqual([days[0].min, days[0].max, days[0].skyText, days[0].pop], [9, 22, '맑음', 10]);
  assert.deepEqual([days[1].min, days[1].max, days[1].skyText, days[1].ptyText, days[1].rainFrom, days[1].pop], [11, 19, '흐림', '비', '1500', 70]);
  assert.equal(days[2].skyText, '구름많음');
});

function kmaFetch(calls, { fail = false } = {}) {
  return async url => {
    calls.push(url);
    if (fail) return { ok: true, status: 200, text: async () => '<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>' };
    const params = new URL(url).searchParams;
    const op = new URL(url).pathname.split('/').pop();
    let items;
    if (op === 'getUltraSrtNcst') items = [{ baseDate: params.get('base_date'), baseTime: params.get('base_time'), category: 'T1H', obsrValue: '17.3' }, { baseDate: params.get('base_date'), baseTime: params.get('base_time'), category: 'PTY', obsrValue: '0' }, { baseDate: '', baseTime: '', category: 'REH', obsrValue: '60' }];
    else items = [item('TMN', '20261010', '0600', 10), item('TMX', '20261010', '1500', 23), item('SKY', '20261010', '1200', 1), item('POP', '20261010', '1200', 20), item('PTY', '20261010', '1200', 0), item('TMP', '20261011', '1200', 20), item('POP', '20261011', '1200', 60), item('PTY', '20261011', '1200', 1), item('SKY', '20261011', '1200', 4)];
    return { ok: true, status: 200, text: async () => JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL_SERVICE' }, body: { items: { item: items } } } }) };
  };
}

function call(api, url) {
  return new Promise(resolve => {
    const request = { method: 'GET', url, headers: {}, socket: { remoteAddress: '1.1.1.1' }, async *[Symbol.asyncIterator]() {} };
    const response = { writeHead(code) { this.code = code; }, end(body) { resolve({ status: this.code, body: JSON.parse(body) }); } };
    api(request, response, new URL(url, 'http://x').pathname);
  });
}

test('portal weather endpoint returns every region and caches upstream calls', async () => {
  const calls = [];
  const api = createPortalApi({ weatherKey: 'k+y', fetchImpl: kmaFetch(calls), now: () => Date.parse('2026-10-09T23:00:00Z') });
  const first = await call(api, '/api/portal/weather');
  assert.equal(first.status, 200);
  assert.equal(first.body.regions.length, 7);
  const yangsan = first.body.regions.find(region => region.id === 'yangsan');
  assert.equal(yangsan.now.temp, 17.3);
  assert.deepEqual([yangsan.days[0].min, yangsan.days[0].max], [10, 23]);
  assert.equal(yangsan.days[1].ptyText, '비');
  assert.ok(calls.every(url => url.includes('serviceKey=k%2By') && url.includes('dataType=JSON')));
  const count = calls.length;
  await call(api, '/api/portal/weather');
  assert.equal(calls.length, count, 'second request served from cache');
});

test('reports a key problem without failing', async () => {
  const api = createPortalApi({ weatherKey: 'bad', fetchImpl: kmaFetch([], { fail: true }), now: () => Date.parse('2026-10-09T23:00:00Z') });
  const result = await call(api, '/api/portal/weather');
  assert.equal(result.status, 200);
  assert.equal(result.body.regions[0].now, null);
  assert.match(result.body.problems[0], /SERVICE_KEY_IS_NOT_REGISTERED_ERROR/);
  const none = await call(createPortalApi({}), '/api/portal/weather');
  assert.equal(none.body.connected, false);
});
