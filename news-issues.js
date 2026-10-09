// 오늘의 이슈: 매일경제 RSS(헤드라인·전체·분야별)에서 정치·경제·국방·국제·사회·문화 각 1건을 자동으로 고른다.
// 매일경제는 "무단 전재·재배포 금지"이므로 기사 본문·요약·사진은 옮기지 않고 제목과 원문 링크, 시각만 보여 준다.
// 매일경제 헤드라인 RSS는 편집 순서가 아니라 최신순이라(주말 아침엔 가벼운 기사가 많다), '가장 큰 이슈'를
// '최근 하루 동안 가장 많이 보도된 주제'로 본다: 제목에 함께 나오는 낱말이 여러 기사에 겹칠수록 점수가 높다.
// [속보]·[단독]은 더하고, '…이유?', '누구길래', 연예 근황 같은 가벼운 기사는 뺀다. 국방은 따로 된 RSS가 없어 낱말로 찾는다.

const RSS = 'https://www.mk.co.kr/rss';
const FEEDS = { headline: '30000001', all: '40300001', politics: '30200030', economy: '30100041', society: '50400012', world: '30300018', culture: '30000023' };
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
const NOT_DEFENSE = /(관세|무역|가격|환율|금리|반도체|AI|인재|입시|유통|배달|쩐의|요금|전력|치킨|구독|플랫폼|스트리밍|OTT|패권|보조금|수주|인력|기술)\s?전쟁|패권전쟁|안보이|별들의 전쟁/;
// 우리나라 국방·안보 기사(북한·합참·DMZ 등)를 다른 나라 국방 소식보다 앞세운다.
const KOREA_DEFENSE = /북한|北|합참|軍|국군|DMZ|비무장지대|지뢰|한미|주한미군|방산|국방장관|국방부 장관|우리 군|휴전선|NLL|김정은|김여정|유엔사|정전협정|핵잠|대북/;
// 정치 분야는 우리 정치 기사를 앞세운다(외국 정상 소식은 국제 분야로).
const FOREIGN = /트럼프|美|미국|中|중국|日|일본|러시아|푸틴|우크라|젤렌스키|노벨/;
const DOMESTIC = /국회|여야|국힘|국민의힘|민주당|대통령실|청와대|李|이재명|총리|장관|의원|국감|국정감사|지방선거|서울시|정당/;
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

// 가벼운(낚시성·연예 근황·생활 정보) 제목은 이슈 후보에서 크게 깎는다.
const SOFT = /왜\?|누구길래|뭐길래|이유\?|이유는\?|근황|\[영상\]|\[표\]|가이드\]|어쩌다|\[MBN\]|\[플러스|관심종목|\[딥 머니|활용법|맛집|꿀팁|ㅋㅋ|“와!|깜짝|화제|난리|대박|충격|결국…|이렇게 많았다니|참교육|민폐|이주의 새책|베스트셀러/;
const STOP = new Set(['속보', '단독', '종합', '오늘', '내일', '어제', '올해', '내년', '지난해', '이번', '최근', '결국', '이유', '누구', '무슨', '이렇게', '그래서', '한국', '국내', '정부', '대통령', '것으로', '했다', '한다', '있다', '없다', '위해', '대한', '관련', '논란', '사실', '우리', '이제', '다시', '모두', '전국', '사상', '첫', '만에', '이후', '이상', '이하', '한다는', '했는데', '했다가', '못해', '안해']);
const PARTICLE = /(으로|에서|에게|까지|부터|이다|이라|라는|이란|하는|했던|된다|됐다|하고|에도|에는|으며|이며|은|는|이|가|을|를|의|에|도|로|와|과|만|께|서)$/;
function tokens(title) {
  const words = String(title).replace(/\[[^\]]*\]/g, ' ').replace(/[“”"‘’'…·,.!?()<>《》「」『』~:;/|\-]/g, ' ').split(/\s+/);
  const out = new Set();
  for (let word of words) {
    word = word.trim();
    if (word.length > 2) word = word.replace(PARTICLE, '');
    if (word.length < 2 || /^\d+$/.test(word) || STOP.has(word)) continue;
    out.add(word);
  }
  return out;
}
const fieldOfPath = path => Object.keys(PATHS).find(field => PATHS[field].test(path)) || '';
const defenseTest = item => DEFENSE.test(item.title) && !NOT_DEFENSE.test(item.title);

// feeds: { headline: [...], all: [...], politics: [...], ... } → 분야별 1건
// 분야마다 살펴보는 기간: 보통 36시간, 기사가 적은 정치는 3일, 국방은 7일(오래된 기사일수록 점수를 깎는다).
const WINDOW_HOURS = { defense: 7 * 24, politics: 72 };
function pickIssues(feeds, now = Date.now()) {
  const byNo = new Map();
  const sectionOf = new Map();
  for (const [name, list] of Object.entries(feeds)) {
    for (const item of list || []) {
      if (!byNo.has(item.no)) byNo.set(item.no, { ...item, inHeadline: false });
      if (name === 'headline') byNo.get(item.no).inHeadline = true;
      if (PATHS[name] && !sectionOf.has(item.no)) sectionOf.set(item.no, name);
    }
  }
  const hoursOf = item => (item.at ? Math.max(0, (now - Date.parse(item.at)) / 3600000) : 24);
  const pool = [...byNo.values()].filter(item => hoursOf(item) <= WINDOW_HOURS.defense);
  for (const item of pool) {
    item.field = fieldOfPath(item.path) || sectionOf.get(item.no) || '';
    item.words = tokens(item.title);
    item.hours = hoursOf(item);
  }
  // 낱말마다 몇 개 기사 제목에 나오는지 센다(최근 기사일수록 무겁게). 거의 모든 기사에 나오는 낱말은 주제가 아니므로 뺀다.
  const df = new Map();
  const weight = item => (item.hours <= 36 ? 1 : 0.5);
  for (const item of pool) for (const word of item.words) df.set(word, (df.get(word) || 0) + weight(item));
  const common = Math.max(6, pool.filter(item => item.hours <= 36).length * 0.25);
  const topicWords = item => [...item.words].filter(word => df.get(word) >= 2 && df.get(word) <= common);
  for (const item of pool) {
    const words = topicWords(item);
    item.related = pool.filter(other => other !== item && other.hours <= 72 && words.some(word => other.words.has(word))).length;
    item.score = words.reduce((sum, word) => sum + Math.min(df.get(word) - 1, 6), 0)
      + Math.min(item.related, 8)
      + (/\[속보\]/.test(item.title) ? 3 : 0) + (/\[단독\]/.test(item.title) ? 1.5 : 0)
      + Math.max(0, 3 - item.hours / 6) - Math.max(0, (item.hours - 24) / 8)
      - (SOFT.test(item.title) ? 8 : 0);
  }
  const chosen = [];
  // 이미 고른 기사와 같은 주제(겹치는 주제어 2개 이상)면 다른 분야에서는 뒤로 미룬다.
  const overlap = item => Math.max(0, ...chosen.map(pick => topicWords(item).filter(word => pick.words.has(word)).length));
  const best = (candidates, bonus = () => 0) => {
    const ranked = candidates.filter(item => !chosen.includes(item))
      .map(item => ({ item, value: item.score + bonus(item) - (overlap(item) >= 2 ? 10 : overlap(item) * 2) }))
      .sort((left, right) => right.value - left.value || left.item.hours - right.item.hours);
    const found = ranked[0]?.item || null;
    if (found) chosen.push(found);
    return found;
  };
  const within = id => item => item.hours <= (WINDOW_HOURS[id] || 36);
  const picks = {};
  // 국방을 먼저 고른다: 국방 기사는 정치·국제 기사이기도 해서, 뒤에 고르면 그쪽에 먼저 쓰여 버린다.
  // 국방은 국방 기사끼리만 주제를 견준다(트럼프처럼 모든 분야에 나오는 이름에 끌려가지 않도록).
  // '北지뢰'처럼 붙여 쓴 말도 잡히게 국방 낱말 자체를 주제어로 더한다.
  const defensePool = pool.filter(item => ['politics', 'world', 'society', ''].includes(item.field) && defenseTest(item));
  const defenseWords = item => new Set([...item.words, ...(item.title.match(new RegExp(`${KOREA_DEFENSE.source}|${DEFENSE.source}`, 'g')) || [])]);
  const defenseDf = new Map();
  for (const item of defensePool) for (const word of defenseWords(item)) defenseDf.set(word, (defenseDf.get(word) || 0) + weight(item));
  for (const item of defensePool) {
    item.defenseScore = [...defenseWords(item)].reduce((sum, word) => sum + Math.min((defenseDf.get(word) || 1) - 1, 6), 0)
      + (KOREA_DEFENSE.test(item.title) ? 8 : 0) + (/\[속보\]/.test(item.title) ? 3 : 0)
      + Math.max(0, 3 - item.hours / 6) - Math.max(0, (item.hours - 24) / 8) - (SOFT.test(item.title) ? 8 : 0);
  }
  picks.defense = best(defensePool, item => item.defenseScore - item.score);
  picks.politics = best(pool.filter(item => item.field === 'politics' && within('politics')(item)),
    item => (FOREIGN.test(item.title) && !DOMESTIC.test(item.title) ? -8 : DOMESTIC.test(item.title) ? 2 : 0));
  for (const id of ['economy', 'world', 'society', 'culture']) picks[id] = best(pool.filter(item => item.field === id && within(id)(item)));
  return FIELDS.map(({ id, label }) => {
    const item = picks[id];
    if (!item) return { field: id, label, empty: true };
    return { field: id, label, id: `mk-${item.no}`, title: item.title, link: item.link, at: item.at, source: '매일경제',
      headline: item.inHeadline, related: item.related, auto: true };
  });
}

async function fetchFeed(fetchImpl, code) {
  // 사용자 에이전트가 없는 요청은 막는 사이트가 많아, 누가 가져가는지 밝히는 이름을 붙인다.
  const response = await fetchImpl(`${RSS}/${code}/`, { headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; WithplucesNewsReader/1.0; +https://withpluces.com/about)',
    Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
    'Accept-Language': 'ko-KR,ko;q=0.9',
  } });
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
