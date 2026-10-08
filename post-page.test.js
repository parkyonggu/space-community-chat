const test = require('node:test');
const assert = require('node:assert/strict');
const { renderPostPage, renderMissingPage, renderSitemap, headlineOf, bodyHtml } = require('./post-page');

const post = { no: 12, board: 'voice', category: '이 정책, 이상해요', title: '', authorName: '박<용구>', likes: 3,
  text: '• 진주 한국국제대 10차례 유찰… "폐교 부지 활용 방안 시급"\n[경일포럼] 폐교 부지를 [노인복지마을로](https://www.gnnews.co.kr/news/1)\n\n두 번째 문단 https://example.com/a. <script>alert(1)</script>',
  createdAt: '2026-10-07T03:00:00.000Z', editedAt: null };

test('post page is crawlable HTML with title, description, canonical, JSON-LD and safe body', () => {
  const html = renderPostPage({ post, related: [{ ...post, no: 11, text: '다른 글입니다' }] }, 'https://withpluces.com');
  assert.match(html, /<title>진주 한국국제대 10차례 유찰… &quot;폐교 부지 활용 방안 시급&quot; \| 시민의 소리 · 스페이스 커뮤니티<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/withpluces.com\/post\/12">/);
  assert.match(html, /"@type":"DiscussionForumPosting"/);
  assert.match(html, /<a href="https:\/\/www.gnnews.co.kr\/news\/1" rel="nofollow ugc noopener" target="_blank">노인복지마을로<\/a>/);
  assert.match(html, /<a href="https:\/\/example.com\/a" rel="nofollow ugc noopener"/);
  assert.ok(!html.includes('<script>alert(1)</script>'), 'user text escaped');
  assert.match(html, /박&lt;용구&gt;/);
  assert.match(html, /<a href="\/post\/11">/, 'links to other posts for crawling');
  assert.match(html, /adsbygoogle\.js\?client=ca-pub-3255503954415485/);
  assert.match(html, /2026년 10월 7일/);
});

test('missing / members-only pages are noindex, sitemap lists posts', () => {
  assert.match(renderMissingPage(403), /noindex/);
  assert.match(renderMissingPage(403), /회원만 볼 수 있는/);
  const xml = renderSitemap([{ no: 12, createdAt: '2026-10-07T03:00:00Z' }, { no: 3, createdAt: '2026-10-01T00:00:00Z', editedAt: '2026-10-05T00:00:00Z' }], 'https://withpluces.com', '2026-10-08');
  assert.match(xml, /<loc>https:\/\/withpluces.com\/<\/loc><lastmod>2026-10-08<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/withpluces.com\/post\/12<\/loc><lastmod>2026-10-07<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/withpluces.com\/post\/3<\/loc><lastmod>2026-10-05<\/lastmod>/);
  assert.equal(headlineOf({ title: '', text: '\n\n  # 첫 줄 제목\n본문' }), '첫 줄 제목');
  assert.equal(bodyHtml('a\nb\n\nc'), '<p>a<br>b</p>\n<p>c</p>');
});

test('quoted or starred first lines become clean titles', () => {
  assert.equal(headlineOf({ text: '"*주식투자운용전략에 대하여 *"\n본문' }), '주식투자운용전략에 대하여');
  assert.equal(headlineOf({ text: "'습관은 실천할 때 완성된다'\n본문" }), '습관은 실천할 때 완성된다');
  assert.equal(headlineOf({ text: '" 엔비디아 주식의 상승이유"\n' }), '엔비디아 주식의 상승이유');
  assert.equal(headlineOf({ text: '하늘수목공원 조성사업' }), '하늘수목공원 조성사업');
});
