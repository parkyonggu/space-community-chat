// 국가법령정보 공동활용 Open API(법제처): 법령 이름과 조문 번호로 현행 조문 원문을 가져온다.
// 키(OC)는 `npx wrangler secret put LAW_OC` 로만 넣는다.
const BASE = 'https://www.law.go.kr/DRF';
const ALIASES = { '헌법': '대한민국헌법' };

const list = value => (Array.isArray(value) ? value : value == null ? [] : [value]);
const clean = value => String(value ?? '').replace(/<[^>]+>/g, '').replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

function normalizeName(name) {
  const value = String(name || '').replace(/\s+/g, ' ').trim();
  return ALIASES[value] || value;
}

// 조문 하나(조문단위)를 사람이 읽는 줄들로 만든다: 조문 → 항 → 호 → 목
function articleLines(unit) {
  const lines = [];
  const head = clean(unit['조문내용']);
  if (head) lines.push(head);
  for (const paragraph of list(unit['항'])) {
    const text = clean(paragraph['항내용']);
    if (text) lines.push(text);
    for (const item of list(paragraph['호'])) {
      const itemText = clean(item['호내용']);
      if (itemText) lines.push(`  ${itemText}`);
      for (const sub of list(item['목'])) {
        const subText = clean(Array.isArray(sub['목내용']) ? sub['목내용'].join('\n') : sub['목내용']);
        if (subText) lines.push(`    ${subText}`);
      }
    }
  }
  return lines;
}

function createLawInfo({ oc = '', fetchImpl = fetch } = {}) {
  async function getJson(url) {
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    const text = await response.text();
    if (!response.ok) throw new Error(`법령정보 서버 오류 (${response.status})`);
    try { return JSON.parse(text); } catch {
      throw new Error(/검증|인증|OC/.test(text) ? '법령정보 API 사용 승인(OC·도메인)을 확인해 주세요.' : '법령정보 서버 응답을 읽지 못했습니다.');
    }
  }

  async function findLaw(name) {
    const query = normalizeName(name);
    const url = `${BASE}/lawSearch.do?OC=${encodeURIComponent(oc)}&target=law&type=JSON&display=20&query=${encodeURIComponent(query)}`;
    const data = await getJson(url);
    const laws = list(data?.LawSearch?.law);
    const exact = laws.find(law => clean(law['법령명한글']) === query) || laws.find(law => clean(law['법령명한글']).replace(/\s/g, '') === query.replace(/\s/g, ''));
    if (!exact) return null;
    return { name: clean(exact['법령명한글']), mst: String(exact['법령일련번호'] || ''), id: String(exact['법령ID'] || ''), effective: String(exact['시행일자'] || '') };
  }

  // name: '기초연금법', jo: 8, sub: 0(제8조) 또는 2(제8조의2)
  async function article(name, jo, sub = 0) {
    if (!oc) throw new Error('법령정보 API 키(LAW_OC)가 없습니다.');
    const number = Number(jo), branch = Number(sub) || 0;
    if (!Number.isInteger(number) || number < 1 || number > 9999 || !Number.isInteger(branch) || branch < 0 || branch > 99) throw new Error('조문 번호가 올바르지 않습니다.');
    const law = await findLaw(name);
    if (!law) return { found: false, name: normalizeName(name) };
    const joCode = String(number).padStart(4, '0') + String(branch).padStart(2, '0');
    const url = `${BASE}/lawService.do?OC=${encodeURIComponent(oc)}&target=law&type=JSON&MST=${encodeURIComponent(law.mst)}&JO=${joCode}`;
    const data = await getJson(url);
    const root = data?.['법령'] || {};
    const units = list(root?.['조문']?.['조문단위']);
    const unit = units.find(entry => entry['조문여부'] === '조문' && Number(entry['조문번호']) === number && (Number(entry['조문가지번호']) || 0) === branch)
      || units.find(entry => entry['조문여부'] === '조문');
    const label = `제${number}조${branch ? `의${branch}` : ''}`;
    if (!unit) return { found: false, name: law.name, label };
    const effective = String(root?.['기본정보']?.['시행일자'] || law.effective || '');
    return {
      found: true, name: law.name, label, title: clean(unit['조문제목']), lines: articleLines(unit),
      effective: effective.length === 8 ? `${effective.slice(0, 4)}.${effective.slice(4, 6)}.${effective.slice(6)}` : effective,
      link: `https://www.law.go.kr/법령/${encodeURIComponent(law.name)}/${encodeURIComponent(label)}`,
    };
  }

  return { ready: Boolean(oc), article };
}

module.exports = { createLawInfo, normalizeName, articleLines };
