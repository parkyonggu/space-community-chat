// 우리 동네 국민연금: 국민연금공단 오픈API(공공데이터포털, 이용허락범위 제한 없음)
// - 수급현황 V2 (15010381): 법정동·연령·성별·연금종별 수급자 수, 월 평균 수급액, 평균 수급기간
// - 가입현황 V2 (15005710): 법정동·연령·성별·가입종별 가입자 수, 평균 예상연금액, 평균 가입개월
// 통계는 매월 초 갱신되므로 하루 한 번만 새로 받는다.

const DEFAULT_RECIPT = 'https://apis.data.go.kr/B552015/NpsReciptInfoProvdServiceV2';
const DEFAULT_SBSCRB = 'https://apis.data.go.kr/B552015/NpsSbscrbInfoProvdServiceV2';

// 운영자가 공공데이터포털에서 확인한 서비스 주소(End Point)를 넣을 수 있게 한다.
// 기능 이름까지 붙여 넣어도(…/getReciptSttusInfoSearchV2) 서비스 주소만 남기고, 물음표 뒤 값(인증키 등)은 버린다.
function serviceBase(value, fallback) {
  const text = String(value || '').trim().split('?')[0].replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+\/\S+$/.test(text)) return fallback;
  // 공공데이터포털 화면 주소(www.data.go.kr/…do)는 API 주소가 아니므로 쓰지 않는다.
  if (/^https?:\/\/(www\.)?data\.go\.kr\//i.test(text) || /\.do(\/|$)/i.test(text)) return fallback;
  return text.replace(/\/(get[A-Za-z0-9]+)$/, '');
}

// 법정동 코드: 시도 2자리 + 시군구 5자리
const REGIONS = [
  { id: 'yangsan', name: '양산시', sido: '48', sggu: '48330' },
  { id: 'gimhae', name: '김해시', sido: '48', sggu: '48250' },
  { id: 'uiryeong', name: '의령군', sido: '48', sggu: '48720' },
];
const RECIPT_AGES = ['60', '70', '80'];
const SBSCRB_AGES = ['20', '30', '40', '50'];

const num = value => {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

// XML 응답 읽기: <item>…</item> 안의 <태그>값</태그>를 객체로 바꾼다.
const decode = text => String(text || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
const tag = (text, name) => { const found = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text); return found ? decode(found[1]) : undefined; };
function parseXml(text, status) {
  const auth = tag(text, 'returnAuthMsg') || tag(text, 'errMsg');
  if (/<OpenAPI_ServiceResponse>/.test(text)) throw new Error(`${auth || '응답 오류'}${tag(text, 'returnReasonCode') ? ` (${tag(text, 'returnReasonCode')})` : ''}`);
  const code = tag(text, 'resultCode');
  if (code === undefined) throw new Error(`HTTP ${status} ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)}`);
  if (code === '03') return [];
  if (code && !/^0+$/.test(code)) throw new Error(`${tag(text, 'resultMsg') || '응답 오류'} (${code})`);
  return [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, body]) => {
    const item = {};
    for (const [, name, value] of body.matchAll(/<([A-Za-z][\w]*)>([\s\S]*?)<\/\1>/g)) item[name] = decode(value);
    return item;
  });
}
function parseJson(data, status, ok) {
  // 인증 오류는 JSON으로도 OpenAPI_ServiceResponse 모양으로 온다.
  const gateway = data.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (gateway) throw new Error(`${gateway.returnAuthMsg || gateway.errMsg || `HTTP ${status}`}${gateway.returnReasonCode ? ` (${gateway.returnReasonCode})` : ''}`);
  const root = data.response || data;
  if (!root.header && !ok) throw new Error(`HTTP ${status}`);
  const code = String(root.header?.resultCode ?? '');
  if (code === '03') return [];
  if (code && !/^0+$/.test(code)) throw new Error(`${root.header?.resultMsg || '응답 오류'} (${code})`);
  const items = root.body?.items?.item ?? root.body?.items ?? [];
  return Array.isArray(items) ? items : items ? [items] : [];
}

// format: 'JSON'(dataType=JSON) | 'XML'(dataType 생략 = 기본 XML). scheme: 'https' | 'http'
function buildUrl(key, url, params, { format = 'JSON', scheme = 'https' } = {}) {
  const serviceKey = key.includes('%') ? key : encodeURIComponent(key);
  const extra = format === 'JSON' ? { dataType: 'JSON' } : format === 'xml' ? { dataType: 'XML' } : {};
  const query = Object.entries({ ...params, pageNo: '1', numOfRows: '10', ...extra })
    .filter(([, value]) => value !== undefined && value !== '').map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('&');
  return `${scheme === 'http' ? url.replace(/^https:/, 'http:') : url}?serviceKey=${serviceKey}&${query}`;
}
async function callOnce(fetchImpl, key, url, params, mode) {
  const response = await fetchImpl(buildUrl(key, url, params, mode), { headers: { Accept: mode.format === 'JSON' ? 'application/json' : 'application/xml' } });
  const text = await response.text();
  if (/^\s*[{[]/.test(text)) return parseJson(JSON.parse(text), response.status, response.ok);
  return parseXml(text, response.status);
}

// 공단 쪽 시험은 기본(XML)으로 하므로, JSON이 시간초과(05)·실패하면 XML → http 순으로 다시 시도하고 되는 방식을 기억한다.
const MODES = [{ format: 'JSON', scheme: 'https' }, { format: 'XML', scheme: 'https' }, { format: 'XML', scheme: 'http' }];
const workingMode = new Map();
const failedAt = new Map(); // 같은 형식이 막 실패했으면 잠시(5분) 건너뛰어 요청 수를 아낀다.
const FAIL_SKIP = 5 * 60 * 1000;
async function call(fetchImpl, key, url, params) {
  const base = url.split('/').slice(0, -1).join('/');
  const ordered = workingMode.has(base) ? [workingMode.get(base), ...MODES.filter(mode => mode !== workingMode.get(base))] : MODES;
  const fresh = ordered.filter(mode => !(Date.now() - (failedAt.get(`${base}|${mode.format}|${mode.scheme}`) || 0) < FAIL_SKIP));
  const modes = fresh.length ? fresh : [ordered[0]];
  let lastError;
  for (const mode of modes) {
    try {
      const items = await callOnce(fetchImpl, key, url, params, mode);
      workingMode.set(base, mode);
      failedAt.delete(`${base}|${mode.format}|${mode.scheme}`);
      return items;
    } catch (error) {
      lastError = error;
      // 인증키 문제는 형식을 바꿔도 같으므로 바로 알린다.
      if (/SERVICE_KEY|등록되지 않은|\((20|30|31)\)/.test(error.message)) throw error;
      failedAt.set(`${base}|${mode.format}|${mode.scheme}`, Date.now());
    }
  }
  throw lastError;
}

// 점검용: 응답 머리말(결과 코드)과 본문을 그대로 돌려준다.
async function callRaw(fetchImpl, key, url, params, mode) {
  const response = await fetchImpl(buildUrl(key, url, params, mode), { headers: { Accept: mode.format === 'JSON' ? 'application/json' : 'application/xml' } });
  const text = await response.text();
  const used = { format: mode.format, scheme: mode.scheme, endpoint: url };
  try { return { status: response.status, used, data: JSON.parse(text) }; } catch { return { status: response.status, used, text: text.slice(0, 1500) }; }
}

const RAW_PARAMS = ['ldongAddrMgplDgCd', 'ldongAddrMgplSgguCd', 'ldongAddrMgplSgguEmdCd', 'crtrAge', 'jnngpAge', 'sexDvcd', 'payClssCd', 'jnngBrkdJnngpClssCd'];

// 수급현황·가입현황 인증키가 따로 나온 경우 각각 넣을 수 있다(없으면 공통 key를 쓴다).
function createPension({ key = '', reciptKey = '', sbscrbKey = '', fetchImpl = fetch, reciptUrl = '', sbscrbUrl = '' } = {}) {
  const RKEY = reciptKey || key;
  const SKEY = sbscrbKey || key;
  const RECIPT = serviceBase(reciptUrl, DEFAULT_RECIPT);
  const SBSCRB = serviceBase(sbscrbUrl, DEFAULT_SBSCRB);
  // 시군구 코드를 5자리(48720)로 받는지 3자리(720)로 받는지 설명서에 없어, 자료가 나오는 쪽을 골라 기억한다.
  const sgguStyle = new Map();
  const sgguOf = (region, style) => (style === 'short' ? region.sggu.slice(2) : region.sggu);
  async function firstWithData(region, fetchRow) {
    const styles = sgguStyle.has(region.id) ? [sgguStyle.get(region.id)] : ['full', 'short'];
    for (const style of styles) {
      const row = await fetchRow(sgguOf(region, style));
      if (row) { sgguStyle.set(region.id, style); return row; }
    }
    return null;
  }
  // 수급: 연령대별 전체 연금(00)
  async function recipients(region) {
    const rows = [];
    for (const age of RECIPT_AGES) {
      const all = await firstWithData(region, async sggu => (await call(fetchImpl, RKEY, `${RECIPT}/getReciptSttusInfoSearchV2`,
        { ldongAddrMgplDgCd: region.sido, ldongAddrMgplSgguCd: sggu, crtrAge: age, payClssCd: '00' }))[0]);
      if (!all) continue;
      rows.push({ age: Number(age), count: num(all.totPrsnCnt), monthly: num(all.avgFnlPrvsAmt), months: num(all.avgPrvsPrdMcnt),
        total: num(all.avgTotPrvsAmt), ratio: num(all.whlPymtCtstPrvsRate) });
    }
    return rows;
  }
  // 가입: 연령대별 전체 가입자
  async function subscribers(region) {
    const rows = [];
    for (const age of SBSCRB_AGES) {
      const all = await firstWithData(region, async sggu => (await call(fetchImpl, SKEY, `${SBSCRB}/getSbscrbSttusInfoSearchV2`,
        { ldongAddrMgplDgCd: region.sido, ldongAddrMgplSgguCd: sggu, jnngpAge: age }))[0]);
      if (!all) continue;
      rows.push({ age: Number(age), count: num(all.jnngBrkdSgmntPrsnCnt), expected: num(all.avgAntcPnsAmt),
        recognized: num(all.rcgnAvgAmt), months: num(all.rcgnAvgMcnt) });
    }
    return rows;
  }
  async function load(regionId) {
    const region = REGIONS.find(entry => entry.id === regionId);
    if (!region || !(RKEY || SKEY)) return null;
    // 한쪽 API가 막혀도(예: 가입현황 미승인) 다른 쪽 자료만으로 보여 준다. 키가 없는 쪽은 부르지 않는다.
    const [reciptResult, sbscrbResult] = await Promise.allSettled([RKEY ? recipients(region) : [], SKEY ? subscribers(region) : []]);
    const recipt = reciptResult.status === 'fulfilled' ? reciptResult.value : [];
    const sbscrb = sbscrbResult.status === 'fulfilled' ? sbscrbResult.value : [];
    if (!recipt.length && !sbscrb.length) {
      const failed = [reciptResult, sbscrbResult].find(result => result.status === 'rejected');
      throw failed ? failed.reason : new Error('자료 없음');
    }
    return { id: region.id, name: region.name, recipients: recipt, subscribers: sbscrb };
  }
  // 운영 확인용: 정해진 이름의 조건만 받아 원자료(결과 코드 포함)를 그대로 보여 준다(공개 통계).
  async function raw(params) {
    const op = params.get('op');
    const operation = { recipt: `${RECIPT}/getReciptSttusInfoSearchV2`, reciptAge: `${RECIPT}/getReciptAgeInfoSearchV2`,
      reciptMax: `${RECIPT}/getReciptMaxValueInfoSearchV2`,
      sbscrb: `${SBSCRB}/getSbscrbSttusInfoSearchV2`, sbscrbAge: `${SBSCRB}/getSbscrbAgeInfoSearchV2` }[op] || `${RECIPT}/getReciptSttusInfoSearchV2`;
    const query = {};
    for (const name of RAW_PARAMS) {
      const value = params.get(name);
      if (value !== null && /^[0-9A-Za-z]{0,10}$/.test(value)) query[name] = value;
    }
    // dataType=JSON(기본) · XML(dataType 생략, 공단 기본값) · XMLPARAM(dataType=XML을 명시) / scheme=https(기본)·http
    const format = { XML: 'XML', XMLPARAM: 'xml' }[String(params.get('dataType') || '').toUpperCase()] || 'JSON';
    const scheme = params.get('scheme') === 'http' ? 'http' : 'https';
    const result = await callRaw(fetchImpl, operation.startsWith(SBSCRB) ? SKEY : RKEY, operation, query, { format, scheme });
    // 어느 인증키를 썼는지(값은 숨기고 종류만) 함께 보여 준다.
    result.used.key = operation.startsWith(SBSCRB) ? (sbscrbKey ? 'PENSION_SBSCRB_KEY' : 'PENSION_API_KEY') : (reciptKey ? 'PENSION_RECIPT_KEY' : 'PENSION_API_KEY');
    return result;
  }
  return { load, raw, regions: REGIONS, endpoints: { recipt: RECIPT, sbscrb: SBSCRB }, ready: Boolean(RKEY || SKEY) };
}

module.exports = { createPension, REGIONS, parseXml, buildUrl, serviceBase };
