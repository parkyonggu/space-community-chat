const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, kindOf, renderAnnouncementPage } = require('./announcement');

test('parses 모임안내 and 초청장 with title and body', () => {
  assert.equal(kindOf('[초청장]\n창립 기념식').id, 'invitation');
  assert.equal(kindOf('보통 메시지'), null);
  const parsed = parse('[모임안내]\n\n토요일 산책 모임\n일시: 10월 11일 오후 2시\n장소: 양산천');
  assert.equal(parsed.title, '토요일 산책 모임');
  assert.equal(parsed.body, '일시: 10월 11일 오후 2시\n장소: 양산천');
});

test('share page carries the 스페이스 커뮤니티 brand in Open Graph tags', () => {
  const html = renderAnnouncementPage({ id: '1791560000000-abcdef1234', at: Date.parse('2026-10-10T02:00:00Z'), text: '[초청장]\n창립 기념식 <초대>\n11월 1일 오후 3시' }, 'https://withpluces.com');
  assert.match(html, /<meta property="og:site_name" content="스페이스 커뮤니티">/);
  assert.match(html, /<meta property="og:title" content="💌 초청장 창립 기념식 &lt;초대&gt;">/);
  assert.match(html, /og:image" content="https:\/\/withpluces\.com\/share\/invitation\.png"/);
  assert.match(html, /og:url" content="https:\/\/withpluces\.com\/e\/1791560000000-abcdef1234"/);
  assert.ok(!html.includes('<초대>'), 'escaped');
  assert.equal(renderAnnouncementPage({ id: 'x', at: 0, text: '보통 메시지' }), null);
});

test('a poster photo becomes the preview image and is shown on the page', () => {
  const html = renderAnnouncementPage({ id: '1791560000000-abcdef1234', at: Date.now(), image: 'c'.repeat(32), text: '[초청장]\n범어초 총동창회 야유회' }, 'https://withpluces.com');
  assert.match(html, /og:image" content="https:\/\/withpluces\.com\/api\/board\/image\?id=c{32}"/);
  assert.match(html, /class="poster"/);
  assert.ok(!html.includes('og:image:width'));
});
