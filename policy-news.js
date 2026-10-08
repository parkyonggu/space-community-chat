// 이번 주 정부 정책: 대한민국 정책브리핑 '정책뉴스' API(문화체육관광부, 공공데이터포털 15095335)에서
// 경제·금융·부동산 관련 부처의 지난 한 주 정책뉴스를 모아 뉴스레터 초안에 넣는다.
// 기사별 공공누리 유형을 확인해 출처표시만 요구하는 제1유형만 쓰고, 본문은 옮기지 않고 제목·부제목과 원문 링크만 싣는다.

const DAY = 24 * 60 * 60 * 1000;
const kst = timestamp => new Date(timestamp + 9 * 60 * 60 * 1000);
const ymd = timestamp => kst(timestamp).toISOString().slice(0, 10).replace(/-/g, '');

// 경제·금융·부동산·산업 관련 부처(이름 일부로 찾는다). 조직 개편으로 이름이 바뀌어도 걸리도록 핵심 낱말만 쓴다.
const ECONOMY_DEPARTMENTS = /금융위원회|금융감독|재정경제|기획재정|기획예산|국토교통|산업통상|중소벤처|고용노동|공정거래|국세청|관세청|통계청|조달청|국무조정실|한국은행/;
const ECONOMY_WORDS = /금융|펀드|금리|대출|투자|경제|성장|물가|부동산|주택|전세|청약|세제|세법|예산|재정|수출|산업|기업|일자리|고용|소상공인|자영업|민생|채무|연금|보험|가계|관세|무역|반도체|AI|인공지능/;

function decode(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
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
    .filter(item => item.Title && item.OriginalUrl && isTypeOne(item.KoglType))
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
async function recentPolicyNews(fetchImpl, key, now, { limit = 10 } = {}) {
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
      title: item.Title,
      sub: (item.SubTitle1 || '').slice(0, 140),
      dept: item.MinisterCode || '정부',
      at: approvedAt(item.ApproveDate) || null,
      url: /^https?:\/\//.test(item.OriginalUrl) ? item.OriginalUrl : `https://www.korea.kr${item.OriginalUrl}`,
      economy: ECONOMY_DEPARTMENTS.test(item.MinisterCode || '') || ECONOMY_WORDS.test(`${item.Title} ${item.SubTitle1 || ''}`),
    }))
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, limit);
}

module.exports = { weeklyPolicyNews, recentPolicyNews, parseNews, isTypeOne };
