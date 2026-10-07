// Data for the portal front page: market indicators (Bank of Korea ECOS), weekly apartment prices
// (한국부동산원 R-ONE) and the live chat head count. Upstream calls are cached so page views never
// hit the public APIs directly.
const { ecos, rebHousing } = require('./weekly-brief');

const DAY = 24 * 60 * 60 * 1000;
const kstDate = timestamp => new Date(timestamp + 9 * 60 * 60 * 1000);
const ymd = timestamp => kstDate(timestamp).toISOString().slice(0, 10).replace(/-/g, '');
const ym = timestamp => kstDate(timestamp).toISOString().slice(0, 7).replace('-', '');
const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

// Next Thursday release date (KST, YYYYMMDD). On Thursday itself it is today.
function nextReleaseOf(timestamp) {
  const date = kstDate(timestamp);
  const ahead = (4 - date.getUTCDay() + 7) % 7;
  return ymd(timestamp + ahead * DAY);
}

const DAILY = [
  { id: 'kospi', name: 'KOSPI', code: '802Y001', item: '0001000', unit: '', digits: 2, change: 'percent' },
  { id: 'kosdaq', name: 'KOSDAQ', code: '802Y001', item: '0089000', unit: '', digits: 2, change: 'percent' },
  { id: 'usdkrw', name: '원/달러', code: '731Y001', item: '0000001', unit: '원', digits: 1, change: 'value' },
  { id: 'ktb3y', name: '국고채 3년', code: '817Y002', item: '010200000', unit: '%', digits: 3, change: 'point' },
];

const INDICATOR_TTL = 30 * 60 * 1000;
const HOUSING_TTL = 6 * 60 * 60 * 1000;
const HOUSING_RELEASE_TTL = 60 * 60 * 1000;
const RETRY_AFTER_FAILURE = 5 * 60 * 1000;

function createPortalApi({ ecosKey = '', rebKey = '', fetchImpl = fetch, cache, now = Date.now, onlineCount = async () => null, rateLimit } = {}) {
  const memory = new Map();
  const store = cache || { get: async key => memory.get(key), set: async (key, value) => { memory.set(key, value); } };
  const inflight = new Map();
  const key = ecosKey || 'sample';

  async function loadIndicators() {
    const at = now();
    const end = ymd(at);
    const items = await Promise.all(DAILY.map(async spec => {
      try {
        const rows = await ecos(fetchImpl, key, spec.code, 'D', ymd(at - 14 * DAY), end, spec.item);
        const last = rows.at(-1);
        const previous = rows.at(-2);
        const result = { id: spec.id, name: spec.name, value: round(last.value, spec.digits), unit: spec.unit, digits: spec.digits, date: last.time };
        if (previous) {
          if (spec.change === 'percent') Object.assign(result, { change: round(last.value - previous.value, spec.digits), changePercent: round(((last.value - previous.value) / previous.value) * 100, 2) });
          else if (spec.change === 'point') Object.assign(result, { change: round(last.value - previous.value, 3), changeUnit: '%p' });
          else Object.assign(result, { change: round(last.value - previous.value, spec.digits), changeUnit: spec.unit });
        }
        return result;
      } catch (error) {
        return { id: spec.id, name: spec.name, value: null, error: error.message };
      }
    }));
    try {
      const rows = await ecos(fetchImpl, key, '722Y001', 'D', ymd(at - 10 * DAY), end, '0101000');
      items.push({ id: 'base', name: '기준금리', value: round(rows.at(-1).value, 2), unit: '%', digits: 2, date: rows.at(-1).time, note: '한국은행' });
    } catch (error) {
      items.push({ id: 'base', name: '기준금리', value: null, error: error.message });
    }
    try {
      const rows = await ecos(fetchImpl, key, '902Y003', 'M', ym(at - 6 * 31 * DAY), ym(at), '010102');
      const last = rows.at(-1);
      const previous = rows.at(-2);
      items.push({ id: 'dubai', name: '두바이유', value: round(last.value, 1), unit: '달러', digits: 1, date: last.time, note: '월평균',
        ...(previous ? { changePercent: round(((last.value - previous.value) / previous.value) * 100, 1), changeLabel: '전월 대비' } : {}) });
    } catch (error) {
      items.push({ id: 'dubai', name: '두바이유', value: null, error: error.message });
    }
    // 금 시세: 한국은행 국제상품가격(런던 금 월평균, 달러/트로이온스). KRX 일별 금 시세는 공공누리 제4유형(상업적 이용·재배포 금지)이라 쓰지 않는다.
    try {
      const rows = await ecos(fetchImpl, key, '902Y003', 'M', ym(at - 8 * 31 * DAY), ym(at), '040101');
      const last = rows.at(-1);
      const previous = rows.at(-2);
      items.push({ id: 'gold', name: '국제 금', value: round(last.value, 1), unit: '달러', digits: 1, date: last.time, note: '온스당 월평균',
        ...(previous ? { changePercent: round(((last.value - previous.value) / previous.value) * 100, 1), changeLabel: '전월 대비' } : {}) });
    } catch (error) {
      items.push({ id: 'gold', name: '국제 금', value: null, error: error.message });
    }
    if (items.every(item => item.value === null)) throw new Error(items.map(item => item.error).join(' / '));
    return { updatedAt: new Date(at).toISOString(), today: ymd(at), items, source: '한국은행 경제통계시스템(ECOS)' };
  }

  async function loadHousing() {
    if (!rebKey) return null;
    const result = await rebHousing(fetchImpl, rebKey, now());
    if (!result?.data?.series?.length) throw new Error('부동산원 자료 없음');
    const surveyDate = result.data.surveyDate || '';
    let nextRelease = nextReleaseOf(now());
    // 조사일(월요일) 주의 목요일 발표분이 이미 반영됐으면 다음 주 목요일이 다음 발표일이다.
    if (surveyDate && nextRelease <= ymd(Date.parse(`${surveyDate}T00:00:00+09:00`) + 3 * DAY)) nextRelease = ymd(Date.parse(`${nextRelease.slice(0, 4)}-${nextRelease.slice(4, 6)}-${nextRelease.slice(6, 8)}T00:00:00+09:00`) + 7 * DAY);
    return { updatedAt: new Date(now()).toISOString(), week: result.data.week, surveyDate, nextRelease, series: result.data.series, source: '한국부동산원 R-ONE' };
  }

  // 한국부동산원 주간 동향은 매주 목요일 오후에 발표된다. 목·금요일에는 1시간마다 새 주차를 확인한다.
  function housingTtl() {
    const day = kstDate(now()).getUTCDay();
    return day === 4 || day === 5 ? HOUSING_RELEASE_TTL : HOUSING_TTL;
  }

  // Serves the cached value while fresh; refreshes once at a time; on failure keeps the last good value.
  async function cached(name, ttl, loader) {
    const entry = await store.get(`portal:${name}`);
    const at = now();
    if (entry && at < entry.freshUntil) return entry.value;
    if (!inflight.has(name)) {
      inflight.set(name, (async () => {
        try {
          const value = await loader();
          await store.set(`portal:${name}`, { value, freshUntil: now() + ttl });
          return value;
        } catch (error) {
          console.error(`Portal ${name} refresh failed:`, error.message);
          await store.set(`portal:${name}`, { value: entry?.value ?? null, freshUntil: now() + RETRY_AFTER_FAILURE });
          return entry?.value ?? null;
        } finally {
          inflight.delete(name);
        }
      })());
    }
    return inflight.get(name);
  }

  async function handlePortalApi(request, response, pathname) {
    const send = (status, body) => {
      const payload = JSON.stringify(body);
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(payload);
    };
    if (pathname !== '/api/portal') { send(404, { error: '요청한 기능이 없습니다.' }); return; }
    if (request.method !== 'GET') { send(405, { error: '지원하지 않는 요청 방식입니다.' }); return; }
    const ip = request.socket?.remoteAddress || 'unknown';
    if (rateLimit && !rateLimit(`portal:${ip}`, 120, 60000, now())) { send(429, { error: '요청이 많습니다. 잠시 후 다시 시도해 주세요.' }); return; }
    const [indicators, housing, online] = await Promise.all([
      cached('indicators', INDICATOR_TTL, loadIndicators),
      cached('housing', housingTtl(), loadHousing),
      onlineCount().catch(() => null),
    ]);
    send(200, { indicators, housing, online });
  }

  return handlePortalApi;
}

module.exports = { createPortalApi, nextReleaseOf };
