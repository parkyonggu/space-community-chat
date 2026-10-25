const test = require('node:test');
const assert = require('node:assert/strict');
const audit = require('./audit-api');

const good = { agency: '양산시청(본청)', field: '계약·공사', title: '공원 정비공사 수의계약', facts: '2025년 공원 정비공사를 같은 업체와 수의계약으로 쪼개어 맺은 것으로 보입니다.', when: '2025년 3월~6월', evidence: 'https://example.com/a\nhttps://example.com/b', pledge: true, privacy: true, sign: true };

test('정상 제보는 저장할 모양으로 정리된다', () => {
  const tip = audit.normalizeTip(good);
  assert.equal(tip.agency, '양산시청(본청)');
  assert.deepEqual(tip.evidence, ['https://example.com/a', 'https://example.com/b']);
  assert.equal(tip.prior, '아직 없음');
  assert.equal(tip.sign, true);
  assert.equal(tip.contact, false);
});

test('확인란·동의·목록 밖 값·짧은 내용은 거절한다', () => {
  assert.throws(() => audit.normalizeTip({ ...good, pledge: false }), /사실에 근거/);
  assert.throws(() => audit.normalizeTip({ ...good, privacy: undefined }), /개인정보/);
  assert.throws(() => audit.normalizeTip({ ...good, agency: '서울시청' }), /대상 기관/);
  assert.throws(() => audit.normalizeTip({ ...good, facts: '이상해요' }), /30자/);
  assert.throws(() => audit.normalizeTip({ ...good, when: '' }), /3년/);
  assert.throws(() => audit.normalizeTip({ ...good, evidence: 'javascript:alert(1)' }), /https/);
});

test('공개 현황에는 제보자·원문이 나가지 않는다', () => {
  const tip = { id: 't1', userId: 'u1', authorName: '홍길동', ...audit.normalizeTip(good), status: '청구 추진', publicTitle: '공원 공사 분할계약 의혹', publicSummary: '자료 확인 중', updatedAt: 1 };
  const shown = audit.publicCase(tip);
  assert.equal(shown.title, '공원 공사 분할계약 의혹');
  assert.equal('facts' in shown || 'userId' in shown || 'authorName' in shown, false);
  assert.throws(() => audit.normalizeReview({ status: '청구 추진', published: true, publicTitle: '' }), /공개용 제목/);
  assert.equal(audit.normalizeReview({ status: '종결' }).published, false);
});
