// Builds the weekly "경제·정책 브리핑" newsletter draft.
// 모든 칸을 자동으로 채운다: 수치는 한국은행 ECOS·IMF·한국부동산원·정책브리핑 공식 자료, 해설은 그 수치로 만든 사실 문장,
// 증시·부동산·세계 정세 소식은 매일경제 RSS의 기사 제목과 원문 링크(본문은 옮기지 않음).
// 운영자는 맨 아래 '운영자 한마디'에 직접 글을 더할 수 있고, 쓰지 않으면 그 칸은 보낼 때 자동으로 빠진다.
// 자료를 불러오지 못한 칸에만 "[직접 작성]" 표시가 남아, 확인하기 전에는 보내지 못하게 막는다.

const { weeklyPolicyNews } = require('./policy-news');
const { fetchFeed, SOFT } = require('./news-issues');
const MANUAL_MARK = '[직접 작성]';
// 선택 칸: 이 표시가 남아 있으면 보낼 때 그 칸(제목부터 다음 '---' 앞까지)을 통째로 뺀다.
const OPTIONAL_MARK = '[선택 작성]';
const DEPARTMENTS = { economy: '기획재정부', industry: '산업통상자원부', finance: '금융위원회', sme: '중소벤처기업부', education: '교육부',
  culture: '문화체육관광부', welfare: '보건복지부', labor: '고용노동부', gender: '여성가족부', environment: '환경부', foreign: '외교부',
  unification: '통일부', defense: '국방부', science: '과학기술정보통신부', landtransport: '국토교통부', agriculture: '농림축산식품부',
  ocean: '해양수산부', safety: '행정안전부', justice: '법무부', personnel: '인사혁신처' };

const DAY = 24 * 60 * 60 * 1000;
const HEADERS = { Accept: 'application/json', 'User-Agent': 'withpluces-newsletter/1.0 (+https://withpluces.com)', 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8' };
const kstDate = timestamp => new Date(timestamp + 9 * 60 * 60 * 1000);
const ymd = timestamp => kstDate(timestamp).toISOString().slice(0, 10).replace(/-/g, '');
const ym = timestamp => kstDate(timestamp).toISOString().slice(0, 7).replace('-', '');
const number = (value, digits = 2) => Number(value).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const signed = (value, digits = 2, suffix = '') => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${number(Math.abs(value), digits)}${suffix}`;
const dateLabel = time => (time.length === 8 ? `${Number(time.slice(4, 6))}/${Number(time.slice(6, 8))}` : `${time.slice(0, 4)}년 ${Number(time.slice(4, 6))}월`);

function nextMondaySeven(now) {
  const kst = kstDate(now);
  const day = kst.getUTCDay();
  let add = (8 - day) % 7;
  const candidate = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + add, 7) - 9 * 60 * 60 * 1000;
  return candidate > now ? candidate : candidate + 7 * DAY;
}

async function ecos(fetchImpl, key, code, cycle, start, end, item) {
  // The public "sample" key returns at most 10 rows (oldest first), so windows below stay short.
  const limit = key === 'sample' ? 10 : 1000;
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(key)}/json/kr/1/${limit}/${code}/${cycle}/${start}/${end}/${item}`;
  const response = await fetchImpl(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`ECOS ${response.status}`);
  const data = await response.json();
  const rows = data?.StatisticSearch?.row;
  if (!Array.isArray(rows) || !rows.length) throw new Error(`ECOS ${data?.RESULT?.CODE || 'empty'} ${code}/${item}`);
  return rows.map(row => ({ time: row.TIME, value: Number(row.DATA_VALUE) })).filter(row => Number.isFinite(row.value))
    .sort((left, right) => left.time.localeCompare(right.time));
}

async function indicators(fetchImpl, key, now, notes = [], facts = {}) {
  const end = ymd(now);
  const start = ymd(now - (key === 'sample' ? 11 : 24) * DAY);
  const daily = async (label, code, item, unit, digits, mode) => {
    try {
      const rows = await ecos(fetchImpl, key, code, 'D', start, end, item);
      const last = rows.at(-1);
      const weekAgo = [...rows].reverse().find(row => row.time <= ymd(Date.parse(`${last.time.slice(0, 4)}-${last.time.slice(4, 6)}-${last.time.slice(6, 8)}T00:00:00+09:00`) - 7 * DAY));
      let change = '';
      if (weekAgo) {
        if (mode === 'percent') change = ` (1주 전 대비 ${signed(((last.value - weekAgo.value) / weekAgo.value) * 100, 2, '%')})`;
        else if (mode === 'point') change = ` (1주 전 대비 ${signed(last.value - weekAgo.value, 3, '%p')})`;
        else change = ` (1주 전 대비 ${signed(last.value - weekAgo.value, digits, unit)})`;
      }
      facts[label] = { value: last.value, previous: weekAgo ? weekAgo.value : null, unit, digits, time: last.time };
      return `- **${label}** ${number(last.value, digits)}${unit}${change} · ${dateLabel(last.time)} 기준`;
    } catch (error) {
      notes.push(`한국은행 ${label}: ${error.message}`);
      return `- **${label}** 자료를 불러오지 못했습니다. ${MANUAL_MARK} 직접 확인해 적어 주세요.`;
    }
  };
  const lines = await Promise.all([
    daily('KOSPI', '802Y001', '0001000', '', 2, 'percent'),
    daily('KOSDAQ', '802Y001', '0089000', '', 2, 'percent'),
    daily('원/달러 환율', '731Y001', '0000001', '원', 1, 'won'),
    daily('국고채 3년 금리', '817Y002', '010200000', '%', 3, 'point'),
  ]);
  try {
    const rows = await ecos(fetchImpl, key, '722Y001', 'D', ymd(now - 7 * DAY), end, '0101000');
    facts.base = { value: rows.at(-1).value };
    lines.push(`- **한국은행 기준금리** 연 ${number(rows.at(-1).value, 2)}% · ${dateLabel(rows.at(-1).time)} 기준`);
  } catch (error) {
    notes.push(`한국은행 기준금리: ${error.message}`);
    lines.push(`- **한국은행 기준금리** 자료를 불러오지 못했습니다. ${MANUAL_MARK} 직접 확인해 적어 주세요.`);
  }
  try {
    const recent = await ecos(fetchImpl, key, '901Y009', 'M', ym(now - 120 * DAY), ym(now), '0');
    const last = recent.at(-1);
    const lastYear = `${Number(last.time.slice(0, 4)) - 1}${last.time.slice(4)}`;
    const previous = await ecos(fetchImpl, key, '901Y009', 'M', lastYear, lastYear, '0');
    const yoy = ((last.value - previous[0].value) / previous[0].value) * 100;
    facts.cpi = { yoy, time: last.time };
    lines.push(`- **소비자물가** 전년 동월 대비 ${signed(yoy, 1, '%')} · ${dateLabel(last.time)} 기준`);
  } catch (error) {
    notes.push(`한국은행 소비자물가: ${error.message}`);
    lines.push(`- **소비자물가** 자료를 불러오지 못했습니다. ${MANUAL_MARK} 직접 확인해 적어 주세요.`);
  }
  return lines;
}

async function globalIndicators(fetchImpl, key, now, notes = [], facts = {}) {
  const lines = [];
  const monthly = async (code, item, from = 6) => ecos(fetchImpl, key, code, 'M', ym(now - from * 31 * DAY), ym(now), item);
  try {
    const parts = [];
    let time = '';
    for (const [item, name] of [['US', '미국'], ['XM', '유로'], ['JP', '일본'], ['CN', '중국']]) {
      const rows = await monthly('902Y006', item);
      parts.push(`${name} ${number(rows.at(-1).value, 2)}%`);
      (facts.rates = facts.rates || []).push({ name, value: rows.at(-1).value, previous: rows.length > 1 ? rows.at(-2).value : null });
      if (!time) time = rows.at(-1).time;
    }
    lines.push(`- **주요국 정책금리** ${parts.join(' · ')} · ${dateLabel(time)} 기준 (BIS)`);
  } catch (error) {
    notes.push(`한국은행 주요국 정책금리: ${error.message}`);
    lines.push(`- **주요국 정책금리** 자료를 불러오지 못했습니다. ${MANUAL_MARK} 직접 확인해 적어 주세요.`);
  }
  try {
    const dubai = await monthly('902Y003', '010102');
    const wti = await monthly('902Y003', '010101');
    const gold = await monthly('902Y003', '040101');
    const change = rows => (rows.length > 1 ? ` (전월 대비 ${signed(((rows.at(-1).value - rows.at(-2).value) / rows.at(-2).value) * 100, 1, '%')})` : '');
    lines.push(`- **국제유가** 두바이 ${number(dubai.at(-1).value, 1)}달러${change(dubai)} · WTI ${number(wti.at(-1).value, 1)}달러${change(wti)} · ${dateLabel(dubai.at(-1).time)} 평균 (IMF)`);
    lines.push(`- **금 시세** 온스당 ${number(gold.at(-1).value, 1)}달러${change(gold)} · ${dateLabel(gold.at(-1).time)} 평균 (IMF)`);
    const monthChange = rows => (rows.length > 1 ? ((rows.at(-1).value - rows.at(-2).value) / rows.at(-2).value) * 100 : null);
    Object.assign(facts, { dubai: { value: dubai.at(-1).value, change: monthChange(dubai), time: dubai.at(-1).time }, gold: { value: gold.at(-1).value, change: monthChange(gold) } });
  } catch (error) {
    notes.push(`한국은행 국제유가·금: ${error.message}`);
    lines.push(`- **국제유가·금** 자료를 불러오지 못했습니다. ${MANUAL_MARK} 직접 확인해 적어 주세요.`);
  }
  try {
    const us = await monthly('902Y002', 'USA');
    const change = us.length > 1 ? ` (전월 대비 ${signed(((us.at(-1).value - us.at(-2).value) / us.at(-2).value) * 100, 1, '%')})` : '';
    lines.push(`- **미국 주가지수(OECD 종합)** ${number(us.at(-1).value, 1)}${change} · ${dateLabel(us.at(-1).time)} 기준`);
    facts.usStocks = { change: us.length > 1 ? ((us.at(-1).value - us.at(-2).value) / us.at(-2).value) * 100 : null, time: us.at(-1).time };
  } catch (error) {
    notes.push(`한국은행 미국 주가지수: ${error.message}`);
    lines.push(`- **미국 주가지수** 자료를 불러오지 못했습니다. ${MANUAL_MARK} 직접 확인해 적어 주세요.`);
  }
  return lines;
}

const IMF_AREAS = [['WEOWORLD', '세계'], ['KOR', '한국'], ['USA', '미국'], ['CHN', '중국'], ['JPN', '일본'], ['EURO', '유로존']];

async function imfOutlook(fetchImpl, now, notes = []) {
  const year = kstDate(now).getUTCFullYear();
  try {
    const response = await fetchImpl(`https://www.imf.org/external/datamapper/api/v1/NGDP_RPCH/${IMF_AREAS.map(([code]) => code).join('/')}`, { headers: HEADERS });
    if (!response.ok) throw new Error(`IMF ${response.status}`);
    const values = (await response.json())?.values?.NGDP_RPCH;
    const lines = IMF_AREAS.filter(([code]) => values?.[code]?.[year] !== undefined)
      .map(([code, name]) => `- **${name}** ${year}년 ${number(values[code][year], 1)}% → ${year + 1}년 ${values[code][year + 1] !== undefined ? `${number(values[code][year + 1], 1)}%` : '-'}`);
    if (!lines.length) throw new Error('IMF empty');
    return ['IMF 세계경제전망(WEO)의 실질 경제성장률 전망입니다.', '', ...lines];
  } catch (error) {
    notes.push(`IMF: ${error.message}`);
    return [`IMF 전망 자료를 불러오지 못했습니다. ${MANUAL_MARK} IMF·OECD·한국은행 전망을 확인해 적어 주세요.`];
  }
}

// 한국부동산원 주간아파트가격동향: 통계표 이름에는 '아파트'가 없고 '(주) 매매가격지수'처럼 표기된다.
const REB_REGIONS = [['전국', '전국'], ['수도권', '수도권'], ['서울', '서울'], ['지방', '지방권']];
const REB_WEEKLY_FALLBACK = { 매매: 'T244183132827305' };

function rebWeekId(timestamp) {
  const date = new Date(timestamp + 9 * 60 * 60 * 1000);
  const year = date.getUTCFullYear();
  const day = Math.floor((date - Date.UTC(year, 0, 1)) / DAY);
  return `${year}${String(Math.max(1, Math.floor(day / 7))).padStart(2, '0')}`;
}

async function rebHousing(fetchImpl, key, now = Date.now()) {
  if (!key) return null;
  const base = 'https://www.reb.or.kr/r-one/openapi';
  const call = async (service, params) => {
    const query = new URLSearchParams({ KEY: key, Type: 'json', ...params });
    const response = await fetchImpl(`${base}/${service}.do?${query}`, { headers: HEADERS });
    if (!response.ok) throw new Error(`REB ${response.status}`);
    const data = await response.json();
    const body = data?.[service];
    if (!Array.isArray(body)) {
      if (data?.RESULT?.CODE === 'INFO-200') return { total: 0, rows: [] };
      throw new Error(`REB ${service} ${data?.RESULT?.CODE || ''} ${data?.RESULT?.MESSAGE || 'invalid response'}`.trim());
    }
    const total = Number(body[0]?.head?.find(entry => entry.list_total_count !== undefined)?.list_total_count || 0);
    return { total, rows: body[1]?.row || [] };
  };
  const tables = [];
  for (let page = 1; page <= 3; page++) {
    const { rows } = await call('SttsApiTbl', { pIndex: String(page), pSize: '1000' });
    tables.push(...rows);
    if (rows.length < 1000) break;
  }
  const isWeekly = table => String(table.DTACYCLE_CD || '').split(',').some(code => ['WK', 'WW'].includes(code.trim()));
  const weekly = tables.filter(table => isWeekly(table) && !/규모|연령|수급|거래|월세|매물|오피스텔|단독|연립/.test(table.STATBL_NM || ''));
  const pick = (label, pattern) => weekly.filter(table => pattern.test(table.STATBL_NM))
    .sort((left, right) => (/아파트|^\(주\)/.test(right.STATBL_NM) - /아파트|^\(주\)/.test(left.STATBL_NM)) || (left.V_ORDER || 0) - (right.V_ORDER || 0))[0]
    || (REB_WEEKLY_FALLBACK[label] ? { STATBL_ID: REB_WEEKLY_FALLBACK[label], STATBL_NM: `(주) ${label}가격지수`, DTACYCLE_CD: 'WK' } : null);
  const tableSets = [['매매', pick('매매', /매매가격지수/)], ['전세', pick('전세', /전세가격지수/)]].filter(([, table]) => table);
  const startWeek = rebWeekId(now - 42 * DAY);
  const endWeek = `${new Date(now + 9 * 60 * 60 * 1000).getUTCFullYear()}53`;
  const lines = [];
  const problems = [];
  const series = [];
  let week = '';
  for (const [label, table] of tableSets) {
    try {
      const rows = [];
      for (let page = 1; page <= 5; page++) {
        const result = await call('SttsApiTblData', { STATBL_ID: table.STATBL_ID, DTACYCLE_CD: 'WK', START_WRTTIME: startWeek, END_WRTTIME: endWeek, pIndex: String(page), pSize: '1000' });
        rows.push(...result.rows);
        if (!result.rows.length || rows.length >= result.total) break;
      }
      const nameOf = row => row.CLS_FULLNM || row.CLS_NM;
      const regional = rows.filter(row => REB_REGIONS.some(([, name]) => name === nameOf(row)) && Number.isFinite(Number(row.DTA_VAL)));
      const times = [...new Set(regional.map(row => row.WRTTIME_IDTFR_ID))].sort();
      if (times.length < 2) throw new Error(`지역(전국·서울 등) 자료가 2주 이상 없음 (${startWeek}~ 받은 행 ${rows.length}개)`);
      const [previous, latest] = times.slice(-2);
      week = regional.find(row => row.WRTTIME_IDTFR_ID === latest)?.WRTTIME_DESC || latest;
      const changes = REB_REGIONS.map(([display, name]) => {
        const current = regional.find(row => row.WRTTIME_IDTFR_ID === latest && nameOf(row) === name);
        const before = regional.find(row => row.WRTTIME_IDTFR_ID === previous && nameOf(row) === name);
        return current && before ? { region: display, change: ((Number(current.DTA_VAL) - Number(before.DTA_VAL)) / Number(before.DTA_VAL)) * 100 } : null;
      }).filter(Boolean);
      if (changes.length) series.push({ label, regions: changes.map(entry => ({ ...entry, change: Math.round(entry.change * 100) / 100 })) });
      const parts = changes.map(entry => `${entry.region} ${signed(entry.change, 2, '%')}`);
      if (parts.length) lines.push(`- **아파트 ${label}가격 (주간 변동률)** ${parts.join(' · ')}`);
    } catch (error) {
      problems.push(`${table.STATBL_NM}(${table.STATBL_ID}): ${error.message}`);
    }
  }
  if (!tableSets.some(([label]) => label === '전세')) problems.push(`주간 전세가격지수 통계표를 찾지 못함 (주간 통계표 후보: ${weekly.map(table => table.STATBL_NM).slice(0, 8).join(', ') || '없음'})`);
  if (!lines.length) throw new Error(problems.join(' / ') || 'REB no regional rows');
  const surveyDate = /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(week)) week = `${Number(week.slice(5, 7))}월 ${Number(week.slice(8, 10))}일 조사`;
  return { lines: [`한국부동산원 주간 아파트 가격동향 (${week} 기준)입니다.`, '', ...lines], problems, data: { week, surveyDate, series } };
}

// ---------- 수치로 만드는 해설(사실 문장만, 전망·권유 없이) ----------
const moved = (change, digits, unit, up = '올랐습니다', down = '내렸습니다') =>
  Math.abs(change) < 10 ** -digits / 2 ? '변동이 거의 없었습니다' : `${number(Math.abs(change), digits)}${unit} ${change > 0 ? up : down}`;
function domesticCommentary(facts) {
  const lines = [];
  const weekly = label => (facts[label]?.previous ? facts[label] : null);
  const kospi = weekly('KOSPI');
  const kosdaq = weekly('KOSDAQ');
  if (kospi) {
    const rate = index => ((index.value - index.previous) / index.previous) * 100;
    const word = change => (Math.abs(change) < 0.005 ? '보합' : `${number(Math.abs(change), 2)}% ${change > 0 ? '상승' : '하락'}`);
    const parts = [`코스피는 ${word(rate(kospi))}`, ...(kosdaq ? [`코스닥은 ${word(rate(kosdaq))}`] : [])];
    const last = parts.at(-1);
    parts[parts.length - 1] = last.endsWith('보합') ? `${last}이었습니다` : `${last}했습니다`;
    lines.push(`- 지난 한 주 ${parts.join(', ')}.`);
  }
  const won = weekly('원/달러 환율');
  if (won) {
    const change = won.value - won.previous;
    lines.push(`- 원/달러 환율은 ${number(won.value, 1)}원으로 1주 전보다 ${moved(change, 1, '원')}${Math.abs(change) >= 0.05 ? (change > 0 ? '(원화 약세)' : '(원화 강세)') : ''}.`);
  }
  const bond = weekly('국고채 3년 금리');
  if (bond) lines.push(`- 국고채 3년 금리는 연 ${number(bond.value, 3)}%로 1주 전보다 ${moved(bond.value - bond.previous, 3, '%p', '높아졌습니다', '낮아졌습니다')}${facts.base ? ` (한국은행 기준금리 연 ${number(facts.base.value, 2)}%)` : ''}.`);
  if (facts.cpi) {
    const gap = facts.cpi.yoy - 2;
    lines.push(`- ${dateLabel(facts.cpi.time)} 소비자물가 상승률은 ${number(facts.cpi.yoy, 1)}%로, 한국은행 물가안정목표(2%)${Math.abs(gap) < 0.15 ? '와 비슷한 수준입니다' : gap > 0 ? `보다 ${number(gap, 1)}%p 높습니다` : `보다 ${number(-gap, 1)}%p 낮습니다`}.`);
  }
  return lines.length ? ['**한 줄 정리**', '', ...lines] : [];
}
function globalCommentary(facts) {
  const lines = [];
  const us = facts.rates?.find(rate => rate.name === '미국');
  if (us) lines.push(`- 미국 정책금리는 ${number(us.value, 2)}%${us.previous !== null && us.previous !== us.value ? `로 직전 달(${number(us.previous, 2)}%)보다 ${us.value > us.previous ? '높아졌습니다' : '낮아졌습니다'}` : '로 직전 달과 같습니다'}.`);
  if (facts.dubai?.change !== null && facts.dubai) lines.push(`- 두바이유는 배럴당 ${number(facts.dubai.value, 1)}달러로 전월보다 ${moved(facts.dubai.change, 1, '%')}.`);
  if (facts.gold?.change !== null && facts.gold) lines.push(`- 금값은 온스당 ${number(facts.gold.value, 1)}달러로 전월보다 ${moved(facts.gold.change, 1, '%')}.`);
  return lines.length ? ['**한 줄 정리**', '', ...lines] : [];
}
function stockCommentary(facts) {
  const lines = [];
  const rate = label => (facts[label]?.previous ? ((facts[label].value - facts[label].previous) / facts[label].previous) * 100 : null);
  if (rate('KOSPI') !== null) lines.push(`- **국내** 코스피 ${number(facts.KOSPI.value, 2)}(1주 ${signed(rate('KOSPI'), 2, '%')})${rate('KOSDAQ') !== null ? ` · 코스닥 ${number(facts.KOSDAQ.value, 2)}(1주 ${signed(rate('KOSDAQ'), 2, '%')})` : ''}`);
  if (facts.usStocks?.change !== null && facts.usStocks) lines.push(`- **미국** OECD 종합 주가지수가 ${dateLabel(facts.usStocks.time)} 한 달 동안 ${signed(facts.usStocks.change, 1, '%')} 움직였습니다(월간 자료).`);
  return lines;
}

// ---------- 매일경제 RSS: 지난 한 주 많이 보도된 기사 제목·원문 링크 ----------
const NEWS_FEEDS = { headline: '30000001', all: '40300001', economy: '30100041', world: '30300018' };
const TOPICS = {
  stock: /코스피|코스닥|증시|주가|나스닥|S&P|다우|상장|IPO|공매도|시가총액|외국인.{0,4}(순매수|순매도)|반도체주|배당|실적|어닝/,
  realestate: /부동산|아파트|집값|전세|월세|청약|분양|재건축|재개발|주택|LTV|DSR|공시가격|토지거래허가|임대차|미분양/,
};
const NEWS_SKIP = /관심종목|추천주|급등주|매수 추천|목표주가|리딩방|\[MBN\]|\[영상\]|\[포토\]/;
const wordsOf = title => new Set(String(title).replace(/\[[^\]]*\]/g, ' ').replace(/[“”"‘’'…·,.!?()<>~:;/|\-]/g, ' ').split(/\s+/).filter(word => word.length >= 2));
function topNews(items, count) {
  const list = items.filter(item => !SOFT.test(item.title) && !NEWS_SKIP.test(item.title));
  const words = list.map(item => wordsOf(item.title));
  const scored = list.map((item, index) => ({ item, score: words.reduce((sum, other, j) => sum + (j !== index && [...words[index]].filter(word => other.has(word)).length >= 2 ? 1 : 0), 0) }));
  const chosen = [];
  for (const { item } of scored.sort((left, right) => right.score - left.score || String(right.item.at).localeCompare(String(left.item.at)))) {
    const mine = wordsOf(item.title);
    if (chosen.some(other => [...wordsOf(other.title)].filter(word => mine.has(word)).length >= 2)) continue;
    chosen.push(item);
    if (chosen.length >= count) break;
  }
  return chosen;
}
const newsLine = item => `- [${item.title.replace(/[\[\]]/g, '')}](${item.link})${item.at ? ` · ${dateLabel(ymd(Date.parse(item.at)))}` : ''}`;
async function weeklyNews(fetchImpl, now, notes = []) {
  const all = new Map();
  const world = [];
  for (const [name, code] of Object.entries(NEWS_FEEDS)) {
    try {
      for (const item of await fetchFeed(fetchImpl, code)) {
        if (item.at && now - Date.parse(item.at) > 7 * DAY) continue;
        all.set(item.no, item);
        if (name === 'world') world.push(item);
      }
    } catch (error) {
      notes.push(`매일경제 RSS(${name}): ${error.message}`);
    }
  }
  const items = [...all.values()];
  return {
    stock: topNews(items.filter(item => TOPICS.stock.test(item.title)), 3),
    realestate: topNews(items.filter(item => TOPICS.realestate.test(item.title)), 3),
    world: topNews(world.length ? world : items.filter(item => /world|international/.test(item.path)), 3),
  };
}

function highlightLines(posts, siteUrl) {
  const lines = [];
  const clip = text => {
    const line = String(text).replace(/[*_#`>\[\]]/g, '').replace(/\s+/g, ' ').trim();
    return line.length > 70 ? `${line.slice(0, 70)}…` : line;
  };
  for (const post of posts.policy) lines.push(`- **[정책 제안 · ${DEPARTMENTS[post.category] || post.category}]** ${clip(post.text)} (추천 ${post.likes})`);
  for (const post of posts.voice) lines.push(`- **[시민의 소리 · ${post.category}]** ${clip(post.text)}`);
  for (const post of posts.community) lines.push(`- **[소통·나눔]** ${clip(post.text)}`);
  if (posts.researchCount) lines.push(`- **칼럼·학술**에 새 글 ${posts.researchCount}편이 올라왔습니다.`);
  if (!lines.length) lines.push('- 지난 한 주 동안 새로 올라온 글이 없습니다. 이번 주에는 여러분의 목소리를 들려주세요.');
  lines.push('', `[커뮤니티에서 더 보기](${siteUrl}/)`);
  return lines;
}

async function buildWeeklyDraft({ fetchImpl = fetch, ecosKey, rebKey, policyKey = '', now = Date.now(), siteUrl = 'https://withpluces.com', highlights }) {
  const sendAt = nextMondaySeven(now);
  const sendDate = kstDate(sendAt);
  const title = `${sendDate.getUTCMonth() + 1}월 ${sendDate.getUTCDate()}일`;
  const key = ecosKey || 'sample';
  const notes = [];
  const facts = {};
  const [figures, global, outlook, news] = await Promise.all([indicators(fetchImpl, key, now, notes, facts), globalIndicators(fetchImpl, key, now, notes, facts), imfOutlook(fetchImpl, now, notes),
    weeklyNews(fetchImpl, now, notes)]);
  const newsBlock = (items, intro) => (items.length ? [intro, '', ...items.map(newsLine)] : []);
  let housing;
  try {
    const result = await rebHousing(fetchImpl, rebKey, now);
    if (result) {
      housing = result.lines;
      for (const problem of result.problems) notes.push(`한국부동산원: ${problem}`);
    }
  } catch (error) {
    housing = null;
    notes.push(`한국부동산원: ${error.message}`);
  }
  if (!rebKey) notes.push('한국부동산원: 인증키(REB_API_KEY)가 없습니다.');
  let policy = null;
  try {
    const result = await weeklyPolicyNews(fetchImpl, policyKey, now);
    if (result) {
      policy = result.count ? result.lines : null;
      if (!result.count) notes.push('정책브리핑: 지난 한 주 경제 관련 정책뉴스를 찾지 못했습니다.');
      for (const problem of result.problems) notes.push(`정책브리핑: ${problem}`);
    }
  } catch (error) {
    notes.push(`정책브리핑: ${error.message}`);
  }
  const posts = highlights ? await highlights(new Date(now - 7 * DAY).toISOString()) : { policy: [], voice: [], community: [], researchCount: 0 };
  const body = [
    `# ${title} 주간 경제·정책 브리핑`,
    '',
    '안녕하세요, 스페이스 커뮤니티입니다. 지난 한 주의 국내외 경제 흐름과 커뮤니티에서 나온 시민의 목소리를 정리해 드립니다.',
    '',
    '## 국내 금융·경제 지표',
    '',
    ...figures,
    '',
    ...domesticCommentary(facts),
    '',
    '## 세계 경제',
    '',
    ...global,
    '',
    '### 성장률 전망',
    '',
    ...outlook,
    '',
    ...globalCommentary(facts),
    '',
    '## 주식 시장',
    '',
    ...stockCommentary(facts),
    '',
    ...newsBlock(news.stock, '**이번 주 증시에서 많이 보도된 소식** (기사 제목·원문 링크)'),
    '',
    '## 부동산',
    '',
    ...(housing || ['한국부동산원 주간 아파트 가격동향은 인증키(REB_API_KEY)를 등록하면 자동으로 채워집니다.']),
    '',
    ...newsBlock(news.realestate, '**이번 주 부동산 주요 소식** (정책·청약·거래 — 기사 제목·원문 링크)'),
    '',
    '## 세계 정세',
    '',
    ...(news.world.length ? newsBlock(news.world, '지난 한 주 국제 면에서 가장 많이 다뤄진 소식입니다. (기사 제목·원문 링크)')
      : [`${MANUAL_MARK} 국제 뉴스를 불러오지 못했습니다. 경제에 영향을 준 국제 이슈를 사실 중심으로 적고 원문 링크를 붙여 주세요.`]),
    '',
    '## 이번 주 정부 정책',
    '',
    ...(policy || ['정책브리핑 인증키(POLICY_NEWS_KEY)를 등록하면 지난 한 주 경제 정책뉴스가 자동으로 채워집니다.']),
    '',
    '## 커뮤니티에서 나온 목소리',
    '',
    ...highlightLines(posts, siteUrl),
    '',
    '## ✍️ 운영자 한마디',
    '',
    `${OPTIONAL_MARK} 이 칸은 운영자가 직접 쓰는 곳입니다. 이 줄을 지우고 이번 주 해설·의견·소식을 자유롭게 적어 주세요. 아무것도 쓰지 않으면 이 칸은 보낼 때 자동으로 빠집니다.`,
    '',
    '---',
    '',
    '이 뉴스레터는 정보 제공을 위한 것이며 특정 금융상품이나 종목의 매매를 권유하지 않습니다. 투자 판단과 그 결과의 책임은 투자자 본인에게 있습니다.',
    '',
    '자료 출처: 한국은행 경제통계시스템(ECOS) · 국제통화기금(IMF) World Economic Outlook(https://www.imf.org/external/datamapper)' + (housing ? ' · 한국부동산원 부동산통계정보시스템(R-ONE)' : '') + (policy ? ' · 대한민국 정책브리핑(www.korea.kr, 공공누리 제1유형)' : '') + ((news.stock.length || news.realestate.length || news.world.length) ? ' · 매일경제(기사 제목과 원문 링크만 소개, 저작권은 매일경제에 있음)' : '') + '. 국제 지표는 한국은행이 BIS·IMF·OECD 자료를 수록한 것입니다.',
  ].join('\n');
  return { subject: `스페이스 레터 · ${title} 주간 경제·정책 브리핑`, body, sendAt, notes: notes.map(note => note.slice(0, 300)) };
}

// 보낼 때: '[선택 작성]' 표시가 남은 선택 칸(## 제목부터 다음 ## 또는 --- 앞까지)을 통째로 뺀다.
function stripOptional(body) {
  const lines = String(body).split('\n');
  const out = [];
  for (let index = 0; index < lines.length; index++) {
    if (/^## /.test(lines[index])) {
      let end = index + 1;
      while (end < lines.length && !/^(## |---)/.test(lines[end])) end++;
      const block = lines.slice(index, end);
      if (block.some(line => line.includes(OPTIONAL_MARK))) { index = end - 1; continue; }
    }
    if (!lines[index].includes(OPTIONAL_MARK)) out.push(lines[index]);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

module.exports = { buildWeeklyDraft, nextMondaySeven, MANUAL_MARK, OPTIONAL_MARK, stripOptional, ecos, rebHousing, HEADERS, domesticCommentary, topNews };
