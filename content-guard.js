// 글 자동 거르기: 불법 도박·음란·불법 금융·마약·위조·개인정보 거래 광고 등 사이트를 악용하는 글을 올리기 전에 막는다.
// 게시판 글·수정, 댓글, 광장채팅, 스페이스 톡, 주민감사청구 제보, 회원가입 닉네임에 같은 규칙을 쓴다.
// ★ 낱말을 더하거나 빼려면 아래 STRONG(그 낱말만으로 막음) / ADS(연락처·홍보 문구와 함께 있을 때만 막음) 목록을 고치면 된다.
// 뉴스·정책 토론(예: "필로폰 투약 혐의", "카지노 규제")은 막지 않도록, 애매한 낱말은 연락처·판매 문구와 함께일 때만 막는다.

// 띄어쓰기·점·기호·이모지로 끊어 쓴 글자(카.지.노, 바 카 라)도 잡도록 글자와 숫자만 남긴다.
function compact(text) {
  return String(text || '').normalize('NFKC').toLowerCase()
    .replace(/[​-‏⁠﻿]/g, '')
    .replace(/[^0-9a-zㄱ-ㆎ가-힣]/g, '');
}
// 두 글자 낱말(야동 등)은 띄어쓰기를 살려 비교한다(예: '우리 야 동네'를 잘못 막지 않게).
function loose(text) {
  return ' ' + String(text || '').normalize('NFKC').toLowerCase()
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
    .replace(/[^0-9a-z\u3131-\u318e\uac00-\ud7a3\s]/g, '').replace(/\s+/g, ' ') + ' ';
}
const has = (flat, spaced, word) => {
  const key = compact(word);
  return key.length <= 2 ? spaced.includes(key) : flat.includes(key);
};

// 그 낱말만 있어도 막는 것(일상 대화·뉴스에서 거의 쓰지 않는 불법 영업 표현)
const STRONG = [
  { category: '불법 도박 광고', words: ['바카라', '토토사이트', '사설토토', '먹튀검증', '먹튀사이트', '슬롯사이트', '카지노사이트', '온라인카지노', '온라인바카라', '라이브카지노', '에볼루션카지노', '홀덤사이트', '파워볼사이트', '꽁머니', '첫충전보너스', '매충보너스', '신규가입머니', '카지노에이전시', '정켓', '카지노투어', '카지노여행', '카지노콤프'] },
  { category: '음란·성매매 광고', words: ['조건만남', '출장안마', '출장마사지', '출장샵', '성인방송', '야동', '19금영상', '오피사이트', '오피걸', '립카페', '키스방', '섹파', '원나잇', '즉석만남', '애인대행', '유흥알바', '룸알바', '노래방도우미', '성인용품도매', '몸캠'] },
  { category: '불법 금융 광고', words: ['작업대출', '내구제', '대포통장', '대포폰', '휴대폰깡', '카드깡', '신불자대출', '무직자당일대출', '통장매입', '통장삽니다', '통장임대', '계좌대여'] },
  { category: '위조·불법 거래 광고', words: ['위조신분증', '신분증위조', '주민등록증위조', '운전면허증위조', '졸업증명서위조', '가짜졸업장', '디비판매', 'db판매', '개인정보판매', '고객디비', '해킹의뢰', '카톡해킹', '비아그라판매', '시알리스판매', '낙태약', '미프진'] },
];
// 마약: 약물 이름 + 판매·구매 표현이 함께 있을 때만(뉴스 기사는 통과)
const DRUG = /(필로폰|히로뽕|메스암페타민|아이스|떨|대마|대마초|케타민|엑스터시|코카인|lsd|펜타닐|마약)(을|를)?(판매|팝니다|팔아요|구매|삽니다|드랍|던지기|직거래|배송|구입문의)/;

// 혼자서는 괜찮지만 연락처·홍보 문구와 함께 오면 광고로 보는 낱말
const ADS = [
  { category: '불법 도박 광고', words: ['카지노', '슬롯', '홀덤', '토토', '파워볼', '배팅', '베팅', '도박'] },
  { category: '음란·성매매 광고', words: ['마사지', '안마', '19금', '유흥', '애인'] },
  { category: '불법 금융 광고', words: ['대출', '급전', '일수대출', '소액대출', '비대면대출', '리딩방', '코인리딩', '주식리딩', '고수익', '원금보장', '투자수익보장'] },
  { category: '불법 영업 광고', words: ['부업', '재택알바', '고액알바', '당일지급', '팔로워구매', '좋아요구매'] },
];
// 연락처로 끌어내는 표현: 텔레그램·카카오톡 아이디, 오픈채팅, 라인·위챗, 단축 주소
const CONTACT = [
  /텔레그램|텔레|telegram|tme\b|t\.me\//i,
  /(카카오톡|카톡|kakaotalk|kakao|카톡아이디|카톡id)\s*(아이디|id)?\s*[:：]?\s*@?[a-z0-9_.-]{3,}/i,
  /open\.kakao\.com|오픈채팅|오픈톡/i,
  /(라인|line|위챗|wechat|왓츠앱|whatsapp)\s*(아이디|id)?\s*[:：]\s*@?[a-z0-9_.-]{3,}/i,
  /(^|\s)@[a-z][a-z0-9_]{3,31}\b/i,
  /bit\.ly\/|han\.gl\/|vo\.la\/|me2\.do\/|url\.kr\/|tinyurl\.com\//i,
];
const PROMO = /(문의|상담|예약|가입|입금|수익|할인|무료|이벤트|보너스|당첨|모집|최저가|24시간|365일|ㄱㄱ)/;

// 막아야 하면 { category, reason } 을, 괜찮으면 null 을 돌려준다.
function check(...parts) {
  const raw = parts.filter(part => typeof part === 'string' && part).join('\n');
  if (!raw.trim()) return null;
  const flat = compact(raw);
  const spaced = loose(raw);
  for (const rule of STRONG) {
    const word = rule.words.find(item => has(flat, spaced, item));
    if (word) return { category: rule.category, reason: word };
  }
  if (DRUG.test(flat)) return { category: '마약 거래 광고', reason: '마약 판매·구매 표현' };
  const contact = CONTACT.some(pattern => pattern.test(raw));
  if (contact) {
    for (const rule of ADS) {
      const word = rule.words.find(item => has(flat, spaced, item));
      if (word) return { category: rule.category, reason: `${word} + 메신저 연락처` };
    }
    // 텔레그램·카톡 아이디를 두 가지 이상 남기거나, 연락처 + 홍보 문구가 함께 있으면 광고로 본다.
    const kinds = CONTACT.filter(pattern => pattern.test(raw)).length;
    if (kinds >= 2 && PROMO.test(flat)) return { category: '상업 광고', reason: '메신저 연락처 + 홍보 문구' };
    if (kinds >= 2 && /텔레그램|telegram|t\.me/i.test(raw)) return { category: '상업 광고', reason: '메신저 연락처 여러 개' };
  }
  return null;
}

const MESSAGE = hit => `이 내용은 올릴 수 없습니다. ${hit.category}로 보이는 글은 운영 원칙에 따라 자동으로 막습니다. 잘못 막혔다면 운영자(dragon600120@gmail.com)에게 알려 주세요.`;

// 막은 글을 운영자에게 알리는 곳(슬랙 등). 서버가 시작할 때 setReporter로 정한다.
let reporter = null;
function setReporter(fn) { reporter = typeof fn === 'function' ? fn : null; }
function report(entry) {
  if (!reporter) return;
  try { reporter(entry); } catch (error) { console.error('Content guard report failed:', error.message); }
}

// 막을 글이면 err(메시지)로 만든 오류를 던진다. 운영자 글은 거르지 않는다.
// report: 이 글을 받은 곳(서버 객체)의 알림 함수. 여러 서버 객체가 한 프로그램 안에 함께 떠 있어도 알림이 엇갈리지 않게 부를 때마다 넘긴다.
function enforce({ where, user, parts, makeError, report: notify }) {
  if (user?.admin) return;
  const hit = check(...parts);
  if (!hit) return;
  (typeof notify === 'function' ? entry => { try { notify(entry); } catch (error) { console.error('Content guard report failed:', error.message); } } : report)({ where, category: hit.category, reason: hit.reason, nickname: user?.nickname || user?.name || '', text: parts.filter(Boolean).join(' / ').slice(0, 300) });
  throw makeError(MESSAGE(hit));
}

module.exports = { check, enforce, setReporter, MESSAGE, compact };
