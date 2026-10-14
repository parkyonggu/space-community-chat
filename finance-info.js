// 우리 동네 금융정보: 금융감독원 「금융상품 한눈에」 Open API
// - 정기예금(depositProductsSearch)·적금(savingProductsSearch): 은행(020000)·저축은행(030300)
// - 연금저축(annuitySavingProductsSearch): 보험(050000)·금융투자(060000)
// JSON 응답: { result: { err_cd, err_msg, total_count, max_page_no, now_page_no, baseList: [...], optionList: [...] } }
// 금리순 '정보 제공'이며 가입 권유가 아니다(화면에도 표시).

const HOSTS = ['https://finlife.fss.or.kr', 'http://finlife.fss.or.kr'];
const GROUPS = { '020000': '은행', '030300': '저축은행', '050000': '보험', '060000': '금융투자' };
const MAX_PAGES = 5;
const ERRORS = { '010': '미등록 인증키', '011': '중지된 인증키', '012': '삭제된 인증키', '013': '샘플 인증키', '020': '일일 이용 횟수 초과', '021': '허용된 IP가 아님(개인으로 신청한 키가 필요)', '900': '금감원 시스템 오류' };

const num = value => {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
  return String(value ?? '').trim() !== '' && Number.isFinite(parsed) ? parsed : null;
};
const clip = (text, length) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, length);
const JOIN_DENY = { 1: '제한 없음', 2: '서민 전용', 3: '일부 제한' };

function createFinanceInfo({ key = '', fetchImpl = fetch } = {}) {
  let workingHost = HOSTS[0];
  async function call(service, group, page) {
    let lastError;
    for (const host of [workingHost, ...HOSTS.filter(entry => entry !== workingHost)]) {
      try {
        const url = `${host}/finlifeapi/${service}.json?auth=${encodeURIComponent(key)}&topFinGrpNo=${group}&pageNo=${page}`;
        const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch { throw new Error(`금감원 응답을 읽을 수 없습니다 (HTTP ${response.status})`); }
        const result = data.result || data;
        const code = String(result.err_cd || '');
        if (code && code !== '000') {
          const error = new Error(`금감원 ${code}: ${ERRORS[code] || result.err_msg || '응답 오류'}`);
          error.fatal = true;
          throw error;
        }
        workingHost = host;
        return { base: result.baseList || [], options: result.optionList || [], maxPage: Number(result.max_page_no) || 1 };
      } catch (error) {
        lastError = error;
        if (error.fatal) throw error;
      }
    }
    throw lastError;
  }
  async function collect(service, groups) {
    // 그룹별로 동시에, 첫 쪽을 받은 뒤 나머지 쪽도 동시에 받아 처음 불러오는 시간을 줄인다
    const parts = await Promise.all(groups.map(async group => {
      const first = await call(service, group, 1);
      const pages = [];
      for (let page = 2; page <= Math.min(first.maxPage, MAX_PAGES); page += 1) pages.push(page);
      const rest = await Promise.all(pages.map(page => call(service, group, page)));
      return [first, ...rest].map(result => ({ ...result, base: result.base.map(item => ({ ...item, group })) }));
    }));
    const flat = parts.flat();
    return { base: flat.flatMap(result => result.base), options: flat.flatMap(result => result.options) };
  }

  // 정기예금·적금: 12개월 금리(없으면 가장 가까운 기간)로 정렬
  function savingsRows(base, options, kind) {
    const byProduct = new Map();
    for (const option of options) {
      const id = `${option.fin_co_no}|${option.fin_prdt_cd}`;
      if (!byProduct.has(id)) byProduct.set(id, []);
      byProduct.get(id).push(option);
    }
    const seen = new Set();
    const rows = [];
    for (const item of base) {
      const id = `${item.fin_co_no}|${item.fin_prdt_cd}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const list = (byProduct.get(id) || []).filter(option => num(option.save_trm) !== null);
      if (!list.length) continue;
      const pickTerm = list.some(option => num(option.save_trm) === 12) ? 12
        : list.map(option => num(option.save_trm)).sort((a, b) => Math.abs(a - 12) - Math.abs(b - 12))[0];
      const sameTerm = list.filter(option => num(option.save_trm) === pickTerm);
      const best = sameTerm.sort((a, b) => (num(b.intr_rate2) ?? 0) - (num(a.intr_rate2) ?? 0))[0];
      const rate = num(best.intr_rate);
      const maxRate = num(best.intr_rate2) ?? rate;
      if (rate === null && maxRate === null) continue;
      rows.push({
        kind,
        group: GROUPS[item.group] || '',
        company: clip(item.kor_co_nm, 30),
        name: clip(item.fin_prdt_nm, 60),
        term: pickTerm,
        rate,
        maxRate,
        rateType: clip(best.intr_rate_type_nm, 6),
        reserveType: kind === 'saving' ? clip(best.rsrv_type_nm, 10) : '',
        joinWay: clip(item.join_way, 60),
        joinDeny: JOIN_DENY[String(item.join_deny)] || '',
        member: clip(item.join_member, 80),
        special: clip(item.spcl_cnd, 300),
        maxLimit: num(item.max_limit),
        month: String(item.dcls_month || ''),
      });
    }
    return rows.sort((a, b) => (b.maxRate ?? 0) - (a.maxRate ?? 0) || (b.rate ?? 0) - (a.rate ?? 0)).slice(0, 40);
  }

  // 연금저축: 보험은 공시이율, 펀드는 평균 수익률(과거 수익률은 미래를 보장하지 않음)
  // 연금저축 판매 회사 종류: 은행(신탁) / 생명보험·손해보험(보험) / 금융투자(펀드)
  function sectorOf(item) {
    if (item.group === '020000') return '은행';
    if (item.group === '060000') return '금융투자';
    if (item.group === '050000') return /생명/.test(item.kor_co_nm || '') ? '생명보험' : '손해보험';
    return '';
  }
  function annuityRows(base) {
    const seen = new Set();
    return base
      .filter(item => { const id = `${item.fin_co_no}|${item.fin_prdt_cd}`; if (seen.has(id)) return false; seen.add(id); return true; })
      .map(item => ({
        group: GROUPS[item.group] || '',
        sector: sectorOf(item),
        company: clip(item.kor_co_nm, 30),
        name: clip(item.fin_prdt_nm, 70),
        pensionKind: clip(item.pnsn_kind_nm, 20),
        productType: clip(item.prdt_type_nm, 20),
        avgRate: num(item.avg_prft_rate),
        disclosedRate: num(item.dcls_rate),
        guaranteedRate: num(item.guar_rate),
        recent: [num(item.btrm_prft_rate_1), num(item.btrm_prft_rate_2), num(item.btrm_prft_rate_3)],
        joinWay: clip(item.join_way, 60),
        month: String(item.dcls_month || ''),
      }))
      .filter(row => (row.pensionKind || row.productType) && (row.avgRate !== null || row.disclosedRate !== null))
      .sort((a, b) => (b.avgRate ?? b.disclosedRate ?? 0) - (a.avgRate ?? a.disclosedRate ?? 0))
      .slice(0, 80);
  }

  async function deposits() {
    const { base, options } = await collect('depositProductsSearch', ['020000', '030300']);
    return savingsRows(base, options, 'deposit');
  }
  async function savings() {
    const { base, options } = await collect('savingProductsSearch', ['020000', '030300']);
    return savingsRows(base, options, 'saving');
  }
  async function annuities() {
    const { base } = await collect('annuitySavingProductsSearch', ['020000', '050000', '060000']);
    return annuityRows(base);
  }
  async function raw(service = 'depositProductsSearch', group = '020000', page = '1') {
    const safe = /^[A-Za-z]{5,40}$/.test(service) ? service : 'depositProductsSearch';
    const pageNo = /^\d{1,3}$/.test(String(page)) ? page : '1';
    const response = await fetchImpl(`${workingHost}/finlifeapi/${safe}.json?auth=${encodeURIComponent(key)}&topFinGrpNo=${/^\d{6}$/.test(group) ? group : '020000'}&pageNo=${pageNo}`);
    return { status: response.status, host: workingHost, text: (await response.text()).slice(0, 2000) };
  }
  return { deposits, savings, annuities, raw, ready: Boolean(key) };
}

module.exports = { createFinanceInfo, GROUPS };
