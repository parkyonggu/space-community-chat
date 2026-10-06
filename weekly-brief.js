// Builds the weekly "경제·정책 브리핑" newsletter draft.
// Figures come from the Bank of Korea ECOS Open API (official statistics); news/commentary sections are left
// for the operator to write ("[직접 작성]" markers block sending until they are filled in or removed).

const MANUAL_MARK = '[직접 작성]';
const DEPARTMENTS = { economy: '기획재정부', industry: '산업통상자원부', finance: '금융위원회', sme: '중소벤처기업부', education: '교육부',
  culture: '문화체육관광부', welfare: '보건복지부', labor: '고용노동부', gender: '여성가족부', environment: '환경부', foreign: '외교부',
  unification: '통일부', defense: '국방부', science: '과학기술정보통신부', landtransport: '국토교통부', agriculture: '농림축산식품부',
  ocean: '해양수산부', safety: '행정안전부', justice: '법무부', personnel: '인사혁신처' };

const DAY = 24 * 60 * 60 * 1000;
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
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(key)}/json/kr/1/10/${code}/${cycle}/${start}/${end}/${item}`;
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`ECOS ${response.status}`);
  const data = await response.json();
  const rows = data?.StatisticSearch?.row;
  if (!Array.isArray(rows) || !rows.length) throw new Error(`ECOS empty ${code}`);
  return rows.map(row => ({ time: row.TIME, value: Number(row.DATA_VALUE) })).filter(row => Number.isFinite(row.value))
    .sort((left, right) => left.time.localeCompare(right.time));
}

async function indicators(fetchImpl, key, now) {
  const end = ymd(now);
  const start = ymd(now - 14 * DAY);
  const daily = async (label, code, item, unit, digits, mode) => {
    try {
      const rows = await ecos(fetchImpl, key, code, 'D', start, end, item);
      const last = rows.at(-1);
      const weekAgo = [...rows].reverse().find(row => row.time <= ymd(Date.parse(`${last.time.slice(0, 4)}-${last.time.slice(4, 6)}-${last.time.slice(6, 8)}T00:00:00+09:00`) - 6 * DAY));
      let change = '';
      if (weekAgo) {
        if (mode === 'percent') change = ` (1주 전 대비 ${signed(((last.value - weekAgo.value) / weekAgo.value) * 100, 2, '%')})`;
        else if (mode === 'point') change = ` (1주 전 대비 ${signed(last.value - weekAgo.value, 3, '%p')})`;
        else change = ` (1주 전 대비 ${signed(last.value - weekAgo.value, digits, unit)})`;
      }
      return `- **${label}** ${number(last.value, digits)}${unit}${change} · ${dateLabel(last.time)} 기준`;
    } catch (error) {
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
    const rows = await ecos(fetchImpl, key, '722Y001', 'D', ymd(now - 400 * DAY), end, '0101000');
    lines.push(`- **한국은행 기준금리** 연 ${number(rows.at(-1).value, 2)}% · ${dateLabel(rows.at(-1).time)} 결정`);
  } catch {
    lines.push(`- **한국은행 기준금리** 자료를 불러오지 못했습니다. ${MANUAL_MARK} 직접 확인해 적어 주세요.`);
  }
  try {
    const recent = await ecos(fetchImpl, key, '901Y009', 'M', ym(now - 120 * DAY), ym(now), '0');
    const last = recent.at(-1);
    const lastYear = `${Number(last.time.slice(0, 4)) - 1}${last.time.slice(4)}`;
    const previous = await ecos(fetchImpl, key, '901Y009', 'M', lastYear, lastYear, '0');
    const yoy = ((last.value - previous[0].value) / previous[0].value) * 100;
    lines.push(`- **소비자물가** 전년 동월 대비 ${signed(yoy, 1, '%')} · ${dateLabel(last.time)} 기준`);
  } catch {
    lines.push(`- **소비자물가** 자료를 불러오지 못했습니다. ${MANUAL_MARK} 직접 확인해 적어 주세요.`);
  }
  return lines;
}

function highlightLines(posts, siteUrl) {
  const lines = [];
  const clip = text => {
    const line = String(text).replace(/\s+/g, ' ').trim();
    return line.length > 70 ? `${line.slice(0, 70)}…` : line;
  };
  for (const post of posts.policy) lines.push(`- **[정책 제안 · ${DEPARTMENTS[post.category] || post.category}]** ${clip(post.text)} (추천 ${post.likes})`);
  for (const post of posts.voice) lines.push(`- **[시민의 소리 · ${post.category}]** ${clip(post.text)}`);
  for (const post of posts.community) lines.push(`- **[소통·나눔]** ${clip(post.text)}`);
  if (posts.researchCount) lines.push(`- 회원 전용 **학술·논문·소고·이야기**에 새 글 ${posts.researchCount}편이 올라왔습니다.`);
  if (!lines.length) lines.push('- 지난 한 주 동안 새로 올라온 글이 없습니다. 이번 주에는 여러분의 목소리를 들려주세요.');
  lines.push('', `[커뮤니티에서 더 보기](${siteUrl}/)`);
  return lines;
}

async function buildWeeklyDraft({ fetchImpl = fetch, ecosKey, now = Date.now(), siteUrl = 'https://withpluces.com', highlights }) {
  const sendAt = nextMondaySeven(now);
  const sendDate = kstDate(sendAt);
  const title = `${sendDate.getUTCMonth() + 1}월 ${sendDate.getUTCDate()}일`;
  const figures = await indicators(fetchImpl, ecosKey || 'sample', now);
  const posts = highlights ? await highlights(new Date(now - 7 * DAY).toISOString()) : { policy: [], voice: [], community: [], researchCount: 0 };
  const body = [
    `# ${title} 주간 경제·정책 브리핑`,
    '',
    '안녕하세요, 스페이스 커뮤니티입니다. 지난 한 주의 경제 흐름과 커뮤니티에서 나온 시민의 목소리를 정리해 드립니다.',
    '',
    '## 이번 주 경제 지표',
    '',
    ...figures,
    '',
    `${MANUAL_MARK} 지표 흐름에 대한 한두 줄 해설을 적어 주세요.`,
    '',
    '## 주식 시장',
    '',
    `${MANUAL_MARK} 국내외 증시 흐름을 요약해 주세요. 특정 종목의 매수·매도 권유는 넣지 않습니다.`,
    '',
    '## 부동산',
    '',
    `${MANUAL_MARK} 정부 대책, 청약, 거래 동향을 요약하고 원문 링크를 붙여 주세요. 예: [기사 제목](https://원문주소) — 직접 쓴 두세 줄 요약`,
    '',
    '## 이번 주 정부 정책',
    '',
    `${MANUAL_MARK} 생활에 영향이 큰 정책 발표를 골라 요약과 원문 링크를 적어 주세요.`,
    '',
    '## 커뮤니티에서 나온 목소리',
    '',
    ...highlightLines(posts, siteUrl),
    '',
    '---',
    '',
    '이 뉴스레터는 정보 제공을 위한 것이며 특정 금융상품이나 종목의 매매를 권유하지 않습니다. 투자 판단과 그 결과의 책임은 투자자 본인에게 있습니다. 경제 지표 출처: 한국은행 경제통계시스템(ECOS).',
  ].join('\n');
  return { subject: `스페이스 레터 · ${title} 주간 경제·정책 브리핑`, body, sendAt };
}

module.exports = { buildWeeklyDraft, nextMondaySeven, MANUAL_MARK };
