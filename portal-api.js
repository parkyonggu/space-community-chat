// Data for the portal front page: market indicators (Bank of Korea ECOS), weekly apartment prices
// (한국부동산원 R-ONE) and the live chat head count. Upstream calls are cached so page views never
// hit the public APIs directly.
const { ecos, rebHousing } = require('./weekly-brief');
const { createRealEstate } = require('./realestate');
const { recentPolicyNews } = require('./policy-news');
const localBenefits = require('./local-benefits');
const { createWeather } = require('./weather');
const { createPension } = require('./pension');
const newsIssues = require('./news-issues');

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
const POLICY_TTL = 30 * 60 * 1000;
const REALESTATE_TTL = 60 * 60 * 1000;
const REALESTATE_FILL_TTL = 3 * 60 * 1000;
const RETRY_AFTER_FAILURE = 5 * 60 * 1000;
const BENEFITS_TTL = 12 * 60 * 60 * 1000;
const BENEFITS_PAGE = 60;

function createPortalApi({ ecosKey = '', rebKey = '', molitKey = '', molitKeys = {}, policyKey = '', benefitKey = '', weatherKey = '', pensionKey = '', fetchImpl = fetch, cache, now = Date.now, onlineCount = async () => null, rateLimit, authenticate } = {}) {
  const memory = new Map();
  const store = cache || { get: async key => memory.get(key), set: async (key, value) => { memory.set(key, value); } };
  const inflight = new Map();
  const key = ecosKey || 'sample';
  const realEstate = createRealEstate({ key: molitKey, keys: molitKeys, fetchImpl: (...args) => fetchImpl(...args), store, now });
  const benefits = localBenefits.createLocalBenefits({ key: benefitKey, fetchImpl: (...args) => fetchImpl(...args), now });
  const lastErrors = new Map();
  const weather = createWeather({ key: weatherKey, fetchImpl: (...args) => fetchImpl(...args), now });
  const pension = createPension({ key: pensionKey, fetchImpl: (...args) => fetchImpl(...args) });

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

  async function loadPolicy() {
    if (!policyKey) return null;
    const items = await recentPolicyNews(fetchImpl, policyKey, now());
    return { updatedAt: new Date(now()).toISOString(), items, source: '대한민국 정책브리핑(www.korea.kr)' };
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
          lastErrors.delete(name);
          await store.set(`portal:${name}`, { value, freshUntil: now() + (typeof ttl === 'function' ? ttl(value) : ttl) });
          return value;
        } catch (error) {
          console.error(`Portal ${name} refresh failed:`, error.message);
          lastErrors.set(name, error.message);
          await store.set(`portal:${name}`, { value: entry?.value ?? null, freshUntil: now() + RETRY_AFTER_FAILURE });
          return entry?.value ?? null;
        } finally {
          inflight.delete(name);
        }
      })());
    }
    return inflight.get(name);
  }

  // ---------- 우리 동네 신청 혜택 ----------
  const manualKey = 'portal:benefits-manual';
  async function manualItems() {
    return (await store.get(manualKey)) || [];
  }
  async function readJson(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 16 * 1024) throw Object.assign(new Error('입력 내용이 너무 큽니다.'), { status: 413 });
      chunks.push(Buffer.from(chunk));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw Object.assign(new Error('요청 형식을 확인해 주세요.'), { status: 400 }); }
  }

  async function handleBenefits(request, send, pathname) {
    const ip = request.socket?.remoteAddress || 'unknown';
    if (rateLimit && !rateLimit(`benefits:${ip}`, 120, 60000, now())) { send(429, { error: '요청이 많습니다. 잠시 후 다시 시도해 주세요.' }); return; }
    if (pathname === '/api/portal/benefits/manual') {
      if (request.method !== 'POST') { send(405, { error: '지원하지 않는 요청 방식입니다.' }); return; }
      const auth = authenticate ? await authenticate(request, { csrf: true }) : { error: { status: 403, message: '관리자만 쓸 수 있습니다.' } };
      if (auth.error) { send(auth.error.status, { error: auth.error.message }); return; }
      if (!auth.user?.admin) { send(403, { error: '관리자만 쓸 수 있습니다.' }); return; }
      try {
        const input = await readJson(request);
        const list = await manualItems();
        if (input.remove) {
          await store.set(manualKey, list.filter(item => item.id !== input.remove));
          send(200, { ok: true });
          return;
        }
        const item = localBenefits.cleanManual(input, now());
        await store.set(manualKey, [item, ...list].slice(0, 200));
        send(200, { ok: true, item });
      } catch (error) {
        send(error.status || 400, { error: error.message });
      }
      return;
    }
    if (request.method !== 'GET') { send(405, { error: '지원하지 않는 요청 방식입니다.' }); return; }
    const params = new URL(request.url, 'http://localhost').searchParams;
    const region = localBenefits.REGIONS.find(entry => entry.id === params.get('region')) || localBenefits.REGIONS[2];
    const audience = params.get('aud') || '';
    const townOnly = params.get('town') !== '0';
    const query = String(params.get('q') || '').trim().slice(0, 40);
    const [local, province, national, manual] = await Promise.all([
      cached(`benefits-${region.id}`, BENEFITS_TTL, () => benefits.region(region.id)),
      cached('benefits-province', BENEFITS_TTL, benefits.province),
      cached('benefits-national', BENEFITS_TTL, benefits.national),
      manualItems(),
    ]);
    const tag = (items, scope) => (items || []).map(item => ({ ...item, scope }));
    const seen = new Set();
    const all = localBenefits.arrange([
      ...tag(manual.filter(item => item.regions.includes(region.id) || item.regions.includes('all')), 'manual'),
      ...tag(local, 'local'), ...tag(province, 'province'), ...tag(national, 'national'),
    ].filter(item => { if (!item.id || seen.has(item.id)) return false; seen.add(item.id); return true; }), now());
    const base = all.filter(item => !townOnly || item.townOffice);
    const counts = Object.fromEntries(localBenefits.AUDIENCES.map(({ id }) => [id, base.filter(item => item.audiences.includes(id)).length]));
    const matches = base.filter(item => (!audience || item.audiences.includes(audience)) &&
      (!query || `${item.name} ${item.summary} ${item.target}`.includes(query)));
    const connected = Boolean(benefitKey);
    const problems = [`benefits-${region.id}`, 'benefits-province', 'benefits-national'].map(name => lastErrors.get(name)).filter(Boolean);
    send(200, {
      connected, region, regions: localBenefits.REGIONS, audiences: localBenefits.AUDIENCES,
      total: base.length, all: all.length, counts, matched: matches.length, items: matches.slice(0, BENEFITS_PAGE),
      loaded: local !== null, problems: [...new Set(problems)].slice(0, 2),
      source: '행정안전부 대한민국 공공서비스(혜택) 정보(정부24 보조금24) · 공공데이터포털',
    });
  }

  // ---------- 오늘의 날씨 (기상청 단기예보) ----------
  async function handleWeather(request, send) {
    if (request.method !== 'GET') { send(405, { error: '지원하지 않는 요청 방식입니다.' }); return; }
    const ip = request.socket?.remoteAddress || 'unknown';
    if (rateLimit && !rateLimit(`weather:${ip}`, 120, 60000, now())) { send(429, { error: '요청이 많습니다. 잠시 후 다시 시도해 주세요.' }); return; }
    if (!weatherKey) { send(200, { connected: false, regions: [] }); return; }
    const regions = await Promise.all(weather.regions.map(async region => {
      const [current, forecast, extremes] = await Promise.all([
        cached(`weather-now-${region.id}`, 20 * 60 * 1000, () => weather.current(region.id)),
        cached(`weather-fcst-${region.id}`, 60 * 60 * 1000, () => weather.forecast(region.id)),
        cached(`weather-day-${region.id}`, 3 * 60 * 60 * 1000, () => weather.dayExtremes(region.id)),
      ]);
      return weather.build(region.id, current, forecast, extremes);
    }));
    const problems = [...new Set(weather.regions.flatMap(region => ['now', 'fcst', 'day'].map(kind => lastErrors.get(`weather-${kind}-${region.id}`))).filter(Boolean))].slice(0, 2);
    send(200, { connected: true, updatedAt: new Date(now()).toISOString(), regions, problems, source: '기상청 단기예보 조회서비스(공공데이터포털)' });
  }

  // ---------- 우리 동네 국민연금 (국민연금공단 수급·가입 현황) ----------
  async function handlePension(request, send, pathname) {
    if (request.method !== 'GET') { send(405, { error: '지원하지 않는 요청 방식입니다.' }); return; }
    const ip = request.socket?.remoteAddress || 'unknown';
    if (rateLimit && !rateLimit(`pension:${ip}`, 60, 60000, now())) { send(429, { error: '요청이 많습니다. 잠시 후 다시 시도해 주세요.' }); return; }
    if (!pensionKey) { send(200, { connected: false, regions: [] }); return; }
    const params = new URL(request.url, 'http://localhost').searchParams;
    if (pathname === '/api/portal/pension/raw') {
      try { send(200, await pension.raw(params)); }
      catch (error) { send(200, { error: error.message }); }
      return;
    }
    const regions = await Promise.all(pension.regions.map(region => cached(`pension-${region.id}`, 24 * 60 * 60 * 1000, () => pension.load(region.id))));
    const problems = [...new Set(pension.regions.map(region => lastErrors.get(`pension-${region.id}`)).filter(Boolean))].slice(0, 2);
    send(200, { connected: true, regions: regions.filter(Boolean), names: pension.regions.map(({ id, name }) => ({ id, name })), problems,
      source: '국민연금공단 수급현황·가입현황(공공데이터포털)' });
  }

  // ---------- 오늘의 이슈 (매일경제 헤드라인 자동 선별 + 관리자 수정) ----------
  // 이슈 날짜는 오전 6시(KST)에 바뀐다. 낮 12시까지는 1시간마다 새 헤드라인으로 다시 고르고, 그 뒤로는 그날 이슈를 고정한다.
  const ISSUE_REFRESH = 60 * 60 * 1000;
  const issueDay = timestamp => ymd(timestamp - 6 * 60 * 60 * 1000);
  const noonOf = day => Date.parse(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T12:00:00+09:00`);
  const emptyIssue = ({ id, label }) => ({ field: id, label, empty: true });
  let issueInflight = null;
  async function issueDates() { return (await store.get('issues:dates')) || []; }
  async function saveIssueDay(day, value) {
    await store.set(`issues:day:${day}`, value);
    const dates = await issueDates();
    if (!dates.includes(day)) await store.set('issues:dates', [day, ...dates].sort().reverse().slice(0, 120));
  }
  async function refreshIssues(day, stored) {
    const { feeds, problems } = await newsIssues.loadFeeds((...args) => fetchImpl(...args));
    const fresh = newsIssues.pickIssues(feeds);
    const overrides = stored?.overrides || {};
    const wasLocked = Boolean(stored?.locked);
    const items = newsIssues.FIELDS.map((field, index) => {
      if (overrides[field.id]) return overrides[field.id];
      const before = stored?.items?.find(item => item.field === field.id);
      if (wasLocked && before && !before.empty) return before;
      return fresh[index];
    });
    const value = { date: day, items, overrides, locked: now() >= noonOf(day), updatedAt: new Date(now()).toISOString(), checkedAt: now(), problems: problems.slice(0, 2) };
    await saveIssueDay(day, value);
    return value;
  }
  async function todayIssues() {
    const day = issueDay(now());
    const stored = await store.get(`issues:day:${day}`);
    const due = !stored || now() - (stored.checkedAt || 0) >= ISSUE_REFRESH && (!stored.locked || stored.items.some(item => item.empty));
    if (!due) return stored;
    if (!issueInflight) {
      issueInflight = refreshIssues(day, stored).catch(async error => {
        console.error('Issues refresh failed:', error.message);
        lastErrors.set('issues', error.message);
        if (stored) { await store.set(`issues:day:${day}`, { ...stored, checkedAt: now() - ISSUE_REFRESH + RETRY_AFTER_FAILURE }); return stored; }
        return null;
      }).finally(() => { issueInflight = null; });
    }
    return issueInflight;
  }
  async function handleIssues(request, send, pathname) {
    const ip = request.socket?.remoteAddress || 'unknown';
    if (rateLimit && !rateLimit(`issues:${ip}`, 120, 60000, now())) { send(429, { error: '요청이 많습니다. 잠시 후 다시 시도해 주세요.' }); return; }
    if (pathname === '/api/portal/issues/admin') {
      if (request.method !== 'POST') { send(405, { error: '지원하지 않는 요청 방식입니다.' }); return; }
      const auth = authenticate ? await authenticate(request, { csrf: true }) : { error: { status: 403, message: '관리자만 쓸 수 있습니다.' } };
      if (auth.error) { send(auth.error.status, { error: auth.error.message }); return; }
      if (!auth.user?.admin) { send(403, { error: '관리자만 쓸 수 있습니다.' }); return; }
      try {
        const input = await readJson(request);
        const day = issueDay(now());
        const field = newsIssues.FIELDS.find(entry => entry.id === input.field);
        if (!field) throw Object.assign(new Error('분야를 골라 주세요.'), { status: 400 });
        const stored = (await todayIssues()) || { date: day, items: newsIssues.FIELDS.map(emptyIssue), overrides: {}, locked: false, checkedAt: 0 };
        const overrides = { ...(stored.overrides || {}) };
        let item;
        if (input.action === 'set') item = overrides[field.id] = newsIssues.cleanManual(input);
        else if (input.action === 'hide') item = overrides[field.id] = { ...emptyIssue(field), empty: false, hidden: true };
        else if (input.action === 'auto') { delete overrides[field.id]; item = emptyIssue(field); }
        else throw Object.assign(new Error('처리 방법을 확인해 주세요.'), { status: 400 });
        const items = stored.items.map(entry => (entry.field === field.id ? item : entry));
        // '자동으로 되돌리기'는 비운 자리를 바로 다시 고르도록 확인 시각을 지운다.
        await saveIssueDay(day, { ...stored, date: day, items, overrides, checkedAt: input.action === 'auto' ? 0 : stored.checkedAt });
        send(200, { ok: true, item });
      } catch (error) {
        send(error.status || 400, { error: error.message });
      }
      return;
    }
    if (request.method !== 'GET') { send(405, { error: '지원하지 않는 요청 방식입니다.' }); return; }
    const today = issueDay(now());
    const asked = new URL(request.url, 'http://localhost').searchParams.get('date');
    const date = /^\d{8}$/.test(asked || '') ? asked : today;
    let day = date === today ? await todayIssues() : await store.get(`issues:day:${date}`);
    let fallback = false;
    if (!day && date === today) {
      // 오늘 자료를 아직 못 받았으면 가장 최근 날의 이슈를 대신 보여 준다.
      const previous = (await issueDates()).find(entry => entry < today);
      if (previous) { day = await store.get(`issues:day:${previous}`); fallback = Boolean(day); }
    }
    const items = (day?.items || newsIssues.FIELDS.map(emptyIssue)).map(({ field, label, id, title, link, at, source, headline, auto, manual, empty, hidden }) =>
      ({ field, label, id, title, link, at, source, headline, auto, manual, empty, hidden }));
    send(200, {
      today, date: day?.date || date, fallback, locked: Boolean(day?.locked), updatedAt: day?.updatedAt || null,
      items, dates: (await issueDates()).slice(0, 60), problems: [lastErrors.get('issues'), ...(day?.problems || [])].filter(Boolean).slice(0, 2),
      fields: newsIssues.FIELDS, source: '매일경제 헤드라인·분야별 RSS',
    });
  }

  async function handlePortalApi(request, response, pathname) {
    const send = (status, body) => {
      const payload = JSON.stringify(body);
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(payload);
    };
    if (pathname === '/api/portal/benefits' || pathname === '/api/portal/benefits/manual') { await handleBenefits(request, send, pathname); return; }
    if (pathname === '/api/portal/weather') { await handleWeather(request, send); return; }
    if (pathname === '/api/portal/issues' || pathname === '/api/portal/issues/admin') { await handleIssues(request, send, pathname); return; }
    if (pathname === '/api/portal/pension' || pathname === '/api/portal/pension/raw') { await handlePension(request, send, pathname); return; }
    if (pathname !== '/api/portal') { send(404, { error: '요청한 기능이 없습니다.' }); return; }
    if (request.method !== 'GET') { send(405, { error: '지원하지 않는 요청 방식입니다.' }); return; }
    const ip = request.socket?.remoteAddress || 'unknown';
    if (rateLimit && !rateLimit(`portal:${ip}`, 120, 60000, now())) { send(429, { error: '요청이 많습니다. 잠시 후 다시 시도해 주세요.' }); return; }
    const [indicators, housing, realestate, policy, online] = await Promise.all([
      cached('indicators', INDICATOR_TTL, loadIndicators),
      cached('housing', housingTtl(), loadHousing),
      cached('realestate', value => (value?.complete ? REALESTATE_TTL : REALESTATE_FILL_TTL), realEstate.load),
      cached('policy-v2', POLICY_TTL, loadPolicy),
      onlineCount().catch(() => null),
    ]);
    send(200, { indicators, housing, realestate, policy, online });
  }

  return handlePortalApi;
}

module.exports = { createPortalApi, nextReleaseOf };
