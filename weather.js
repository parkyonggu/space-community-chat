// 오늘의 날씨: 기상청 단기예보 조회서비스(공공데이터포털 15084084)
// - 초단기실황(getUltraSrtNcst): 지금 기온·강수 (매시 정각 자료, 40분쯤 공개)
// - 단기예보(getVilageFcst): 오늘~모레 최저/최고, 하늘, 강수확률 (02·05·08·11·14·17·20·23시 발표, 10분쯤 공개)
// 오늘 최저·최고는 그날 02시 발표분에만 다 들어 있어 따로 받아 하루 동안 쓴다.

const BASE = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// 시·군청 위치(위도, 경도) → 기상청 격자(nx, ny)로 바꿔 쓴다.
const REGIONS = [
  { id: 'yangsan', name: '양산', lat: 35.3350, lon: 129.0373 },
  { id: 'gimhae', name: '김해', lat: 35.2285, lon: 128.8894 },
  { id: 'uiryeong', name: '의령', lat: 35.3222, lon: 128.2617 },
  { id: 'jinju', name: '진주', lat: 35.1800, lon: 128.1076 },
  { id: 'changwon', name: '창원', lat: 35.2280, lon: 128.6811 },
  { id: 'busan', name: '부산', lat: 35.1798, lon: 129.0750 },
  { id: 'seoul', name: '서울', lat: 37.5665, lon: 126.9780 },
];

// 기상청 격자 변환(Lambert Conformal Conic, 기상청 공개 공식)
function toGrid(lat, lon) {
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;
  const DEGRAD = Math.PI / 180.0;
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD, slat2 = SLAT2 * DEGRAD, olon = OLON * DEGRAD, olat = OLAT * DEGRAD;
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lon * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;
  return { nx: Math.floor(ra * Math.sin(theta) + XO + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5) };
}

const kstParts = timestamp => {
  const date = new Date(timestamp + 9 * HOUR);
  return { ymd: date.toISOString().slice(0, 10).replace(/-/g, ''), hour: date.getUTCHours(), minute: date.getUTCMinutes() };
};

// 초단기실황 기준 시각: 매시 40분 이후에 그 시각 자료가 나온다.
function ncstBase(now) {
  const at = kstParts(now).minute < 40 ? now - HOUR : now;
  const parts = kstParts(at);
  return { date: parts.ymd, time: `${String(parts.hour).padStart(2, '0')}00` };
}

// 단기예보 기준 시각: 가장 최근 발표(발표 후 10분 여유)
function fcstBase(now) {
  const slots = [2, 5, 8, 11, 14, 17, 20, 23];
  const parts = kstParts(now - 10 * 60 * 1000);
  const slot = [...slots].reverse().find(hour => hour <= parts.hour);
  if (slot === undefined) return { date: kstParts(now - 10 * 60 * 1000 - DAY).ymd, time: '2300' };
  return { date: parts.ymd, time: `${String(slot).padStart(2, '0')}00` };
}

// 오늘 최저·최고가 모두 들어 있는 그날 02시 발표분(02:10 전이면 전날 23시분)
function dayBase(now) {
  const parts = kstParts(now);
  if (parts.hour > 2 || (parts.hour === 2 && parts.minute >= 10)) return { date: parts.ymd, time: '0200' };
  return { date: kstParts(now - DAY).ymd, time: '2300' };
}

async function call(fetchImpl, key, operation, base, grid, rows) {
  const serviceKey = key.includes('%') ? key : encodeURIComponent(key);
  const url = `${BASE}/${operation}?serviceKey=${serviceKey}&pageNo=1&numOfRows=${rows}&dataType=JSON&base_date=${base.date}&base_time=${base.time}&nx=${grid.nx}&ny=${grid.ny}`;
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch {
    const auth = /<returnAuthMsg>([^<]*)<\/returnAuthMsg>/.exec(text);
    throw new Error(auth ? auth[1] : `HTTP ${response.status} ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)}`);
  }
  const header = data?.response?.header;
  if (!header || header.resultCode !== '00') throw new Error(`${header?.resultMsg || '응답 오류'} (${header?.resultCode || response.status})`);
  const items = data.response.body?.items?.item;
  return Array.isArray(items) ? items : items ? [items] : [];
}

const PTY = { 0: '', 1: '비', 2: '비/눈', 3: '눈', 4: '소나기', 5: '빗방울', 6: '빗방울·눈날림', 7: '눈날림' };
const SKY = { 1: '맑음', 3: '구름많음', 4: '흐림' };
const num = value => (value === undefined || value === null || value === '' ? null : Number(value));

function parseNow(items) {
  const get = category => items.find(item => item.category === category)?.obsrValue;
  if (!items.length) return null;
  const pty = num(get('PTY')) || 0;
  return {
    temp: num(get('T1H')), humidity: num(get('REH')), wind: num(get('WSD')), rain1h: num(get('RN1')) || 0,
    pty, ptyText: PTY[pty] || '', at: `${items[0].baseDate}${items[0].baseTime}`,
  };
}

// 날짜별로 묶어 최저/최고, 낮 하늘, 강수확률 최대값과 강수 형태를 정리한다.
function summarizeDays(items, dayItems, today) {
  const byDate = new Map();
  const add = item => {
    if (!byDate.has(item.fcstDate)) byDate.set(item.fcstDate, []);
    byDate.get(item.fcstDate).push(item);
  };
  items.forEach(add);
  const extremes = new Map();
  for (const item of [...dayItems, ...items]) {
    if (item.category !== 'TMN' && item.category !== 'TMX') continue;
    const entry = extremes.get(item.fcstDate) || {};
    if (entry[item.category] === undefined) entry[item.category] = num(item.fcstValue);
    extremes.set(item.fcstDate, entry);
  }
  const dates = [...new Set([...byDate.keys(), ...extremes.keys()])].filter(date => date >= today).sort().slice(0, 3);
  return dates.map(date => {
    const list = byDate.get(date) || [];
    const values = category => list.filter(item => item.category === category);
    const temps = values('TMP').map(item => num(item.fcstValue)).filter(Number.isFinite);
    const pops = values('POP').map(item => num(item.fcstValue)).filter(Number.isFinite);
    const daytime = item => item.fcstTime >= '0900' && item.fcstTime <= '1800';
    const skies = values('SKY').filter(daytime).map(item => num(item.fcstValue));
    const sky = skies.length ? [4, 3, 1].find(code => skies.filter(value => value === code).length >= skies.length / 2) || skies[Math.floor(skies.length / 2)] : null;
    const rainy = values('PTY').filter(item => num(item.fcstValue) > 0);
    const rainTimes = rainy.map(item => item.fcstTime);
    const ext = extremes.get(date) || {};
    return {
      date,
      min: Number.isFinite(ext.TMN) ? ext.TMN : temps.length ? Math.min(...temps) : null,
      max: Number.isFinite(ext.TMX) ? ext.TMX : temps.length ? Math.max(...temps) : null,
      sky, skyText: SKY[sky] || '',
      pop: pops.length ? Math.max(...pops) : null,
      pty: rainy.length ? num(rainy[0].fcstValue) : 0,
      ptyText: rainy.length ? PTY[num(rainy[0].fcstValue)] || '비' : '',
      rainFrom: rainTimes.length ? rainTimes.sort()[0] : null,
    };
  });
}

function createWeather({ key = '', fetchImpl = fetch, now = Date.now } = {}) {
  const grids = Object.fromEntries(REGIONS.map(region => [region.id, toGrid(region.lat, region.lon)]));
  async function current(regionId) {
    if (!key) return null;
    return parseNow(await call(fetchImpl, key, 'getUltraSrtNcst', ncstBase(now()), grids[regionId], 20));
  }
  async function forecast(regionId) {
    if (!key) return null;
    return { base: fcstBase(now()), items: (await call(fetchImpl, key, 'getVilageFcst', fcstBase(now()), grids[regionId], 1000))
      .filter(item => ['TMP', 'TMN', 'TMX', 'SKY', 'PTY', 'POP'].includes(item.category))
      .map(({ category, fcstDate, fcstTime, fcstValue }) => ({ category, fcstDate, fcstTime, fcstValue })) };
  }
  async function dayExtremes(regionId) {
    if (!key) return null;
    return (await call(fetchImpl, key, 'getVilageFcst', dayBase(now()), grids[regionId], 1000))
      .filter(item => item.category === 'TMN' || item.category === 'TMX')
      .map(({ category, fcstDate, fcstTime, fcstValue }) => ({ category, fcstDate, fcstTime, fcstValue }));
  }
  function build(regionId, nowData, fcst, extremes) {
    const region = REGIONS.find(entry => entry.id === regionId);
    const days = fcst ? summarizeDays(fcst.items, extremes || [], kstParts(now()).ymd) : [];
    return { id: region.id, name: region.name, grid: grids[regionId], now: nowData, days };
  }
  return { current, forecast, dayExtremes, build, regions: REGIONS, grids, dayKey: () => dayBase(now()).date + dayBase(now()).time };
}

module.exports = { createWeather, toGrid, ncstBase, fcstBase, dayBase, summarizeDays, parseNow, REGIONS };
