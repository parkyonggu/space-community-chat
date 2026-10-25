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
  assert.equal(headlineOf({ text: '[서민경제 안정과 국가 체질개선]\n\n본문' }), '서민경제 안정과 국가 체질개선');
  assert.equal(headlineOf({ text: '[경일포럼] 폐교 활용' }), '[경일포럼] 폐교 활용');
});

const { renderBoardPage, renderLetterList, renderLetterPage, injectLatestPosts, PAGE_SIZE } = require('./post-page');
const boardPosts = Array.from({ length: 12 }, (_, index) => ({ no: index + 1, board: index % 4 === 3 ? 'policy' : 'community', category: index % 4 === 3 ? 'economy' : '', title: '',
  text: `${index + 1}번째 글 <b>제목</b>\n본문 내용 ${index + 1}`, authorName: '회원', likes: 0, createdAt: new Date(Date.UTC(2026, 9, 1 + index)).toISOString() }));

test('board list pages: 5 posts per page, real /post links and ?page=N links, 404 outside range', () => {
  assert.equal(PAGE_SIZE, 5);
  const community = boardPosts.filter(entry => entry.board === 'community'); // 9개 → 2쪽
  const first = renderBoardPage({ board: 'community', posts: boardPosts, page: 1 });
  assert.match(first, /<title>소통·나눔 · 스페이스 커뮤니티<\/title>/);
  assert.match(first, /<link rel="canonical" href="https:\/\/withpluces.com\/board\/community">/);
  assert.equal((first.match(/<li><h2><a href="\/post\/\d+">/g) || []).length, 5);
  assert.match(first, new RegExp(`<a href="/post/${community.at(-1).no}">`), 'newest first');
  assert.ok(!first.includes('href="/post/4"'), 'other boards are not listed');
  assert.match(first, /<a href="\/board\/community\?page=2" rel="next">/);
  assert.match(first, /<link rel="next" href="https:\/\/withpluces.com\/board\/community\?page=2">/);
  assert.ok(!first.includes('<b>제목</b>'), 'titles escaped');
  assert.match(first, /<a href="\/board\/voice">시민의 소리<\/a>/, 'links to other boards');
  const second = renderBoardPage({ board: 'community', posts: boardPosts, page: 2 });
  assert.match(second, /<link rel="canonical" href="https:\/\/withpluces.com\/board\/community\?page=2">/);
  assert.equal((second.match(/<li><h2><a href="\/post\/\d+">/g) || []).length, 4);
  assert.match(second, /<a href="\/board\/community" rel="prev">/);
  assert.equal(renderBoardPage({ board: 'community', posts: boardPosts, page: 3 }), null);
  assert.equal(renderBoardPage({ board: 'issue', posts: boardPosts, page: 1 }), null);
  assert.equal(renderBoardPage({ board: 'nope', posts: boardPosts, page: 1 }), null);
  assert.match(renderBoardPage({ board: 'policy', posts: boardPosts, page: 1 }), /기획재정부/);
  assert.match(renderBoardPage({ board: 'research', posts: boardPosts, page: 1 }), /noindex/, 'empty board is not indexed');
});

test('post page breadcrumb links to the board list page', () => {
  assert.match(renderPostPage({ post }), /<a href="\/board\/voice">시민의 소리<\/a>/);
  assert.match(renderPostPage({ post: { ...post, board: 'issue' } }), /<a href="\/#issue-panel">/);
});

const letters = [
  { id: 'b', slug: '2026-10-19', subject: '10월 셋째 주 <레터>', sentAt: '2026-10-18T22:00:00.000Z', html: '<p style="margin:12px 0">기준금리 <strong>동결</strong> <a href="https://www.bok.or.kr" style="color:#1958e8">한국은행</a></p>' },
  { id: 'a', slug: '2026-10-12', subject: '10월 둘째 주', sentAt: '2026-10-11T22:00:00.000Z', html: '<p>지난 호</p>' },
];

test('letter list and letter pages are server-rendered with real links', () => {
  const list = renderLetterList(letters);
  assert.match(list, /<link rel="canonical" href="https:\/\/withpluces.com\/letter">/);
  assert.match(list, /<a href="\/letter\/2026-10-19">10월 셋째 주 &lt;레터&gt;<\/a>/);
  assert.match(list, /<a href="\/letter\/2026-10-12">/);
  assert.ok(!list.includes('불러오는 중'));
  const empty = renderLetterList([]);
  assert.match(empty, /noindex/);
  assert.match(empty, /아직 발행된 레터가 없습니다/);
  const page = renderLetterPage({ letter: letters[0], letters });
  assert.match(page, /<link rel="canonical" href="https:\/\/withpluces.com\/letter\/2026-10-19">/);
  assert.match(page, /<title>10월 셋째 주 &lt;레터&gt; \| 스페이스 레터/);
  assert.match(page, /"@type":"Article"/);
  assert.match(page, /<strong>동결<\/strong>/);
  assert.match(page, /<a href="https:\/\/www.bok.or.kr" target="_blank" rel="noopener" style=/);
  assert.match(page, /<meta name="description" content="기준금리 동결 한국은행">/);
  assert.match(page, /2026년 10월 19일/, 'KST date');
  assert.match(page, /<a href="\/letter\/2026-10-12">/, 'links to other issues');
});

test('sitemap: board pages, letters only when published', () => {
  const xml = renderSitemap(boardPosts, 'https://withpluces.com', '2026-10-25', { letters });
  assert.match(xml, /<loc>https:\/\/withpluces.com\/board\/community<\/loc><lastmod>2026-10-11<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/withpluces.com\/board\/policy<\/loc><lastmod>2026-10-12<\/lastmod>/);
  assert.ok(!xml.includes('/board/research'), 'empty boards left out');
  assert.match(xml, /<loc>https:\/\/withpluces.com\/letter<\/loc><lastmod>2026-10-18<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/withpluces.com\/letter\/2026-10-19<\/loc>/);
  assert.match(xml, /<loc>https:\/\/withpluces.com\/letter\/2026-10-12<\/loc>/);
  const noLetters = renderSitemap(boardPosts, 'https://withpluces.com', '2026-10-25');
  assert.ok(!noLetters.includes('/letter<'), 'empty letter archive left out while there is nothing to read');
});

test('home page gets the latest posts as /post links in the first HTML, 5 per page with page links', () => {
  const html = '<ul class="feed-list" id="feed-list" aria-live="polite">\n            <li class="skeleton"></li><li class="skeleton"></li>\n          </ul>\n          <nav class="feed-pager" id="feed-pager" aria-label="페이지"></nav>';
  const withIssue = [...boardPosts, { ...boardPosts[0], no: 99, board: 'issue', createdAt: '2026-12-01T00:00:00Z' }];
  const out = injectLatestPosts(html, withIssue);
  const shown = text => (text.match(/<li class="feed-item"><a class="feed-link" href="\/post\/(\d+)">/g) || []).map(item => Number(item.match(/\d+/)[0]));
  assert.ok(!out.includes('skeleton'));
  assert.deepEqual(shown(out), [12, 11, 10, 9, 8], 'newest 5 first');
  assert.ok(!out.includes('href="/post/99"'), 'issue reviews stay out like the live feed');
  assert.match(out, /\[기획재정부\] 12번째 글 &lt;b&gt;제목&lt;\/b&gt;/);
  assert.match(out, /<span aria-current="page">1<\/span><a href="\/\?page=2#latest-section">2<\/a><a href="\/\?page=3#latest-section">3<\/a><a href="\/\?page=2#latest-section" rel="next">다음 ›<\/a><\/nav>/);
  const third = injectLatestPosts(html, withIssue, 3);
  assert.deepEqual(shown(third), [2, 1]);
  assert.match(third, /<a href="\/\?page=2#latest-section" rel="prev">‹ 이전<\/a><a href="\/#latest-section">1<\/a>/);
  assert.deepEqual(shown(injectLatestPosts(html, withIssue, 9)), [12, 11, 10, 9, 8], 'out of range shows page 1');
  assert.match(injectLatestPosts(html, boardPosts.slice(0, 3)), /<nav class="feed-pager" id="feed-pager" aria-label="페이지"><\/nav>/, 'no page links for one page');
  assert.equal(injectLatestPosts(html, []), html, 'keeps the placeholder when there are no posts');
  assert.equal(injectLatestPosts('<p>다른 화면</p>', boardPosts), '<p>다른 화면</p>');
  const home = require('node:fs').readFileSync(require('node:path').join(__dirname, 'public', 'index.html'), 'utf8');
  assert.match(injectLatestPosts(home, boardPosts), /<li class="feed-item"><a class="feed-link" href="\/post\/12">/, 'matches the real home page');
});
