const test = require('node:test');
const assert = require('node:assert/strict');
const { createPortalApi } = require('./portal-api');

function call(handler, method = 'GET', pathname = '/api/portal') {
  return new Promise(resolve => {
    const response = {
      status: 0, headers: {},
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(body) { resolve({ status: this.status, headers: this.headers, body: JSON.parse(body) }); },
    };
    handler({ method, socket: { remoteAddress: '1.2.3.4' } }, response, pathname);
  });
}

const series = {
  '802Y001/0001000': [['20260929', '3400'], ['20261002', '3468']],
  '802Y001/0089000': [['20260929', '880'], ['20261002', '871.2']],
  '731Y001/0000001': [['20260929', '1390.5'], ['20261002', '1385.2']],
  '817Y002/010200000': [['20260929', '2.51'], ['20261002', '2.534']],
  '722Y001/0101000': [['20261002', '2.5']],
  '902Y003/010102': [['202607', '70'], ['202608', '72.1']],
};

function ecosFetch(counter) {
  return async url => {
    counter.count += 1;
    const parts = new URL(url).pathname.split('/');
    const rows = series[`${parts[8]}/${parts[12]}`] || [];
    return { ok: true, json: async () => ({ StatisticSearch: { row: rows.map(([TIME, DATA_VALUE]) => ({ TIME, DATA_VALUE })) } }) };
  };
}

test('portal returns indicators with day-over-day change, caches upstream calls and reports chat head count', async () => {
  const counter = { count: 0 };
  let clock = Date.parse('2026-10-04T09:00:00Z');
  const handler = createPortalApi({ ecosKey: 'KEY', fetchImpl: ecosFetch(counter), now: () => clock, onlineCount: async () => 7 });
  const first = await call(handler);
  assert.equal(first.status, 200);
  const byId = Object.fromEntries(first.body.indicators.items.map(item => [item.id, item]));
  assert.deepEqual([byId.kospi.value, byId.kospi.change, byId.kospi.changePercent], [3468, 68, 2]);
  assert.deepEqual([byId.usdkrw.value, byId.usdkrw.change, byId.usdkrw.changeUnit], [1385.2, -5.3, '원']);
  assert.deepEqual([byId.ktb3y.change, byId.ktb3y.changeUnit], [0.024, '%p']);
  assert.equal(byId.base.value, 2.5);
  assert.deepEqual([byId.dubai.value, byId.dubai.changePercent], [72.1, 3]);
  assert.equal(first.body.housing, null);
  assert.equal(first.body.online, 7);
  const calls = counter.count;
  await call(handler);
  assert.equal(counter.count, calls, 'served from cache');
  clock += 31 * 60 * 1000;
  await call(handler);
  assert.ok(counter.count > calls, 'refreshed after expiry');
});

test('portal keeps the last good figures when the upstream fails', async () => {
  let fail = false;
  let clock = 0;
  const good = ecosFetch({ count: 0 });
  const handler = createPortalApi({ fetchImpl: async url => (fail ? { ok: false, status: 500, json: async () => ({}) } : good(url)), now: () => clock });
  const first = await call(handler);
  fail = true;
  clock += 60 * 60 * 1000;
  const second = await call(handler);
  assert.deepEqual(second.body.indicators, first.body.indicators);
  assert.equal((await call(handler, 'POST')).status, 405);
});
