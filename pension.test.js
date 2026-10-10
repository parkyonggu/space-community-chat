const test = require('node:test');
const assert = require('node:assert/strict');
const { createPortalApi } = require('./portal-api');

function npsFetch(calls) {
  return async url => {
    calls.push(url);
    const params = new URL(url).searchParams;
    const recipt = url.includes('NpsReciptInfoProvdServiceV2');
    const age = Number(params.get(recipt ? 'crtrAge' : 'jnngpAge'));
    const item = recipt
      ? { totPrsnCnt: String(1000 - age), avgFnlPrvsAmt: String(500000 + age * 1000), avgPrvsPrdMcnt: '96', avgTotPrvsAmt: '50000000', whlPymtCtstPrvsRate: '2.3' }
      : { jnngBrkdSgmntPrsnCnt: String(2000 + age), avgAntcPnsAmt: String(700000 + age * 1000), rcgnAvgAmt: '3000000', rcgnAvgMcnt: '120' };
    const body = age === 80 ? { header: { resultCode: '03', resultMsg: 'NODATA_ERROR' } }
      : { response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' }, body: { items: { item: [item] }, totalCount: 1 } } };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
}

function call(api, url) {
  return new Promise(resolve => {
    const request = { method: 'GET', url, headers: {}, socket: { remoteAddress: '1.1.1.1' }, async *[Symbol.asyncIterator]() {} };
    const response = { writeHead(code) { this.code = code; }, end(body) { resolve({ status: this.code, body: JSON.parse(body) }); } };
    api(request, response, new URL(url, 'http://x').pathname);
  });
}

test('pension endpoint builds recipient and subscriber tables per region and caches them', async () => {
  const calls = [];
  const api = createPortalApi({ pensionKey: 'a+b', fetchImpl: npsFetch(calls) });
  const result = await call(api, '/api/portal/pension');
  assert.equal(result.status, 200);
  assert.equal(result.body.regions.length, 3);
  const uiryeong = result.body.regions.find(region => region.id === 'uiryeong');
  assert.deepEqual(uiryeong.recipients.map(row => row.age), [60, 70], 'NODATA age band skipped');
  assert.equal(uiryeong.recipients[0].monthly, 560000);
  assert.equal(uiryeong.subscribers.length, 4);
  assert.equal(uiryeong.subscribers[0].expected, 720000);
  assert.ok(calls.some(url => url.includes('ldongAddrMgplSgguCd=48720') && url.includes('payClssCd=00')));
  assert.ok(calls.every(url => url.includes('serviceKey=a%2Bb')));
  const count = calls.length;
  await call(api, '/api/portal/pension');
  assert.equal(calls.length, count, 'served from cache');
  const raw = await call(api, '/api/portal/pension/raw?op=sbscrb&jnngpAge=30&ldongAddrMgplDgCd=48&ldongAddrMgplSgguCd=48330&bad=<x>');
  assert.equal(raw.body.data.response.body.items.item[0].jnngBrkdSgmntPrsnCnt, '2030');
  assert.ok(!calls.at(-1).includes('bad='));
});

test('pension endpoint without key or with a key error stays calm', async () => {
  assert.equal((await call(createPortalApi({}), '/api/portal/pension')).body.connected, false);
  const api = createPortalApi({ pensionKey: 'bad', fetchImpl: async () => ({ ok: false, status: 401, text: async () => '<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>' }) });
  const result = await call(api, '/api/portal/pension');
  assert.equal(result.body.regions.length, 0);
  assert.match(result.body.problems[0], /SERVICE_KEY_IS_NOT_REGISTERED_ERROR/);
});

test('recipient data still shows when only the subscriber API is not approved', async () => {
  const ok = npsFetch([]);
  const fetchImpl = async url => (url.includes('NpsSbscrbInfoProvdServiceV2')
    ? { ok: false, status: 401, text: async () => '<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>' }
    : ok(url));
  const result = await call(createPortalApi({ pensionKey: 'k', fetchImpl }), '/api/portal/pension');
  assert.equal(result.body.regions.length, 3);
  assert.equal(result.body.regions[0].recipients.length, 2);
  assert.deepEqual(result.body.regions[0].subscribers, []);
});

test('JSON-shaped gateway errors are reported, not treated as empty data', async () => {
  const api = createPortalApi({ pensionKey: 'k', fetchImpl: async () => ({ ok: false, status: 403, text: async () => JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', returnAuthMsg: '등록되지 않은 서비스키', returnReasonCode: '30' } } }) }) });
  const result = await call(api, '/api/portal/pension');
  assert.match(result.body.problems[0], /등록되지 않은 서비스키/);
});
