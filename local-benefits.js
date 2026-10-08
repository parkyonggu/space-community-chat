// "우리 동네 신청 혜택": 행정안전부 「대한민국 공공서비스(혜택) 정보」(공공데이터포털 15113968, 정부24 보조금24 자료)에서
// 양산시·김해시·의령군과 경상남도가 운영하는 혜택, 그리고 읍·면·동에서 신청받는 중앙부처 농림축산어업 혜택을 골라
// 신청 기한·접수기관과 함께 보여 준다. 시·군 고시·공고로만 알리는 사업(예: 다음 해 산림사업 신청)은 이 자료에 없을 수 있어
// 관리자가 직접 추가한 안내(manual)를 함께 싣는다.

const DAY = 24 * 60 * 60 * 1000;
const kst = timestamp => new Date(timestamp + 9 * 60 * 60 * 1000);
const ymdNumber = timestamp => Number(kst(timestamp).toISOString().slice(0, 10).replace(/-/g, ''));

const REGIONS = [
  { id: 'yangsan', name: '양산시' },
  { id: 'gimhae', name: '김해시' },
  { id: 'uiryeong', name: '의령군' },
];
const PROVINCE = '경상남도';
const BASE = 'https://api.odcloud.kr/api/gov24/v3/serviceList';
const PER_PAGE = 1000;
const MAX_PAGES = 12; // 필터가 무시되는 최악의 경우에도 하위 요청 수를 한 번에 36개 안쪽으로

// 대상 분류(서비스명·지원대상·서비스분야 낱말로 찾는다). 한 혜택이 여러 대상에 걸칠 수 있다.
const AUDIENCES = [
  ['farm', '농업인', /농업|농가|농업인|영농|농지|직불|농작물|축산|가축|농기계|귀농|과수|원예|친환경농|벼|논|밭|양봉|비료|농약/],
  ['forest', '임업·산주', /산림|임업|임산|조림|숲가꾸기|산주|임야|산림소득|임도|버섯|밤나무|표고|산양삼|목재/],
  ['fish', '어업인', /어업|어업인|어선|수산|양식|어가|어촌/],
  ['senior', '어르신', /노인|어르신|65세|고령|경로|치매|장기요양|기초연금/],
  ['youth', '청년', /청년|대학생|19세|39세|34세/],
  ['family', '출산·아동', /출산|임신|임산부|신생아|영유아|아동|양육|보육|다자녀|육아/],
  ['disabled', '장애인', /장애/],
  ['business', '소상공인', /소상공인|자영업|창업|중소기업|전통시장|사업자/],
  ['housing', '주거', /주거|주택|전세|월세|임대|집수리|빈집|슬레이트/],
];
// 읍·면사무소나 동 행정복지센터에 직접 신청하는 혜택인지.
const TOWN_OFFICE = /읍\s*[·.,ㆍ/]?\s*면|읍면|면사무소|읍사무소|동\s*행정복지센터|행정복지센터|주민센터|읍면동|읍·면·동|동사무소|마을\s*이장|이장/;
const ALWAYS = /상시|수시|연중|기한\s*없|별도\s*기한\s*없/;

const clip = (text, length) => {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
};

// 신청기한 글에서 마감일(가장 늦은 날짜)을 찾는다. 연도가 없으면 기준 시점에 가까운 해로 본다.
function parseDeadline(text, now = Date.now()) {
  const value = String(text || '');
  const today = ymdNumber(now);
  const year = Number(String(today).slice(0, 4));
  const dates = [];
  for (const match of value.matchAll(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/g)) {
    dates.push(Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]));
  }
  if (!dates.length) {
    for (const match of value.matchAll(/(?:^|[^\d.])(\d{1,2})\s*[.월]\s*(\d{1,2})\s*일?/g)) {
      const month = Number(match[1]);
      const day = Number(match[2]);
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      let date = year * 10000 + month * 100 + day;
      if (date < today - 300) date += 10000; // 몇 달 지난 날짜면 내년으로 본다
      dates.push(date);
    }
  }
  const valid = dates.filter(date => date % 100 >= 1 && date % 100 <= 31 && Math.floor(date / 100) % 100 >= 1 && Math.floor(date / 100) % 100 <= 12);
  return {
    due: valid.length ? Math.max(...valid) : null,
    start: valid.length > 1 ? Math.min(...valid) : null,
    always: !valid.length && ALWAYS.test(value),
  };
}

function audiencesOf(item) {
  // 서비스분야 '농림축산어업'은 농업 분야 이름이라 '어업'으로 잘못 걸리지 않게 바꿔 둔다.
  const text = `${item.서비스명 || ''} ${item.지원대상 || ''} ${item.서비스분야 || ''} ${item.서비스목적요약 || ''}`.replace(/농림축산어업/g, '농림축산');
  return AUDIENCES.filter(([, , pattern]) => pattern.test(text)).map(([id]) => id);
}

function compact(item, now) {
  const deadline = parseDeadline(item.신청기한, now);
  const reception = `${item.접수기관 || ''} ${item.신청방법 || ''}`;
  return {
    id: String(item.서비스ID || ''),
    name: clip(item.서비스명, 80),
    summary: clip(item.서비스목적요약 || item.지원내용, 140),
    target: clip(item.지원대상, 160),
    support: clip(item.지원내용, 160),
    deadlineText: clip(item.신청기한, 80),
    method: clip(item.신청방법, 100),
    reception: clip(item.접수기관, 60),
    agency: clip(item.소관기관명, 40),
    dept: clip(item.부서명, 40),
    phone: clip(item.전화문의, 60),
    field: clip(item.서비스분야, 20),
    url: /^https?:\/\//.test(String(item.상세조회URL || '')) ? String(item.상세조회URL) : '',
    updated: String(item.수정일시 || item.등록일시 || '').slice(0, 10),
    audiences: audiencesOf(item),
    townOffice: TOWN_OFFICE.test(reception),
    due: deadline.due, start: deadline.start, always: deadline.always,
  };
}

function errorText(status, text) {
  try {
    const data = JSON.parse(text);
    return `HTTP ${status} ${data.msg || data.message || data.code || ''}`.trim();
  } catch {
    return `HTTP ${status} ${String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)}`;
  }
}

// cond 필터로 좁혀 받는다. 혹시 필터가 무시돼도 keep()으로 한 번 더 거른다.
async function fetchFiltered(fetchImpl, key, cond, keep) {
  const serviceKey = key.includes('%') ? key : encodeURIComponent(key);
  const items = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const query = Object.entries(cond).map(([field, value]) => `&${encodeURIComponent(`cond[${field}]`)}=${encodeURIComponent(value)}`).join('');
    const url = `${BASE}?page=${page}&perPage=${PER_PAGE}&returnType=JSON&serviceKey=${serviceKey}${query}`;
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    const text = await response.text();
    if (!response.ok) throw new Error(errorText(response.status, text));
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`알 수 없는 응답: ${text.slice(0, 80)}`); }
    if (!Array.isArray(data.data)) throw new Error(`알 수 없는 응답: ${text.slice(0, 80)}`);
    items.push(...data.data.filter(keep));
    const total = Number(data.matchCount ?? data.totalCount ?? 0);
    if (!data.data.length || page * PER_PAGE >= total) break;
  }
  return items;
}

const isProvinceOnly = name => String(name || '').replace(/\s+/g, '') === PROVINCE;
const isCentral = item => !/지방|광역|기초|지자체|시·군·구|시군구|시·도/.test(String(item.소관기관유형 || '')) && !/[시군구도]$/.test(String(item.소관기관명 || '').trim());

// 오늘 기준으로 보여 줄 순서: 마감 임박(오늘~) → 상시 → 날짜 없음 → 마감 지남(제외).
function arrange(items, now) {
  const today = ymdNumber(now);
  return items
    .filter(item => !item.due || item.due >= today)
    .sort((a, b) => {
      const rank = item => (item.due ? 0 : item.always ? 1 : 2);
      return rank(a) - rank(b) || (a.due || 0) - (b.due || 0) || Number(b.townOffice) - Number(a.townOffice) || b.updated.localeCompare(a.updated);
    });
}

function createLocalBenefits({ key = '', fetchImpl = fetch, now = Date.now } = {}) {
  async function region(regionId) {
    const spec = REGIONS.find(entry => entry.id === regionId);
    if (!spec || !key) return null;
    const items = await fetchFiltered(fetchImpl, key, { '소관기관명::LIKE': spec.name }, item => String(item.소관기관명 || '').includes(spec.name));
    return items.map(item => compact(item, now()));
  }
  async function province() {
    if (!key) return null;
    const items = await fetchFiltered(fetchImpl, key, { '소관기관명::EQ': PROVINCE }, item => isProvinceOnly(item.소관기관명));
    return items.map(item => compact(item, now()));
  }
  // 중앙부처 농림축산어업 혜택 중 읍·면·동에서 접수하는 것.
  async function national() {
    if (!key) return null;
    const items = await fetchFiltered(fetchImpl, key, { '서비스분야::LIKE': '농림축산어업' },
      item => String(item.서비스분야 || '').includes('농림') && isCentral(item));
    return items.map(item => compact(item, now())).filter(item => item.townOffice);
  }
  return { region, province, national };
}

// 관리자가 직접 넣는 안내(고시·공고 등)를 검사·정리한다.
function cleanManual(input, now = Date.now()) {
  const name = clip(input?.name, 80);
  if (!name) throw new Error('제목을 입력해 주세요.');
  const regions = (Array.isArray(input.regions) ? input.regions : [input.region]).filter(id => REGIONS.some(entry => entry.id === id) || id === 'all');
  if (!regions.length) throw new Error('지역을 골라 주세요.');
  const url = String(input.url || '').trim();
  if (url && !/^https:\/\/[^\s]+$/.test(url)) throw new Error('링크는 https:// 로 시작해야 합니다.');
  const deadline = parseDeadline(input.deadlineText, now);
  const audiences = (Array.isArray(input.audiences) ? input.audiences : []).filter(id => AUDIENCES.some(([value]) => value === id));
  return {
    id: `m-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    manual: true, name, regions,
    summary: clip(input.summary, 200), target: clip(input.target, 160), support: '',
    deadlineText: clip(input.deadlineText, 80), method: clip(input.method, 100),
    reception: clip(input.reception || '읍·면·동 행정복지센터', 60), agency: clip(input.agency, 40), dept: '', phone: clip(input.phone, 60),
    field: '', url, updated: new Date(now).toISOString().slice(0, 10),
    audiences: audiences.length ? audiences : AUDIENCES.filter(([, , pattern]) => pattern.test(`${name} ${input.target || ''}`)).map(([id]) => id),
    townOffice: true, due: deadline.due, start: deadline.start, always: deadline.always,
  };
}

module.exports = {
  createLocalBenefits, parseDeadline, compact, arrange, cleanManual,
  REGIONS, AUDIENCES: AUDIENCES.map(([id, label]) => ({ id, label })),
};
