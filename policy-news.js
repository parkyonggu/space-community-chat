// 이번 주 정부 정책: 대한민국 정책브리핑 '정책뉴스' API(문화체육관광부, 공공데이터포털 15095335)에서
// 경제·금융·부동산 관련 부처의 지난 한 주 정책뉴스를 모아 뉴스레터 초안에 넣는다.
// 기사별 공공누리 유형을 확인해 출처표시만 요구하는 제1유형만 쓰고, 본문은 옮기지 않고 제목·부제목과 원문 링크만 싣는다.

const DAY = 24 * 60 * 60 * 1000;
const kst = timestamp => new Date(timestamp + 9 * 60 * 60 * 1000);
const ymd = timestamp => kst(timestamp).toISOString().slice(0, 10).replace(/-/g, '');

// 경제·금융·부동산·산업 관련 부처(이름 일부로 찾는다). 조직 개편으로 이름이 바뀌어도 걸리도록 핵심 낱말만 쓴다.
const ECONOMY_DEPARTMENTS = /금융위원회|금융감독|재정경제|기획재정|기획예산|국토교통|산업통상|중소벤처|고용노동|공정거래|국세청|관세청|통계청|조달청|국무조정실|한국은행/;
const ECONOMY_WORDS = /금융|펀드|금리|대출|투자|경제|성장|물가|부동산|주택|전세|청약|세제|세법|예산|재정|수출|산업|기업|일자리|고용|소상공인|자영업|민생|채무|연금|보험|가계|관세|무역|반도체|AI|인공지능/;

const ENTITIES = { lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', ndash: '–', mdash: '—', sim: '∼', times: '×', amp: '&' };
const entities = text => text
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
  .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);

function decode(text) {
  // 정책브리핑 자료는 기호가 두 번 감싸여(&amp;middot;) 오는 경우가 있어 두 번 푼다.
  const once = entities(String(text || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
  return entities(once.replace(/<[^>]+>/g, ' ')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseNews(text) {
  const body = String(text || '').trim();
  const auth = body.match(/<returnAuthMsg>([^<]*)<\/returnAuthMsg>/);
  if (auth) throw new Error(decode(auth[1]));
  const code = body.match(/<resultCode>([^<]*)<\/resultCode>/);
  if (code && !/^0+$/.test(code[1].trim())) {
    const message = body.match(/<resultMsg>([^<]*)<\/resultMsg>/);
    throw new Error(`${message ? decode(message[1]) : '오류'} (${code[1].trim()})`);
  }
  return [...body.matchAll(/<NewsItem>([\s\S]*?)<\/NewsItem>/g)].map(match => {
    const item = {};
    for (const field of match[1].matchAll(/<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g)) item[field[1]] = decode(field[2]);
    return item;
  });
}

// 언론 보도에 대한 정부 설명('사실은 이렇습니다')은 일반 정책뉴스와 따로 보여 준다.
const FACT_PREFIX = /^\s*\[사실은 이렇습니다\]\s*/;
const isFact = item => FACT_PREFIX.test(item.Title || '') || /fact/i.test(item.GroupingCode || '');

// 'MM/DD/YYYY HH:mm:ss' → timestamp
function approvedAt(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(String(value || ''));
  if (!match) return 0;
  return Date.parse(`${match[3]}-${match[1]}-${match[2]}T${String(match[4] || '0').padStart(2, '0')}:${match[5] || '00'}:00+09:00`);
}

// 공공누리 제1유형(출처표시)만 허용. 값이 '1', '제1유형', 'KOGL1' 등 어떤 모양이어도 1이고 2~4가 섞이지 않아야 한다.
const isTypeOne = value => /1/.test(String(value || '')) && !/[234]/.test(String(value || ''));

async function weeklyPolicyNews(fetchImpl, key, now, { limit = 8 } = {}) {
  if (!key) return null;
  const serviceKey = key.includes('%') ? key : encodeURIComponent(key);
  // 한 번에 조회할 수 있는 기간이 짧아 3일씩 나눠 지난 7일을 받는다.
  const windows = [[now - 7 * DAY, now - 5 * DAY], [now - 4 * DAY, now - 2 * DAY], [now - DAY, now]];
  const items = [];
  const problems = [];
  for (const [start, end] of windows) {
    const url = `https://apis.data.go.kr/1371000/policyNewsService2/policyNewsList2?serviceKey=${serviceKey}&startDate=${ymd(start)}&endDate=${ymd(end)}`;
    try {
      const response = await fetchImpl(url, { headers: { Accept: 'application/xml' } });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status} ${decode(text).slice(0, 80)}`);
      items.push(...parseNews(text));
    } catch (error) {
      problems.push(error.message);
    }
  }
  if (!items.length && problems.length) throw new Error(problems[0]);
  const seen = new Set();
  const picked = items
    .filter(item => item.Title && item.OriginalUrl && isTypeOne(item.KoglType) && !isFact(item))
    .filter(item => ECONOMY_DEPARTMENTS.test(item.MinisterCode || '') || ECONOMY_WORDS.test(`${item.Title} ${item.SubTitle1 || ''}`))
    .filter(item => { const id = item.NewsItemId || item.OriginalUrl; if (seen.has(id)) return false; seen.add(id); return true; })
    .map(item => ({ ...item, at: approvedAt(item.ApproveDate) }))
    .sort((a, b) => (ECONOMY_DEPARTMENTS.test(b.MinisterCode || '') - ECONOMY_DEPARTMENTS.test(a.MinisterCode || '')) || b.at - a.at)
    .slice(0, limit);
  const lines = picked.map(item => {
    const date = item.at ? `${kst(item.at).getUTCMonth() + 1}/${kst(item.at).getUTCDate()}` : '';
    const sub = item.SubTitle1 ? ` — ${item.SubTitle1.slice(0, 120)}` : '';
    const url = /^https?:\/\//.test(item.OriginalUrl) ? item.OriginalUrl : `https://www.korea.kr${item.OriginalUrl}`;
    return `- **[${item.MinisterCode || '정부'}] ${item.Title}**${date ? ` (${date})` : ''}${sub} [원문 보기](${url})`;
  });
  return { lines, count: picked.length, problems };
}

// 첫 화면 '오늘의 정책브리핑': 최근 이틀 동안의 정책뉴스(제1유형) 전체를 최신순으로. 경제 관련 표시를 붙인다.
async function recentPolicyNews(fetchImpl, key, now, { limit = 40 } = {}) {
  if (!key) return null;
  const serviceKey = key.includes('%') ? key : encodeURIComponent(key);
  const url = `https://apis.data.go.kr/1371000/policyNewsService2/policyNewsList2?serviceKey=${serviceKey}&startDate=${ymd(now - DAY)}&endDate=${ymd(now)}`;
  const response = await fetchImpl(url, { headers: { Accept: 'application/xml' } });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${decode(text).slice(0, 80)}`);
  const seen = new Set();
  return parseNews(text)
    .filter(item => item.Title && item.OriginalUrl && isTypeOne(item.KoglType))
    .filter(item => { const id = item.NewsItemId || item.OriginalUrl; if (seen.has(id)) return false; seen.add(id); return true; })
    .map(item => ({
      id: item.NewsItemId || item.OriginalUrl,
      title: item.Title.replace(FACT_PREFIX, ''),
      kind: isFact(item) ? 'fact' : 'news',
      sub: (item.SubTitle1 || '').slice(0, 140),
      dept: item.MinisterCode || '정부',
      at: approvedAt(item.ApproveDate) || null,
      url: /^https?:\/\//.test(item.OriginalUrl) ? item.OriginalUrl : `https://www.korea.kr${item.OriginalUrl}`,
      economy: !isFact(item) && (ECONOMY_DEPARTMENTS.test(item.MinisterCode || '') || ECONOMY_WORDS.test(`${item.Title} ${item.SubTitle1 || ''}`)),
    }))
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, limit);
}

// 스페이스 톡 '📰 오늘의 정책브리핑' 채널에 매일 올리는 글: 그날 정책뉴스 가운데 기사가 가장 많이 나온
// 테마(분야) 하나를 골라, 그 테마의 소식을 부제목과 함께 묶어 보여 준다. 나머지 분야는 건수만 알려 준다.
const THEMES = [
  { id: 'economy', name: '💰 경제·금융', depts: /기획재정|재정경제|기획예산|금융위원회|금융감독|공정거래|국세청|관세청|통계청|조달청|한국은행/, words: /금융|금리|대출|펀드|투자|물가|세제|세법|예산|재정|가계|채무|소상공인|자영업|민생|관세|무역|수출|경제|성장/ },
  { id: 'housing', name: '🏠 부동산·주거', depts: /국토교통/, words: /부동산|주택|전세|월세|청약|임대|공공주택|재건축|재개발|분양|집값|주거/ },
  { id: 'jobs', name: '💼 일자리·노동', depts: /고용노동/, words: /일자리|고용|취업|노동|근로|임금|산재|채용|직업훈련|노사/ },
  { id: 'welfare', name: '🤝 복지·건강', depts: /보건복지|질병관리|식품의약|성평등|여성가족/, words: /복지|연금|돌봄|건강|의료|병원|노인|어르신|장애|아동|출산|육아|기초생활|감염|백신|식품/ },
  { id: 'education', name: '🎓 교육·청년', depts: /교육부/, words: /교육|학교|학생|대학|입시|교사|청년|장학/ },
  { id: 'industry', name: '🏭 산업·과학·디지털', depts: /산업통상|중소벤처|과학기술|우주항공|특허|개인정보/, words: /산업|기업|반도체|AI|인공지능|디지털|과학|기술|에너지|전력|원전|스타트업|중소기업|우주|데이터/ },
  { id: 'region', name: '🌾 농어촌·지역', depts: /농림축산|해양수산|산림|농촌진흥|새만금/, words: /농업|농촌|농민|어업|어촌|수산|산림|귀농|지역|지방|균형발전|직불/ },
  { id: 'safety', name: '🛡️ 안전·환경', depts: /행정안전|소방|경찰|해양경찰|환경|기후|기상/, words: /안전|재난|사고|화재|홍수|태풍|폭염|환경|기후|탄소|미세먼지|범죄|경찰/ },
  { id: 'security', name: '🕊️ 외교·안보·통일', depts: /외교|국방|통일|병무|방위사업|국가보훈/, words: /외교|정상회담|국방|안보|북한|통일|군|병역|보훈|한미|동맹/ },
  { id: 'culture', name: '🎨 문화·관광·체육', depts: /문화체육|관광|문화재|국가유산/, words: /문화|관광|체육|스포츠|예술|축제|콘텐츠|한류|국가유산/ },
];
function themeOf(item) {
  const text = `${item.title} ${item.sub || ''}`;
  // 부처가 맞으면 그 테마, 아니면 제목·부제목 낱말이 가장 많이 걸리는 테마.
  const byDept = THEMES.find(theme => theme.depts.test(item.dept || ''));
  const scored = THEMES.map(theme => ({ theme, hits: (text.match(new RegExp(theme.words.source, 'g')) || []).length }))
    .sort((left, right) => right.hits - left.hits);
  if (scored[0].hits >= 2 && (!byDept || scored[0].theme !== byDept && scored[0].hits >= 3)) return scored[0].theme;
  return byDept || (scored[0].hits ? scored[0].theme : null);
}
function pickDailyTheme(items, now = Date.now(), { previous = '' } = {}) {
  const today = items.filter(item => item.kind !== 'fact' && (!item.at || now - item.at < 24 * 60 * 60 * 1000));
  const groups = new Map();
  for (const item of today) {
    const theme = themeOf(item);
    if (!theme) continue;
    if (!groups.has(theme.id)) groups.set(theme.id, { theme, items: [] });
    groups.get(theme.id).items.push(item);
  }
  // 기사 수가 가장 많은 테마. 같으면 경제 관련 소식이 많은 쪽, 그다음 최근 소식이 있는 쪽.
  // 어제와 같은 테마는 기사 수가 확실히 많을 때(1.5배 이상)만 다시 고른다.
  const ranked = [...groups.values()].map(group => ({ ...group,
    value: group.items.length * (group.theme.id === previous ? 2 / 3 : 1) + group.items.filter(item => item.economy).length * 0.1 }))
    .sort((left, right) => right.value - left.value || Math.max(...right.items.map(item => item.at || 0)) - Math.max(...left.items.map(item => item.at || 0)));
  if (!ranked.length) return null;
  const chosen = ranked[0];
  chosen.items.sort((left, right) => (right.at || 0) - (left.at || 0));
  return { theme: chosen.theme, items: chosen.items, others: ranked.slice(1).map(group => ({ name: group.theme.name, count: group.items.length })),
    total: today.length };
}
function dailyBriefingText(items, now = Date.now(), siteUrl = 'https://withpluces.com', options = {}) {
  const kst = new Date(now + 9 * 60 * 60 * 1000);
  const day = `${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일`;
  const pick = pickDailyTheme(items, now, options);
  if (!pick) return null;
  const facts = items.filter(item => item.kind === 'fact' && (!item.at || now - item.at < 24 * 60 * 60 * 1000)).length;
  const shown = pick.items.slice(0, 4);
  const text = [
    `📰 ${day} 오늘의 정책 테마 — ${pick.theme.name}`,
    `오늘 정부 정책뉴스 ${pick.total}건 가운데 '${pick.theme.name.replace(/^\S+\s/, '')}' 소식이 ${pick.items.length}건으로 가장 많았어요.`,
    '',
    ...shown.flatMap((item, index) => [`${index + 1}. [${item.dept}] ${item.title}`, ...(item.sub ? [`   ${item.sub.slice(0, 110)}`] : []), item.url, '']),
    pick.items.length > shown.length ? `이 테마의 소식 ${pick.items.length - shown.length}건이 더 있어요.` : '',
    pick.others.length ? `다른 분야: ${pick.others.slice(0, 4).map(other => `${other.name.replace(/^\S+\s/, '')} ${other.count}건`).join(' · ')}` : '',
    facts ? `보도 설명 자료('사실은 이렇습니다') ${facts}건도 홈페이지에서 볼 수 있어요.` : '',
    `전체 보기: ${siteUrl}/#policy-panel`,
    '출처: 대한민국 정책브리핑(www.korea.kr), 공공누리 제1유형',
  ].filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n').trim();
  return text.length > 1900 ? `${text.slice(0, 1890)}…` : text;
}
module.exports = { weeklyPolicyNews, recentPolicyNews, dailyBriefingText, pickDailyTheme, THEMES, parseNews, isTypeOne };
