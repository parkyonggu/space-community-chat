// 게시글 개별 페이지(withpluces.com/post/번호)와 검색엔진 지도(sitemap.xml)를 서버에서 만든다.
// 검색엔진·애드센스 심사 로봇이 자바스크립트 없이도 글 내용을 읽을 수 있게 하는 것이 목적이다.

const BOARD_INFO = {
  community: { name: '소통·나눔', anchor: 'community-section' },
  voice: { name: '시민의 소리', anchor: 'voice-section' },
  policy: { name: '정책 제안', anchor: 'policy-section' },
};
const DEPARTMENTS = { economy: '기획재정부', industry: '산업통상자원부', finance: '금융위원회', sme: '중소벤처기업부', education: '교육부',
  culture: '문화체육관광부', welfare: '보건복지부', labor: '고용노동부', gender: '여성가족부', environment: '환경부', foreign: '외교부',
  unification: '통일부', defense: '국방부', science: '과학기술정보통신부', landtransport: '국토교통부', agriculture: '농림축산식품부',
  ocean: '해양수산부', safety: '행정안전부', justice: '법무부', personnel: '인사혁신처' };

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const kstDate = iso => {
  const date = new Date(Date.parse(iso) + 9 * 60 * 60 * 1000);
  return `${date.getUTCFullYear()}년 ${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일`;
};
const categoryLabel = post => (post.board === 'policy' ? DEPARTMENTS[post.category] || post.category : post.category) || '';

// 제목이 없는 글은 첫 줄(마크다운 기호 제거)을 제목으로 쓴다.
function headlineOf(post) {
  if (post.title) return post.title.trim().slice(0, 80);
  const first = String(post.text || '').split('\n').map(line => line.replace(/^[\s•\-*#>]+/, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim()).find(Boolean) || '제목 없는 글';
  // 첫 줄을 따옴표·별표로 감싼 제목("…", '…', *…*)은 감싼 기호를 떼고 쓴다.
  const bracketed = /^\[[^\]]+\]$/.test(first);
  const wrapped = /^["'“‘*]/.test(first);
  const cleaned = (bracketed ? first.slice(1, -1) : wrapped ? first.replace(/^["'“”‘’*\s]+|["'“”‘’*\s]+$/g, '') : first).replace(/\*\*/g, '').trim() || first;
  return cleaned.length > 60 ? `${cleaned.slice(0, 58)}…` : cleaned;
}
function summaryOf(post, max = 150) {
  const plain = String(post.text || '').replace(/\[([^\]]*)\]\((https?:[^)]+)\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/[#*>•]/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

// 본문: 이스케이프한 뒤 [글](주소)·맨 주소를 링크로, 빈 줄로 문단을 나눈다. 외부 링크는 nofollow ugc.
function bodyHtml(text) {
  const link = (url, label) => `<a href="${escapeHtml(url)}" rel="nofollow ugc noopener" target="_blank">${label}</a>`;
  const inline = line => {
    const parts = [];
    let rest = line;
    const pattern = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+)/;
    let match;
    while ((match = pattern.exec(rest))) {
      parts.push(escapeHtml(rest.slice(0, match.index)));
      if (match[2]) parts.push(link(match[2], escapeHtml(match[1])));
      else {
        const url = match[3].replace(/[.,)\]]+$/, '');
        parts.push(link(url, escapeHtml(url)));
        rest = rest.slice(match.index + url.length);
        continue;
      }
      rest = rest.slice(match.index + match[0].length);
    }
    parts.push(escapeHtml(rest));
    return parts.join('');
  };
  return String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/).map(block => block.trim()).filter(Boolean)
    .map(block => `<p>${block.split('\n').map(inline).join('<br>')}</p>`).join('\n');
}

const shell = ({ title, description, canonical, head = '', body, siteUrl, noindex = false }) => `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  ${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${escapeHtml(canonical)}">`}
  <link rel="icon" href="/icons/icon-512.png" type="image/png" sizes="512x512">
  <meta name="theme-color" content="#0e1730">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <meta property="og:site_name" content="스페이스 커뮤니티">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${escapeHtml(siteUrl)}/icons/icon-512.png">
  ${canonical ? `<meta property="og:url" content="${escapeHtml(canonical)}">` : ''}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800&display=swap">
  <link rel="stylesheet" href="/portal.css">
  <link rel="stylesheet" href="/page.css">
  ${noindex ? '' : '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3255503954415485" crossorigin="anonymous"></script>'}
  <style>
    .post-meta { color:#c9d0e3; font-size:14px; margin:8px 0 0; }
    .post-meta .tag { display:inline-block; background:rgba(245,185,65,.18); color:#f5b941; border-radius:6px; padding:1px 8px; font-weight:800; margin-right:6px; }
    .post-body { font-size:17px; line-height:1.85; color:var(--ink); word-break:keep-all; overflow-wrap:anywhere; }
    .post-body p { margin:0 0 1.1em; }
    .post-body a { color:var(--primary); }
    .post-foot { display:flex; flex-wrap:wrap; gap:10px; margin-top:22px; padding-top:16px; border-top:1px solid var(--line-soft); align-items:center; }
    .post-foot .likes { color:var(--up); font-weight:800; margin-right:auto; }
    .related h2 { font-size:18px; margin:0 0 10px; }
    .related ul { list-style:none; margin:0; padding:0; }
    .related li { border-top:1px solid var(--line-soft); }
    .related a { display:flex; justify-content:space-between; gap:12px; padding:11px 0; color:var(--ink); text-decoration:none; }
    .related a:hover span:first-child { color:var(--primary); text-decoration:underline; }
    .related small { color:var(--muted); white-space:nowrap; }
    .crumbs { font-size:13.5px; }
    .crumbs a { color:#c9d0e3; text-decoration:none; font-weight:700; }
    .crumbs a:hover { color:#fff; }
  </style>
  ${head}
</head>
<body>
${body}
  <footer class="site-footer">
    <div class="wrap footer-inner">
      <div><p class="footer-brand">스페이스 커뮤니티 <span style="font-weight:500;font-size:13px;color:#c9d0e3">스페이스커뮤니티 · withpluces.com</span></p><p>운영: (주)위드플러시아 · 문의: <a href="mailto:dragon600120@gmail.com" style="color:#fff">dragon600120@gmail.com</a></p></div>
      <nav class="footer-links" aria-label="사이트 정보"><a href="/about">사이트 소개</a><a href="/terms">이용약관</a><a href="/privacy"><strong>개인정보처리방침</strong></a><a href="/letter">지난 레터</a></nav>
    </div>
  </footer>
</body>
</html>`;

function renderPostPage({ post, related = [] }, siteUrl = 'https://withpluces.com') {
  const board = BOARD_INFO[post.board] || { name: '게시판', anchor: 'boards' };
  const headline = headlineOf(post);
  const url = `${siteUrl}/post/${post.no}`;
  const category = categoryLabel(post);
  const description = summaryOf(post) || `${board.name} 게시판의 글입니다.`;
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'DiscussionForumPosting', headline, url, mainEntityOfPage: url,
    articleBody: summaryOf(post, 500), datePublished: post.createdAt, dateModified: post.editedAt || post.createdAt,
    author: { '@type': 'Person', name: post.authorName || '회원' },
    publisher: { '@type': 'Organization', name: '스페이스 커뮤니티', url: siteUrl },
    interactionStatistic: { '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: post.likes || 0 },
    isPartOf: { '@type': 'WebPage', name: `${board.name} · 스페이스 커뮤니티`, url: `${siteUrl}/#${board.anchor}` },
  };
  const relatedHtml = related.length ? `
    <section class="page-card related" aria-labelledby="related-title" style="margin-top:16px">
      <h2 id="related-title">${escapeHtml(board.name)}의 다른 글</h2>
      <ul>${related.map(entry => `<li><a href="/post/${entry.no}"><span>${escapeHtml(headlineOf(entry))}</span><small>${kstDate(entry.createdAt)}</small></a></li>`).join('')}</ul>
    </section>` : '';
  const body = `
  <header class="page-head">
    <div class="page-wrap">
      <p class="crumbs"><a href="/">스페이스 커뮤니티</a> › <a href="/#${board.anchor}">${escapeHtml(board.name)}</a></p>
      <h1>${escapeHtml(headline)}</h1>
      <p class="post-meta">${category ? `<span class="tag">${escapeHtml(category)}</span>` : ''}${escapeHtml(post.authorName || '회원')} · <time datetime="${escapeHtml(post.createdAt)}">${kstDate(post.createdAt)}</time>${post.editedAt ? ' · 수정됨' : ''}</p>
    </div>
  </header>
  <main class="page-wrap page-body">
    <article class="page-card">
      <div class="post-body">
${bodyHtml(post.text)}
      </div>
      <div class="post-foot">
        <span class="likes">♥ 공감 ${post.likes || 0}</span>
        <a class="btn btn-primary" href="/#${board.anchor}">${escapeHtml(board.name)}에서 공감·댓글 남기기</a>
        <a class="btn btn-outline" href="/">커뮤니티 홈</a>
      </div>
      <p class="note">이 글은 회원이 작성한 글로, 작성자 개인의 견해이며 운영자의 입장과 다를 수 있습니다. 문제가 있는 글은 게시판의 신고 기능이나 <a href="mailto:dragon600120@gmail.com">dragon600120@gmail.com</a>으로 알려 주세요.</p>
    </article>
    ${relatedHtml}
  </main>`;
  return shell({
    title: `${headline} | ${board.name} · 스페이스 커뮤니티`, description, canonical: url, siteUrl, body,
    head: `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
  });
}

function renderMissingPage(status, siteUrl = 'https://withpluces.com') {
  const message = status === 403 ? '회원만 볼 수 있는 게시판의 글입니다. 로그인한 뒤 게시판에서 읽어 주세요.'
    : status === 410 ? '신고로 숨김 처리되었거나 운영자가 검토 중인 글입니다.'
      : '글을 찾을 수 없습니다. 주소를 다시 확인하거나 커뮤니티 홈에서 찾아 주세요.';
  return shell({
    title: '글을 볼 수 없습니다 · 스페이스 커뮤니티', description: message, canonical: '', siteUrl, noindex: true,
    body: `<header class="page-head"><div class="page-wrap"><a class="back" href="/">← 스페이스 커뮤니티 홈</a><h1>글을 볼 수 없습니다</h1></div></header>
  <main class="page-wrap page-body"><article class="page-card"><p>${escapeHtml(message)}</p><div class="page-cta"><a class="btn btn-primary" href="/">커뮤니티 홈</a></div></article></main>`,
  });
}

const STATIC_PAGES = [
  ['/', 'daily', '1.0'], ['/letter', 'weekly', '0.6'], ['/about', 'monthly', '0.5'], ['/terms', 'yearly', '0.3'], ['/privacy', 'yearly', '0.3'],
];
function renderSitemap(posts, siteUrl = 'https://withpluces.com', today = new Date().toISOString().slice(0, 10)) {
  const urls = [
    ...STATIC_PAGES.map(([path, freq, priority]) => `<url><loc>${siteUrl}${path}</loc><lastmod>${today}</lastmod><changefreq>${freq}</changefreq><priority>${priority}</priority></url>`),
    ...posts.map(post => `<url><loc>${siteUrl}/post/${post.no}</loc><lastmod>${(post.editedAt || post.createdAt).slice(0, 10)}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

module.exports = { renderPostPage, renderMissingPage, renderSitemap, headlineOf, summaryOf, bodyHtml };
