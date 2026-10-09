// 우리 동네 국민연금: 국민연금공단 오픈API(공공데이터포털, 이용허락범위 제한 없음)
// - 수급현황 V2 (15010381): 법정동·연령·성별·연금종별 수급자 수, 월 평균 수급액, 평균 수급기간
// - 가입현황 V2 (15005710): 법정동·연령·성별·가입종별 가입자 수, 평균 예상연금액, 평균 가입개월
// 통계는 매월 초 갱신되므로 하루 한 번만 새로 받는다.

const RECIPT = 'https://apis.data.go.kr/B552015/NpsReciptInfoProvdServiceV2';
const SBSCRB = 'https://apis.data.go.kr/B552015/NpsSbscrbInfoProvdServiceV2';

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

async function call(fetchImpl, key, url, params) {
  const serviceKey = key.includes('%') ? key : encodeURIComponent(key);
  const query = Object.entries({ ...params, pageNo: '1', numOfRows: '10', dataType: 'JSON' })
    .filter(([, value]) => value !== undefined && value !== '').map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('&');
  const response = await fetchImpl(`${url}?serviceKey=${serviceKey}&${query}`, { headers: { Accept: 'application/json' } });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch {
    const auth = /<returnAuthMsg>([^<]*)<\/returnAuthMsg>/.exec(text) || /<resultMsg>([^<]*)<\/resultMsg>/.exec(text);
    throw new Error(auth ? auth[1] : `HTTP ${response.status} ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)}`);
  }
  const root = data.response || data;
  const code = String(root.header?.resultCode ?? '');
  if (code === '03') return [];
  if (code && !/^0+$/.test(code)) throw new Error(`${root.header?.resultMsg || '응답 오류'} (${code})`);
  const items = root.body?.items?.item ?? root.body?.items ?? [];
  return Array.isArray(items) ? items : items ? [items] : [];
}

// 점검용: 응답 머리말(결과 코드)과 본문을 그대로 돌려준다.
async function callRaw(fetchImpl, key, url, params) {
  const serviceKey = key.includes('%') ? key : encodeURIComponent(key);
  const query = Object.entries({ ...params, pageNo: '1', numOfRows: '10', dataType: 'JSON' })
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('&');
  const response = await fetchImpl(`${url}?serviceKey=${serviceKey}&${query}`, { headers: { Accept: 'application/json' } });
  const text = await response.text();
  try { return { status: response.status, data: JSON.parse(text) }; } catch { return { status: response.status, text: text.slice(0, 400) }; }
}

const RAW_PARAMS = ['ldongAddrMgplDgCd', 'ldongAddrMgplSgguCd', 'ldongAddrMgplSgguEmdCd', 'crtrAge', 'jnngpAge', 'sexDvcd', 'payClssCd', 'jnngBrkdJnngpClssCd'];

function createPension({ key = '', fetchImpl = fetch } = {}) {
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
      const all = await firstWithData(region, async sggu => (await call(fetchImpl, key, `${RECIPT}/getReciptSttusInfoSearchV2`,
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
      const all = await firstWithData(region, async sggu => (await call(fetchImpl, key, `${SBSCRB}/getSbscrbSttusInfoSearchV2`,
        { ldongAddrMgplDgCd: region.sido, ldongAddrMgplSgguCd: sggu, jnngpAge: age }))[0]);
      if (!all) continue;
      rows.push({ age: Number(age), count: num(all.jnngBrkdSgmntPrsnCnt), expected: num(all.avgAntcPnsAmt),
        recognized: num(all.rcgnAvgAmt), months: num(all.rcgnAvgMcnt) });
    }
    return rows;
  }
  async function load(regionId) {
    const region = REGIONS.find(entry => entry.id === regionId);
    if (!region || !key) return null;
    const [recipt, sbscrb] = await Promise.all([recipients(region), subscribers(region)]);
    if (!recipt.length && !sbscrb.length) throw new Error('자료 없음');
    return { id: region.id, name: region.name, recipients: recipt, subscribers: sbscrb };
  }
  // 운영 확인용: 정해진 이름의 조건만 받아 원자료(결과 코드 포함)를 그대로 보여 준다(공개 통계).
  async function raw(params) {
    const op = params.get('op');
    const operation = { recipt: `${RECIPT}/getReciptSttusInfoSearchV2`, reciptAge: `${RECIPT}/getReciptAgeInfoSearchV2`,
      sbscrb: `${SBSCRB}/getSbscrbSttusInfoSearchV2`, sbscrbAge: `${SBSCRB}/getSbscrbAgeInfoSearchV2` }[op] || `${RECIPT}/getReciptSttusInfoSearchV2`;
    const query = {};
    for (const name of RAW_PARAMS) {
      const value = params.get(name);
      if (value !== null && /^[0-9A-Za-z]{0,10}$/.test(value)) query[name] = value;
    }
    return callRaw(fetchImpl, key, operation, query);
  }
  return { load, raw, regions: REGIONS };
}

module.exports = { createPension, REGIONS };
