const test = require('node:test');
const assert = require('node:assert/strict');
const { createLawInfo, normalizeName } = require('./law-info');

test('헌법은 대한민국헌법으로 찾는다', () => {
  assert.equal(normalizeName('헌법'), '대한민국헌법');
  assert.equal(normalizeName(' 기초연금법 '), '기초연금법');
});

test('법령을 찾고 조문(항·호)을 줄로 돌려준다', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    const body = url.includes('lawSearch')
      ? { LawSearch: { law: [{ 법령명한글: '기초연금법 시행령', 법령일련번호: '1' }, { 법령명한글: '기초연금법', 법령일련번호: '271234', 시행일자: '20260101' }] } }
      : { 법령: { 기본정보: { 시행일자: '20260101' }, 조문: { 조문단위: [{ 조문여부: '전문', 조문내용: '제2장' }, { 조문여부: '조문', 조문번호: '8', 조문제목: '기초연금액의 감액', 조문내용: '제8조(기초연금액의 감액)',
        항: [{ 항내용: '① 본인과 그 배우자가 ...', 호: { 호내용: '1. 첫째' } }, { 항내용: '② 둘째 항' }] }] } } };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  const law = createLawInfo({ oc: 'test', fetchImpl });
  const result = await law.article('기초연금법', 8, 0);
  assert.equal(result.found, true);
  assert.equal(result.name, '기초연금법');
  assert.equal(result.label, '제8조');
  assert.equal(result.title, '기초연금액의 감액');
  assert.deepEqual(result.lines, ['제8조(기초연금액의 감액)', '① 본인과 그 배우자가 ...', '  1. 첫째', '② 둘째 항']);
  assert.equal(result.effective, '2026.01.01');
  assert.match(calls[1], /MST=271234&JO=000800$/);
});

test('키가 없거나 승인 오류면 알기 쉬운 오류를 낸다', async () => {
  await assert.rejects(createLawInfo({ oc: '' }).article('기초연금법', 8), /LAW_OC/);
  const law = createLawInfo({ oc: 'x', fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<html>사용자 정보 검증에 실패하였습니다.</html>' }) });
  await assert.rejects(law.article('기초연금법', 8), /승인/);
});
