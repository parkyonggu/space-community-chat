// "오늘의 부동산 동향": 국토교통부 실거래가 공개 API(공공데이터포털, 이용허락 제한 없음)로
// 주요 지역의 최근 30일 계약·신고분을 아파트 / 건물(상업·업무용) / 임야 / 농지로 나눠 요약한다.
// 개발계정 호출 한도(API별 하루 1,000회)와 Workers 하위 요청 한도를 지키려고, 지역·월 단위(unit)로
// 나눠 한 번에 몇 개씩만 새로 받아 저장하고, 화면에는 저장된 unit을 모아 보여 준다.

const DAY = 24 * 60 * 60 * 1000;
const kst = timestamp => new Date(timestamp + 9 * 60 * 60 * 1000);
const ymdNumber = timestamp => Number(kst(timestamp).toISOString().slice(0, 10).replace(/-/g, ''));
const ymOf = timestamp => kst(timestamp).toISOString().slice(0, 7).replace('-', '');

const REGIONS = [
  ['11680', '서울 강남구'], ['11350', '서울 노원구'], ['41135', '성남 분당구'], ['41220', '경기 평택시'],
  ['41830', '경기 양평군'], ['28185', '인천 연수구'], ['26350', '부산 해운대구'], ['27260', '대구 수성구'],
  ['29200', '광주 광산구'], ['30200', '대전 유성구'], ['36110', '세종시'], ['43113', '청주 흥덕구'],
  ['44270', '충남 당진시'], ['50110', '제주 제주시'],
];

const SOURCES = {
  apt: { path: 'RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade', label: '아파트 매매' },
  nrg: { path: 'RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade', label: '상업업무용 부동산 매매' },
  land: { path: 'RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade', label: '토지 매매' },
};

const FARM = new Set(['전', '답', '과수원']);
const MAX_DEALS_PER_UNIT = 600;
const BATCH = 12;

function decodeXml(text) {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
}

// Parses the API's XML (or JSON, if the gateway returns it) into plain objects.
function parseResponse(text) {
  const body = text.trim();
  if (body.startsWith('{')) {
    const data = JSON.parse(body);
    const root = data.response || data;
    const code = String(root.header?.resultCode ?? '');
    if (code && !/^0+$/.test(code)) throw new Error(`${root.header?.resultMsg || '오류'} (${code})`);
    const items = root.body?.items?.item ?? [];
    return { total: Number(root.body?.totalCount || 0), items: Array.isArray(items) ? items : [items] };
  }
  const auth = body.match(/<returnAuthMsg>([^<]*)<\/returnAuthMsg>/);
  if (auth) throw new Error(decodeXml(auth[1]));
  const code = body.match(/<resultCode>([^<]*)<\/resultCode>/);
  if (code && !/^0+$/.test(code[1].trim())) {
    const message = body.match(/<resultMsg>([^<]*)<\/resultMsg>/);
    throw new Error(`${message ? decodeXml(message[1]) : '오류'} (${code[1].trim()})`);
  }
  if (!code && !/<items|<item>/.test(body)) throw new Error(`알 수 없는 응답: ${body.slice(0, 80)}`);
  const items = [...body.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(match => {
    const item = {};
    for (const field of match[1].matchAll(/<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g)) item[field[1]] = decodeXml(field[2]);
    return item;
  });
  const total = body.match(/<totalCount>(\d+)<\/totalCount>/);
  return { total: total ? Number(total[1]) : items.length, items };
}

const amountOf = value => Number(String(value ?? '').replace(/[^\d.]/g, '')) || 0;
const areaOf = value => Number(String(value ?? '').replace(/[^\d.]/g, '')) || 0;

// Compact deal: [date(YYYYMMDD), amount(만원), area(㎡), 법정동, name/use, kind]
function compact(source, item) {
  if (String(item.cdealType || '').trim()) return null; // 해제된 거래 제외
  if (/지분/.test(String(item.shareDealingType || ''))) return null; // 지분 거래 제외
  const date = Number(`${item.dealYear}${String(item.dealMonth).padStart(2, '0')}${String(item.dealDay).padStart(2, '0')}`);
  const amount = amountOf(item.dealAmount);
  if (!date || !amount) return null;
  if (source === 'apt') return [date, amount, areaOf(item.excluUseAr), item.umdNm || '', item.aptNm || '', 'apt', String(item.floor || '')];
  if (source === 'nrg') return [date, amount, areaOf(item.buildingAr), item.umdNm || '', item.buildingUse || item.buildingType || '', 'bldg', String(item.floor || '')];
  const jimok = String(item.jimok || '').trim();
  const kind = jimok === '임야' ? 'forest' : FARM.has(jimok) ? 'farm' : null;
  if (!kind) return null;
  return [date, amount, areaOf(item.dealArea), item.umdNm || '', jimok, kind, ''];
}

async function fetchUnit(fetchImpl, key, source, lawd, ym) {
  const serviceKey = key.includes('%') ? key : encodeURIComponent(key);
  const url = `https://apis.data.go.kr/1613000/${SOURCES[source].path}?serviceKey=${serviceKey}&LAWD_CD=${lawd}&DEAL_YMD=${ym}&pageNo=1&numOfRows=1000`;
  const response = await fetchImpl(url, { headers: { Accept: 'application/xml, application/json' } });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)}`);
  const { items } = parseResponse(text);
  return items.map(item => compact(source, item)).filter(Boolean)
    .sort((a, b) => b[0] - a[0]).slice(0, MAX_DEALS_PER_UNIT);
}

const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const CATEGORIES = [
  ['apt', '아파트'], ['bldg', '건물'], ['forest', '임야'], ['farm', '농지'],
];

function summarize(units, now) {
  const to = ymdNumber(now);
  const from = ymdNumber(now - 30 * DAY);
  const regionName = Object.fromEntries(REGIONS);
  const categories = CATEGORIES.map(([id, label]) => {
    const deals = [];
    for (const unit of units) {
      for (const deal of unit.deals || []) {
        if (deal[5] === id && deal[0] >= from && deal[0] <= to) deals.push({ deal, lawd: unit.lawd });
      }
    }
    const perArea = id === 'forest' || id === 'farm';
    const regions = REGIONS.map(([lawd, name]) => {
      const mine = deals.filter(entry => entry.lawd === lawd).map(entry => entry.deal);
      if (!mine.length) return { lawd, name, count: 0 };
      const value = perArea
        ? median(mine.filter(deal => deal[2] > 0).map(deal => (deal[1] * 10000) / deal[2]))
        : median(mine.map(deal => deal[1]));
      return { lawd, name, count: mine.length, median: value === null ? null : Math.round(value) };
    }).filter(region => region.count > 0).sort((a, b) => b.count - a.count);
    const recent = deals.sort((a, b) => b.deal[0] - a.deal[0] || b.deal[1] - a.deal[1]).slice(0, 6).map(({ deal, lawd }) => ({
      date: String(deal[0]), amount: deal[1], area: deal[2], region: regionName[lawd], dong: deal[3], name: deal[4], floor: deal[6],
    }));
    return { id, label, metric: perArea ? 'perSquareMeter' : 'amount', count: deals.length, regions, recent };
  });
  return { from: String(from), to: String(to), categories };
}

function createRealEstate({ key = '', fetchImpl = fetch, store, now = Date.now }) {
  const unitKey = (source, lawd, ym) => `portal:re:${source}:${lawd}:${ym}`;

  function plan(at) {
    const months = [ymOf(at), ymOf(at - 30 * DAY)];
    if (months[0] === months[1]) months.pop();
    const units = [];
    for (const source of Object.keys(SOURCES)) for (const [lawd] of REGIONS) for (const ym of months) units.push({ source, lawd, ym, current: ym === months[0] });
    return units;
  }

  // Refreshes up to BATCH stale units and returns the summary built from everything stored.
  async function load() {
    if (!key) return null;
    const at = now();
    const units = plan(at);
    const stored = await Promise.all(units.map(unit => store.get(unitKey(unit.source, unit.lawd, unit.ym))));
    const staleAfter = unit => (unit.current ? 6 : 24) * 60 * 60 * 1000;
    const due = units.map((unit, index) => ({ unit, index, entry: stored[index] }))
      .filter(({ unit, entry }) => !entry || at - entry.at > (entry.error ? 30 * 60 * 1000 : staleAfter(unit)))
      .sort((a, b) => (a.entry?.at || 0) - (b.entry?.at || 0))
      .slice(0, BATCH);
    const errors = [];
    await Promise.all(due.map(async ({ unit, index, entry }) => {
      try {
        const deals = await fetchUnit(fetchImpl, key, unit.source, unit.lawd, unit.ym);
        stored[index] = { at, deals };
      } catch (error) {
        errors.push(`${SOURCES[unit.source].label}: ${error.message}`);
        stored[index] = { at, deals: entry?.deals || [], error: error.message, ok: entry?.ok };
      }
      if (!stored[index].error) stored[index].ok = true;
      await store.set(unitKey(unit.source, unit.lawd, unit.ym), stored[index]);
    }));
    const ready = stored.filter(entry => entry?.ok).length;
    const lastErrors = [...new Set([...errors, ...stored.filter(entry => entry?.error).map(entry => entry.error)])].slice(0, 3);
    const summary = summarize(units.map((unit, index) => ({ lawd: unit.lawd, deals: stored[index]?.deals || [] })), at);
    return {
      updatedAt: new Date(at).toISOString(), ...summary,
      coverage: { ready, total: units.length }, complete: ready === units.length,
      problems: lastErrors, regions: REGIONS.length,
      source: '국토교통부 실거래가 공개시스템(공공데이터포털)',
    };
  }

  return { load };
}

module.exports = { createRealEstate, parseResponse, summarize, REGIONS };
