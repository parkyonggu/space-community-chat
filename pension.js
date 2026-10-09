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

function createPension({ key = '', fetchImpl = fetch } = {}) {
  // 수급: 연령대별 전체 연금(00)과 노령연금(10)
  async function recipients(region) {
    const rows = [];
    for (const age of RECIPT_AGES) {
      const [all] = await call(fetchImpl, key, `${RECIPT}/getReciptSttusInfoSearchV2`,
        { ldongAddrMgplDgCd: region.sido, ldongAddrMgplSgguCd: region.sggu, crtrAge: age, payClssCd: '00' });
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
      const [all] = await call(fetchImpl, key, `${SBSCRB}/getSbscrbSttusInfoSearchV2`,
        { ldongAddrMgplDgCd: region.sido, ldongAddrMgplSgguCd: region.sggu, jnngpAge: age });
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
  // 운영 확인용: 허용된 조건으로 원자료 한 건을 그대로 보여 준다(공개 통계).
  async function raw({ op, age, sggu }) {
    const region = REGIONS.find(entry => entry.sggu === sggu) || REGIONS[2];
    const value = String(age || '').replace(/\D/g, '').slice(0, 3) || '60';
    if (op === 'sbscrb') return call(fetchImpl, key, `${SBSCRB}/getSbscrbSttusInfoSearchV2`, { ldongAddrMgplDgCd: region.sido, ldongAddrMgplSgguCd: region.sggu, jnngpAge: value });
    return call(fetchImpl, key, `${RECIPT}/getReciptSttusInfoSearchV2`, { ldongAddrMgplDgCd: region.sido, ldongAddrMgplSgguCd: region.sggu, crtrAge: value, payClssCd: '00' });
  }
  return { load, raw, regions: REGIONS };
}

module.exports = { createPension, REGIONS };
