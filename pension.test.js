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

test('수급현황이 JSON으로 시간초과(05)면 XML로 다시 받아 읽는다', async () => {
  const { createPension } = require('./pension.js');
  const urls = [];
  const pension = createPension({ key: 'k', fetchImpl: async url => {
    urls.push(url);
    if (url.includes('Sbscrb')) return { status: 403, ok: false, text: async () => '<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>' };
    if (url.includes('dataType=JSON')) return { status: 200, ok: true, text: async () => '{"response":{"header":{"resultCode":"05","resultMsg":"SERVICETIMEOUT_ERROR"}}}' };
    return { status: 200, ok: true, text: async () => '<response><header><resultCode>00</resultCode></header><body><items><item><totPrsnCnt>1,200</totPrsnCnt><avgFnlPrvsAmt>650000</avgFnlPrvsAmt></item></items></body></response>' };
  } });
  const result = await pension.load('gimhae');
  assert.equal(result.recipients.length, 3);
  assert.equal(result.recipients[0].count, 1200);
  assert.equal(result.recipients[0].monthly, 650000);
  assert.equal(result.subscribers.length, 0);
  // 가입현황 인증키 오류는 형식을 바꿔 다시 시도하지 않는다.
  assert.equal(urls.filter(url => url.includes('Sbscrb')).length, 1);
});

test('수급현황·가입현황 인증키를 따로 넣으면 각 API에 맞는 키를 쓴다', async () => {
  const { createPension } = require('./pension.js');
  const seen = [];
  const pension = createPension({ reciptKey: 'RK', sbscrbKey: 'SK', fetchImpl: async url => {
    seen.push(url);
    return { status: 200, ok: true, text: async () => '<response><header><resultCode>00</resultCode></header><body><items><item><totPrsnCnt>5</totPrsnCnt><jnngBrkdSgmntPrsnCnt>7</jnngBrkdSgmntPrsnCnt></item></items></body></response>' };
  } });
  assert.equal(pension.ready, true);
  await pension.load('yangsan');
  assert.ok(seen.filter(url => url.includes('Recipt')).every(url => url.includes('serviceKey=RK')));
  assert.ok(seen.filter(url => url.includes('Sbscrb')).every(url => url.includes('serviceKey=SK')));
  const raw = await pension.raw(new URLSearchParams('op=sbscrb&ldongAddrMgplDgCd=48&jnngpAge=40'));
  assert.equal(raw.used.key, 'PENSION_SBSCRB_KEY');
});

test('국내 PC가 받을 주소 목록을 주고, 올린 원자료로 화면 자료를 만든다(업로드 암호 필요, 해외 호출 안 함)', async () => {
  let outbound = 0;
  const api = createPortalApi({ pensionUploadToken: 'secret-token-1', fetchImpl: async () => { outbound += 1; throw new Error('no direct'); } });
  const plan = await call(api, '/api/portal/pension/plan');
  assert.equal(plan.status, 200);
  assert.ok(plan.body.requests.length >= 21);
  assert.ok(plan.body.requests.every(entry => !entry.url.includes('serviceKey')));
  const xml = age => `<?xml version='1.0' encoding='UTF-8'?><response><header><resultCode>00</resultCode><resultMsg>NORMAL_CODE</resultMsg></header><body><items><item><avgFnlPrvsAmt>629669</avgFnlPrvsAmt><avgPrvsPrdMcnt>1</avgPrvsPrdMcnt><totPrsnCnt>${age}</totPrsnCnt></item></items></body></response>`;
  const results = plan.body.requests.map(entry => ({ url: `${entry.url}&serviceKey=KEY`, xml: entry.op === 'recipt' && /SgguCd=\d{5}/.test(entry.url) ? xml(Number(new URL(entry.url).searchParams.get('crtrAge'))) : '' }));
  const post = (token, body) => new Promise(resolve => {
    const data = Buffer.from(JSON.stringify(body));
    const request = { method: 'POST', url: '/api/portal/pension/upload', headers: { 'x-upload-token': token }, socket: { remoteAddress: '1.1.1.1' }, async *[Symbol.asyncIterator]() { yield data; } };
    const response = { writeHead(code) { this.code = code; }, end(text) { resolve({ status: this.code, body: JSON.parse(text) }); } };
    api(request, response, '/api/portal/pension/upload');
  });
  assert.equal((await post('wrong-token', { results })).status, 403);
  // 수급현황 인증키의 SHA-256 증명으로도 올릴 수 있다
  const keyed = createPortalApi({ pensionKeys: { recipt: 'RECIPT-KEY-123' }, fetchImpl: async () => { throw new Error('no direct'); } });
  const proof = require('node:crypto').createHash('sha256').update('RECIPT-KEY-123').digest('hex');
  const proofPost = (value) => new Promise(resolve => {
    const data = Buffer.from(JSON.stringify({ results }));
    const request = { method: 'POST', url: '/api/portal/pension/upload', headers: { 'x-upload-proof': value }, socket: { remoteAddress: '2.2.2.2' }, async *[Symbol.asyncIterator]() { yield data; } };
    const response = { writeHead(code) { this.code = code; }, end(text) { resolve({ status: this.code, body: JSON.parse(text) }); } };
    keyed(request, response, '/api/portal/pension/upload');
  });
  assert.equal((await proofPost('0'.repeat(64))).status, 403);
  assert.equal((await proofPost(proof)).status, 200);
  const saved = await post('secret-token-1', { results });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.regions, 3);
  const page = await call(api, '/api/portal/pension');
  assert.equal(page.body.connected, true);
  assert.equal(page.body.regions.length, 3);
  assert.equal(page.body.regions[0].recipients[0].count, 60);
  assert.equal(page.body.regions[0].recipients[0].monthly, 629669);
  assert.equal(outbound, 0);
});
