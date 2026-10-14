// 연금저축 회사별 비교: 금융감독원 통합연금포털 Open API (www.fss.or.kr/openapi)
// - psCorpList: 회사별 수익률·수수료율 (year, quarter, areaCode 1 은행 · 3 자산운용 · 4 생명보험 · 5 손해보험)
// - psGuaranteedProdList: 판매 중인 원리금보장 연금저축보험 공시이율·최저보증이율 (areaCode 4·5)
// 화면에는 "통합연금포털(금융감독원) 콘텐츠"임을 표시해야 한다(이용약관 제9조).

const BASE = 'https://www.fss.or.kr/openapi/api';
const AREAS = [
  { code: 1, sector: '은행' },
  { code: 3, sector: '금융투자' },
  { code: 4, sector: '생명보험' },
  { code: 5, sector: '손해보험' },
];
const ERRORS = {
  '001': '조회 결과 없음', '100': '인증키가 유효하지 않음', '101': '하루 사용 한도 초과', '102': '호출 IP가 인증키 정보와 다름',
  '200': '서비스 없음', '500': '금감원 서버 오류', '501': '금감원 서버 무응답', '600': '승인 후 사용 가능한 서비스', '700': '요청값 오류', '900': '정의되지 않은 오류',
};

const num = value => {
  if (value === null || value === undefined || String(value).trim() === '' || String(value).trim() === '-') return null;
  const parsed = Number(String(value).replace(/[,%]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
};
const clip = (text, length) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, length);

// 가장 최근에 공시된 분기부터 거꾸로 찾는다 (분기 공시는 보통 다음 분기 중에 올라온다)
function recentQuarters(date = new Date(), count = 6) {
  let year = date.getFullYear();
  let quarter = Math.floor(date.getMonth() / 3) + 1;
  const list = [];
  for (let index = 0; index < count; index += 1) {
    quarter -= 1;
    if (quarter === 0) { quarter = 4; year -= 1; }
    list.push({ year, quarter });
  }
  return list;
}

function createPensionSavings({ key = '', fetchImpl = fetch, now = () => new Date() } = {}) {
  async function call(api, params) {
    const query = new URLSearchParams({ key, ...params });
    const response = await fetchImpl(`${BASE}/${api}.json?${query}`, { headers: { Accept: 'application/json' } });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`통합연금포털 응답을 읽을 수 없습니다 (HTTP ${response.status})`); }
    const result = data.result || data.response || data;
    const code = String(result.code ?? result.resultCode ?? '000').padStart(3, '0');
    if (code === '001') return [];
    if (code !== '000') {
      const error = new Error(`통합연금포털 ${code}: ${ERRORS[code] || result.message || '응답 오류'}`);
      error.fatal = true;
      throw error;
    }
    const list = result.list || result.data || [];
    return Array.isArray(list) ? list : [list];
  }

  // 회사별 수익률·수수료율: 권역마다 가장 최근 분기 자료
  async function companies() {
    const quarters = recentQuarters(now());
    const out = [];
    let basis = null;
    for (const area of AREAS) {
      for (const period of quarters) {
        const list = await call('psCorpList', { year: period.year, quarter: period.quarter, areaCode: area.code });
        if (!list.length) continue;
        basis = basis || period;
        for (const item of list) {
          out.push({
            sector: area.sector,
            company: clip(item.company, 30),
            reserve: num(item.reserve),
            earnRate: num(item.earnRate),
            earnRate1: num(item.earnRate1),
            avg3: num(item.avgEarnRate3),
            avg5: num(item.avgEarnRate5),
            avg10: num(item.avgEarnRate10),
            fee3: num(item.avgFeeRate3),
            feeRate1: num(item.feeRate1),
            period: `${period.year}년 ${period.quarter}분기`,
          });
        }
        break;
      }
    }
    return { basis, rows: out.filter(row => row.company) };
  }

  // 판매 중인 원리금보장 연금저축보험 (생명·손해보험)
  async function guaranteed() {
    const out = [];
    for (const area of AREAS.filter(entry => entry.code >= 4)) {
      const list = await call('psGuaranteedProdList', { areaCode: area.code });
      for (const item of list) {
        out.push({
          sector: area.sector,
          company: clip(item.company, 30),
          product: clip(item.product, 70),
          rate: num(item.publishedInterestRate),
          guaranteed: num(item.guaranteedInterestRate),
          online: clip(item.onlineFeeDesc, 160),
          agent: clip(item.fpFeeDesc || item.agentFeeDesc, 160),
          tel: clip(item.tel, 20),
          month: clip(item.reportDate, 10),
        });
      }
    }
    return out.filter(row => row.company && row.rate !== null);
  }

  async function load() {
    const [corp, guar] = await Promise.all([companies(), guaranteed().catch(error => { if (error.fatal) throw error; return []; })]);
    return { basis: corp.basis ? `${corp.basis.year}년 ${corp.basis.quarter}분기` : '', companies: corp.rows, guaranteed: guar };
  }

  async function raw(api = 'psCorpList', params = {}) {
    const safe = /^ps\w{2,30}$/.test(api) ? api : 'psCorpList';
    const query = new URLSearchParams({ key, ...params });
    const response = await fetchImpl(`${BASE}/${safe}.json?${query}`);
    return { status: response.status, text: (await response.text()).slice(0, 2000) };
  }

  return { load, raw, ready: Boolean(key) };
}

module.exports = { createPensionSavings, recentQuarters, AREAS };
