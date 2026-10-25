// 양산 주민감사청구 탭: 제보 양식 검사·정리 (지방자치법 제21조 주민의 감사청구)
// 저장·권한 확인은 cloudflare/worker.js가 하고, 이 파일은 입력값 규칙만 정한다(테스트하기 쉽게).

const AGENCIES = ['양산시청(본청)', '읍·면·동 행정복지센터', '양산시 사업소·출자출연기관', '양산시의회', '그 밖의 양산시 관련 기관'];
const FIELDS = ['예산·회계', '계약·공사', '인허가·단속', '민원 처리', '보조금·복지', '인사·조직', '그 밖의 사항'];
const PRIOR = ['아직 없음', '민원을 냈음', '정보공개청구를 했음', '민원과 정보공개청구 모두'];
const STATUSES = ['접수', '검토 중', '자료 보완 요청', '청구 추진', '청구 제출', '종결'];

class AuditError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const clean = (value, max) => String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const pick = (value, list, name) => {
  const text = clean(value, 60);
  if (!list.includes(text)) throw new AuditError(400, `${name}을(를) 목록에서 골라 주세요.`);
  return text;
};
// 근거 자료 주소: http(s) 주소만 줄마다 하나씩, 5개까지
function links(value) {
  const lines = clean(value, 1500).split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length > 5) throw new AuditError(400, '근거 자료 주소는 5개까지 적어 주세요.');
  for (const line of lines) {
    let url;
    try { url = new URL(line); } catch { url = null; }
    if (!url || !/^https?:$/.test(url.protocol)) throw new AuditError(400, '근거 자료는 https:// 로 시작하는 주소를 한 줄에 하나씩 적어 주세요.');
  }
  return lines;
}

// 회원이 보낸 제보를 검사해 저장할 모양으로 바꾼다.
function normalizeTip(input = {}) {
  const title = clean(input.title, 80);
  const facts = clean(input.facts, 3000);
  const when = clean(input.when, 40);
  if (title.length < 4) throw new AuditError(400, '제목을 4자 이상 적어 주세요.');
  if (facts.length < 30) throw new AuditError(400, '무엇이 문제인지 사실관계를 30자 이상 적어 주세요.');
  if (!when) throw new AuditError(400, '언제 있었던 일인지 적어 주세요. (감사청구는 사무처리가 있었던 날이나 끝난 날부터 3년 안에만 할 수 있습니다)');
  if (input.pledge !== true) throw new AuditError(400, '사실에 근거한 제보라는 확인란에 표시해 주세요.');
  if (input.privacy !== true) throw new AuditError(400, '개인정보 수집·이용 동의란에 표시해 주세요.');
  return {
    agency: pick(input.agency, AGENCIES, '대상 기관'),
    field: pick(input.field, FIELDS, '분야'),
    title, facts, when,
    evidence: links(input.evidence),
    prior: pick(input.prior || PRIOR[0], PRIOR, '이전 조치'),
    contact: input.contact === true,
    sign: input.sign === true,
  };
}

// 운영자의 처리 상태·공개 설정
function normalizeReview(input = {}) {
  const review = { status: pick(input.status, STATUSES, '처리 상태'), memo: clean(input.memo, 1000), published: input.published === true };
  review.publicTitle = clean(input.publicTitle, 80);
  review.publicSummary = clean(input.publicSummary, 1500);
  if (review.published && review.publicTitle.length < 4) throw new AuditError(400, '공개할 때는 공개용 제목을 4자 이상 적어 주세요(제보 원문은 공개되지 않습니다).');
  return review;
}

// 누구나 보는 진행 현황: 운영자가 다듬어 공개한 제목·요약만 내보낸다(제보자·원문은 내보내지 않음).
const publicCase = tip => ({ id: tip.id, agency: tip.agency, field: tip.field, status: tip.status, title: tip.publicTitle, summary: tip.publicSummary, updatedAt: tip.updatedAt });
// 제보한 회원이 보는 내 제보
const ownTip = tip => ({ id: tip.id, agency: tip.agency, field: tip.field, title: tip.title, status: tip.status, createdAt: tip.createdAt, updatedAt: tip.updatedAt });

module.exports = { AGENCIES, FIELDS, PRIOR, STATUSES, AuditError, normalizeTip, normalizeReview, publicCase, ownTip };
