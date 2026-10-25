const test = require('node:test');
const assert = require('node:assert');
const guard = require('./content-guard');

test('blocks gambling, adult, drug and loan spam, including spaced-out words', () => {
  assert.ok(guard.check('🔥 세부여행의 시작, 호텔부터 카지노·골프까지 로얄탐\n카카오톡: TAM999\n텔레그램: @Rtam999'));
  assert.ok(guard.check('바 카 라 최고 수익'));
  assert.ok(guard.check('카-지-노 사이트 ㄱㄱ'));
  assert.ok(guard.check('조건만남 하실 분'));
  assert.ok(guard.check('필로폰 팝니다'));
  assert.ok(guard.check('급전 필요하신 분 카톡 abc123'));
  assert.ok(guard.check('텔레그램 @spam111 카톡 abc999 가입 문의'));
});

test('lets ordinary posts, news and policy talk through', () => {
  for (const text of ['필로폰 투약 혐의로 기소된 사건', '정부의 카지노 규제 정책에 대한 의견', '기초연금 대출 상환 관련 문의드립니다',
    '내일 마사지 받으러 가요', '우리 야 동네 모임', '오피스텔 매매 카톡 abc123 문의', '첫 충격적인 소식', '어려운 일수록 카톡 abc12 로 연락',
    '회의 장소 변경, 문의는 010-2500-5900', '@everyone 오늘 모임 있어요']) assert.equal(guard.check(text), null, text);
});

test('enforce throws for members, skips admins, and reports blocks', () => {
  const seen = [];
  guard.setReporter(entry => seen.push(entry));
  assert.throws(() => guard.enforce({ where: 't', user: { nickname: 'x' }, parts: ['바카라'], makeError: message => new Error(message) }), /올릴 수 없습니다/);
  assert.doesNotThrow(() => guard.enforce({ where: 't', user: { admin: true }, parts: ['바카라'], makeError: message => new Error(message) }));
  assert.equal(seen.length, 1);
  guard.setReporter(null);
});

test('enforce sends the block to the caller-supplied report (where and who)', () => {
  const seen = [];
  assert.throws(() => guard.enforce({ where: '게시판 글(community)', user: { nickname: '홍길동' }, parts: ['', '바카라'], makeError: message => new Error(message), report: entry => seen.push(entry) }));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].where, '게시판 글(community)');
  assert.equal(seen[0].nickname, '홍길동');
  assert.equal(seen[0].category, '불법 도박 광고');
});
