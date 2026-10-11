// 우리 동네 농사정보
// - 농산물 가격: 한국농수산식품유통공사 KAMIS Open-API 「최근일자 도·소매가격정보(상품 기준)」(action=dailySalesList)
//   전국 평균 가격이며, 당일·1일 전·1개월 전·1년 전 가격과 등락률을 함께 준다. 가격 숫자는 "55,094"처럼 쉼표가 든 글자로 오고,
//   값이 없으면 빈 배열([])로 온다.
// - 농사정보: 농촌진흥청 농사로 Open API 「주간농사정보」(weekFarmInfo) 목록. 응답은 XML(<response><header>…<body><items><item>…).
//   서비스·오퍼레이션 이름과 항목 이름은 키 발급 뒤 /api/portal/farm/raw 로 실제 응답을 보고 맞춘다.

const KAMIS = 'https://www.kamis.or.kr/service/price/xml.do';
const NONGSARO = 'http://api.nongsaro.go.kr/service';
const NONGSARO_PAGE = 'https://www.nongsaro.go.kr/';

// 화면에 보여 줄 품목(앞에서부터 순서대로). KAMIS 품목명(item_name)이 이 이름으로 시작하면 고른다.
const WATCH = ['쌀', '찹쌀', '감자', '고구마', '배추', '양배추', '무', '양파', '대파', '마늘', '건고추', '풋고추', '오이', '애호박', '토마토',
  '딸기', '사과', '배', '감귤', '단감', '포도', '수박', '참외', '돼지', '소/', '닭', '달걀', '계란'];
const MAX_ITEMS = 16;

const num = value => {
  if (Array.isArray(value) || value === null || value === undefined) return null;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return String(value).trim() && Number.isFinite(parsed) ? parsed : null;
};

function parseKamis(data) {
  const code = String(data?.error_code ?? data?.data?.error_code ?? '');
  if (code && code !== '000') {
    const messages = { '001': '오늘 자료가 아직 없습니다', '200': '요청 값이 올바르지 않습니다', '900': '인증키(p_cert_key)·아이디(p_cert_id)를 확인해 주세요' };
    const error = new Error(`KAMIS ${code}: ${messages[code] || '응답 오류'}`);
    error.code = code;
    throw error;
  }
  const rows = Array.isArray(data?.price) ? data.price : Array.isArray(data?.data?.item) ? data.data.item : [];
  return rows.map(row => ({
    kind: String(row.product_cls_code || '') === '02' ? 'wholesale' : 'retail',
    category: String(row.category_name || ''),
    code: String(row.productno || ''),
    name: String(row.item_name || row.productName || '').trim(),
    unit: String(row.unit || '').trim(),
    date: String(row.lastest_day || row.latest_day || ''),
    price: num(row.dpr1),
    prevDay: num(row.dpr2),
    prevMonth: num(row.dpr3),
    prevYear: num(row.dpr4),
    direction: { 0: 'down', 1: 'up', 2: 'same' }[String(row.direction)] || 'same',
    rate: num(row.value),
  })).filter(row => row.name && row.price !== null);
}

// 지켜볼 품목만, WATCH 순서대로 고른다(한 품목명에 여러 품종이 있으면 처음 것만).
function pickWatched(rows, kind) {
  const chosen = [];
  const seen = new Set();
  for (const prefix of WATCH) {
    for (const row of rows) {
      if (row.kind !== kind || seen.has(row.name)) continue;
      if (!row.name.startsWith(prefix)) continue;
      chosen.push(row);
      seen.add(row.name);
      break;
    }
    if (chosen.length >= MAX_ITEMS) break;
  }
  return chosen;
}

// 아주 단순한 XML 읽기: <item> … </item> 안의 <태그>값</태그>를 객체로 바꾼다.
const decode = text => String(text || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
function parseNongsaro(xml) {
  const text = String(xml || '');
  const code = /<resultCode>\s*([^<]*?)\s*<\/resultCode>/.exec(text)?.[1];
  const message = decode(/<resultMsg>([\s\S]*?)<\/resultMsg>/.exec(text)?.[1] || '');
  if (code !== undefined && code !== '' && !/^0+$/.test(code)) throw new Error(`농사로 ${code}: ${message || '응답 오류'}`);
  if (!/<item>/.test(text) && /<(html|HTML)/.test(text)) throw new Error('농사로 응답이 XML이 아닙니다(서비스 주소를 확인해 주세요).');
  return [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, body]) => {
    const item = {};
    for (const [, tag, value] of body.matchAll(/<([A-Za-z][\w]*)>([\s\S]*?)<\/\1>/g)) item[tag] = decode(value);
    return item;
  });
}
const pick = (item, names) => names.map(name => item[name]).find(value => value) || '';
function farmNewsItems(items) {
  return items.map(item => {
    const title = pick(item, ['subject', 'sj', 'cntntsSj', 'title', 'weekFarmInfoSj']);
    const date = pick(item, ['regDt', 'updtDt', 'wrtDt', 'registDt', 'rgsde']).slice(0, 10);
    const file = pick(item, ['downFile', 'fileDownUrl', 'atchFileUrl', 'rtnFileUrl']);
    const link = /^https?:\/\//.test(file) ? file : NONGSARO_PAGE;
    return title ? { title: title.slice(0, 120), date, link, file: Boolean(/^https?:\/\//.test(file)) } : null;
  }).filter(Boolean).slice(0, 6);
}

function createFarmInfo({ kamisKey = '', kamisId = '', nongsaroKey = '', fetchImpl = fetch } = {}) {
  const kamisUrl = (action, extra = {}) => `${KAMIS}?${new URLSearchParams({ action, p_cert_key: kamisKey, p_cert_id: kamisId, p_returntype: 'json', ...extra })}`;
  const nongsaroUrl = (service, operation, extra = {}) => `${NONGSARO}/${service}/${operation}?${new URLSearchParams({ apiKey: nongsaroKey, ...extra })}`;

  async function prices() {
    const response = await fetchImpl(kamisUrl('dailySalesList'), { headers: { Accept: 'application/json' } });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`KAMIS 응답을 읽을 수 없습니다 (HTTP ${response.status})`); }
    const rows = parseKamis(data);
    const retail = pickWatched(rows, 'retail');
    const wholesale = pickWatched(rows, 'wholesale');
    const date = (retail[0] || wholesale[0] || rows[0])?.date || '';
    return { date, retail, wholesale, total: rows.length };
  }

  async function farmNews() {
    const response = await fetchImpl(nongsaroUrl('weekFarmInfo', 'weekFarmInfoList', { pageNo: '1', numOfRows: '6' }));
    const items = farmNewsItems(parseNongsaro(await response.text()));
    return { items };
  }

  // 운영자 점검용: 실제 응답 앞부분을 그대로 보여 준다(인증키는 응답에 들어 있지 않다).
  async function raw({ source, service = 'weekFarmInfo', operation = 'weekFarmInfoList', action = 'dailySalesList' }) {
    const safe = value => /^[A-Za-z][A-Za-z0-9]{1,40}$/.test(String(value || ''));
    if (source === 'kamis') {
      if (!safe(action)) throw new Error('action 이름을 확인해 주세요.');
      const response = await fetchImpl(kamisUrl(action));
      return { status: response.status, text: (await response.text()).slice(0, 3000) };
    }
    if (!safe(service) || !safe(operation)) throw new Error('service·operation 이름을 확인해 주세요.');
    const response = await fetchImpl(nongsaroUrl(service, operation, { pageNo: '1', numOfRows: '3' }));
    return { status: response.status, text: (await response.text()).slice(0, 3000) };
  }

  return { prices, farmNews, raw, kamisReady: Boolean(kamisKey && kamisId), nongsaroReady: Boolean(nongsaroKey) };
}

module.exports = { createFarmInfo, parseKamis, pickWatched, parseNongsaro, farmNewsItems, WATCH };
