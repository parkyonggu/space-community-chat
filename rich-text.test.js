const test = require('node:test');
const assert = require('node:assert/strict');
const { toHtml, plain } = require('./public/rich-text.js');

test('탭으로 나뉜 표(한글·엑셀 복사)는 머리줄과 숫자 칸 오른쪽 맞춤이 있는 표가 된다', () => {
  const html = toHtml('종목\t시장\t종가\t주간\n삼성전자\t한국\t215,500원\t−17.7%\n애플 AAPL\t미국\t$343.46\t+2.0%');
  assert.match(html, /<thead><tr><th>종목<\/th><th>시장<\/th><th>종가<\/th><th>주간<\/th><\/tr><\/thead>/);
  assert.match(html, /<td class="num">215,500원<\/td><td class="num">−17\.7%<\/td>/);
  assert.match(html, /<td class="num">\$343\.46<\/td>/);
});

test('두 칸 이상 띄어 맞춘 3줄 이상, | 로 나눈 줄도 표가 된다', () => {
  assert.match(toHtml('종목  시장  종가\n삼성전자  한국  215,500원\n애플  미국  $343.46'), /<table>/);
  assert.match(toHtml('| 종목 | 종가 |\n|---|---|\n| 삼성전자 | 215,500원 |'), /<th>종목<\/th>/);
  assert.doesNotMatch(toHtml('그냥  두 칸 띄운  문장 하나'), /<table>/);
});

test('소제목(##, ■)·밑줄·굵게·링크, 위험한 글자는 이스케이프', () => {
  assert.equal(toHtml('## 1. 개관'), '<h3 class="rt-h">1. 개관</h3>');
  assert.equal(toHtml('■ 2. 전망'), '<h3 class="rt-h">2. 전망</h3>');
  assert.equal(toHtml('__중요__ 와 **핵심** <b>'), '<p><u>중요</u> 와 <strong>핵심</strong> &lt;b&gt;</p>');
  assert.match(toHtml('보기 https://withpluces.com/post/2'), /<a href="https:\/\/withpluces\.com\/post\/2"/);
  assert.equal(toHtml('a\nb\n\nc'), '<p>a<br>b</p>\n<p>c</p>');
});

test('요약용 글은 꾸밈 기호와(원하면) 표를 뺀다', () => {
  assert.equal(plain('## 개관\n__반도체__ 급락\n\n종목\t종가\n삼성\t1원', { tables: false }), '개관\n\n반도체 급락');
});

test('📋 표 넣기로 만든 | 표는 숫자가 없어도 첫 줄이 머리줄이다', () => {
  assert.match(toHtml('이름 | 역할\n홍길동 | 회장\n김철수 | 총무'), /<thead><tr><th>이름<\/th><th>역할<\/th><\/tr><\/thead>/);
});
