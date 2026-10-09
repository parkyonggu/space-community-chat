// 오늘의 이슈: 매일경제 RSS(헤드라인·분야별)에서 정치·경제·국방·국제·사회·문화 각 1건을 자동으로 고른다.
// 매일경제는 "무단 전재·재배포 금지"이므로 기사 본문·요약·사진은 옮기지 않고 제목과 원문 링크, 시각만 보여 준다.
// 헤드라인 RSS의 순서(신문사 편집 순서)를 중요도로 보고, 분야마다 헤드라인에 오른 첫 기사를 고른다.
// 헤드라인에 그 분야 기사가 없으면 분야별 RSS의 맨 위 기사를 쓴다. 국방은 따로 된 RSS가 없어 정치·국제 기사에서 낱말로 찾는다.

const RSS = 'https://www.mk.co.kr/rss';
const FEEDS = { headline: '30000001', politics: '30200030', economy: '30100041', society: '50400012', world: '30300018', culture: '30000023' };
const FIELDS = [
  { id: 'politics', label: '정치' },
  { id: 'economy', label: '경제' },
  { id: 'defense', label: '국방' },
  { id: 'world', label: '국제' },
  { id: 'society', label: '사회' },
  { id: 'culture', label: '문화' },
];
// 링크 주소의 분야 이름(www.mk.co.kr/news/<분야>/번호)으로도 가려낸다.
const PATHS = {
  politics: /^(politics)$/, economy: /^(economy|business|stock|realestate|it)$/, society: /^(society)$/,
  world: /^(world|international)$/, culture: /^(culture|entertain|culture-entertainment)$/,
};
const DEFENSE = /국방|군사|합참|합동참모|북한|北|미사일|핵무기|핵실험|핵잠|안보|방산|방위비|방위산업|자위대|전쟁|휴전|교전|공습|나토|NATO|병력|장병|징병|해군|공군|육군|해병|전투기|잠수함|구축함|호위함|항모|항공모함|무기 지원|무기 수출|살상무기|드론 공격|주한미군|한미동맹|연합훈련|군 당국|군당국|사드|국방부|안보실/;
// '관세 전쟁', '가격 전쟁'처럼 비유로 쓴 말은 국방으로 보지 않는다.
const NOT_DEFENSE = /(관세|무역|가격|환율|금리|반도체|AI|인재|입시|유통|배달|쩐의|요금|전력|치킨|구독|플랫폼|스트리밍|OTT)\s?전쟁|안보이/;
// 날마다 반복되는 꼭지·운세·부고 등은 '이슈'로 고르지 않는다.
const SKIP = /매-세-지|운세|부고|\[인사\]|\[포토\]|\[사진\]|오늘의 날씨|날씨\]|\[게시판\]|\[알림\]|퀴즈|\[광고\]|\[신간\]|\[모닝브리핑\]|헤드라인 모음/;

const ENTITIES = { lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', amp: '&' };
const decode = text => String(text || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
  .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match)
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function parseRss(xml) {
  return [...String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)].map(match => {
    const field = name => {
      const found = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(match[1]);
      return found ? decode(found[1]) : '';
    };
    const link = field('link');
    if (!/^https:\/\/(www\.)?mk\.co\.kr\//.test(link)) return null;
    const no = field('no') || (/\/(\d+)(?:[/?#]|$)/.exec(link) || [])[1] || '';
    const at = Date.parse(field('pubDate'));
    return { no, title: field('title'), link, at: Number.isFinite(at) ? new Date(at).toISOString() : null, path: (/mk\.co\.kr\/news\/([a-z-]+)\//.exec(link) || [])[1] || '' };
  }).filter(item => item && item.no && item.title && !SKIP.test(item.title));
}

// feeds: { headline: [...], politics: [...], ... } → 분야별 1건
function pickIssues(feeds) {
  const headline = feeds.headline || [];
  const sectionOf = new Map();
  for (const field of ['politics', 'economy', 'society', 'world', 'culture']) {
    for (const item of feeds[field] || []) if (!sectionOf.has(item.no)) sectionOf.set(item.no, field);
  }
  const fieldOf = item => sectionOf.get(item.no) || Object.keys(PATHS).find(field => PATHS[field].test(item.path)) || '';
  const used = new Set();
  const take = (list, test) => {
    const found = list.find(item => !used.has(item.no) && test(item));
    if (found) used.add(found.no);
    return found || null;
  };
  const picks = {};
  // 국방을 먼저 고른다: 국방 기사는 정치·국제 기사이기도 해서, 뒤에 고르면 그쪽에 먼저 쓰여 버린다.
  const defenseTest = item => DEFENSE.test(item.title) && !NOT_DEFENSE.test(item.title);
  picks.defense = take(headline, defenseTest) || take([...(feeds.politics || []), ...(feeds.world || [])].sort((a, b) => String(b.at).localeCompare(String(a.at))), defenseTest);
  for (const { id } of FIELDS) {
    if (id === 'defense') continue;
    picks[id] = take(headline, item => fieldOf(item) === id) || take(feeds[id] || [], () => true);
  }
  return FIELDS.map(({ id, label }) => {
    const item = picks[id];
    if (!item) return { field: id, label, empty: true };
    return { field: id, label, id: `mk-${item.no}`, title: item.title, link: item.link, at: item.at, source: '매일경제', headline: headline.some(entry => entry.no === item.no), auto: true };
  });
}

async function fetchFeed(fetchImpl, code) {
  const response = await fetchImpl(`${RSS}/${code}/`, { headers: { Accept: 'application/rss+xml, application/xml, text/xml' } });
  if (!response.ok) throw new Error(`매일경제 RSS HTTP ${response.status}`);
  return parseRss(await response.text());
}

async function loadFeeds(fetchImpl) {
  const entries = await Promise.all(Object.entries(FEEDS).map(async ([name, code]) => {
    try { return [name, await fetchFeed(fetchImpl, code)]; } catch (error) { return [name, null, error.message]; }
  }));
  const feeds = {};
  const problems = [];
  for (const [name, items, problem] of entries) {
    feeds[name] = items || [];
    if (problem) problems.push(problem);
  }
  if (!Object.values(feeds).some(list => list.length)) throw new Error(problems[0] || '매일경제 RSS 자료 없음');
  return { feeds, problems };
}

// 관리자가 고친 이슈: 제목 1~200자, 링크는 https 주소만.
function cleanManual(input) {
  const field = FIELDS.find(entry => entry.id === input.field);
  if (!field) throw Object.assign(new Error('분야를 골라 주세요.'), { status: 400 });
  const title = String(input.title || '').replace(/\s+/g, ' ').trim();
  const link = String(input.link || '').trim();
  if (!title || title.length > 200) throw Object.assign(new Error('제목을 1~200자로 입력해 주세요.'), { status: 400 });
  let url;
  try { url = new URL(link); } catch { url = null; }
  if (!url || url.protocol !== 'https:' || link.length > 500) throw Object.assign(new Error('기사 주소(https://로 시작)를 입력해 주세요.'), { status: 400 });
  const host = url.hostname.replace(/^www\./, '');
  const no = (/(\d{5,})/.exec(url.pathname) || [])[1];
  const id = host.endsWith('mk.co.kr') && no ? `mk-${no}` : `m-${[...link].reduce((hash, char) => (hash * 31 + char.codePointAt(0)) >>> 0, 7).toString(36)}`;
  return { field: field.id, label: field.label, id, title, link: url.href, at: null, source: String(input.source || '').trim().slice(0, 30) || host, manual: true };
}

module.exports = { FIELDS, FEEDS, parseRss, pickIssues, loadFeeds, cleanManual, DEFENSE };
