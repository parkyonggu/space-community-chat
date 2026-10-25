// 게시글 개별 페이지(withpluces.com/post/번호)와 검색엔진 지도(sitemap.xml)를 서버에서 만든다.
// 검색엔진·애드센스 심사 로봇이 자바스크립트 없이도 글 내용을 읽을 수 있게 하는 것이 목적이다.

const BOARD_INFO = {
  community: { name: '소통·나눔', anchor: 'community-section' },
  voice: { name: '시민의 소리', anchor: 'voice-section' },
  policy: { name: '정책 제안', anchor: 'policy-section' },
  issue: { name: '오늘의 이슈 평론', anchor: 'issue-panel' },
  research: { name: '칼럼·학술', anchor: 'research-section' },
};
const DEPARTMENTS = { economy: '기획재정부', industry: '산업통상자원부', finance: '금융위원회', sme: '중소벤처기업부', education: '교육부',
  culture: '문화체육관광부', welfare: '보건복지부', labor: '고용노동부', gender: '여성가족부', environment: '환경부', foreign: '외교부',
  unification: '통일부', defense: '국방부', science: '과학기술정보통신부', landtransport: '국토교통부', agriculture: '농림축산식품부',
  ocean: '해양수산부', safety: '행정안전부', justice: '법무부', personnel: '인사혁신처' };

const richText = require('./public/rich-text.js');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const kstDate = iso => {
  const date = new Date(Date.parse(iso) + 9 * 60 * 60 * 1000);
  return `${date.getUTCFullYear()}년 ${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일`;
};
// 목록 페이지(withpluces.com/board/이름)가 있는 게시판. 오늘의 이슈 평론은 첫 화면 이슈 판에서만 모아 본다.
const LIST_BOARDS = ['community', 'voice', 'policy', 'research'];
const PAGE_SIZE = 5;
const boardHref = board => (LIST_BOARDS.includes(board) ? `/board/${board}` : `/#${(BOARD_INFO[board] || { anchor: 'boards' }).anchor}`);
const categoryLabel = post => (post.board === 'policy' ? DEPARTMENTS[post.category] || post.category : post.category) || '';

// 제목이 없는 글은 첫 줄(마크다운 기호 제거)을 제목으로 쓴다.
function headlineOf(post) {
  if (post.title) return post.title.trim().slice(0, 80);
  const first = String(post.text || '').split('\n').map(line => line.replace(/^[\s•\-*#>]+/, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim()).find(Boolean) || '제목 없는 글';
  // 첫 줄을 따옴표·별표로 감싼 제목("…", '…', *…*)은 감싼 기호를 떼고 쓴다.
  const bracketed = /^\[[^\]]+\]$/.test(first);
  const wrapped = /^["'“‘*]/.test(first);
  const cleaned = (bracketed ? first.slice(1, -1) : wrapped ? first.replace(/^["'“”‘’*\s]+|["'“”‘’*\s]+$/g, '') : first).replace(/\*\*/g, '').replace(/\s+/g, ' ').trim() || first;
  return cleaned.length > 60 ? `${cleaned.slice(0, 58)}…` : cleaned;
}
function summaryOf(post, max = 150) {
  const plain = richText.plain(post.text || '', { tables: false }).replace(/\[([^\]]*)\]\((https?:[^)]+)\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/[#*>•]/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

// 본문: 이스케이프한 뒤 링크·표·소제목(##, ■)·밑줄(__ __)·굵게(** **)를 꾸민다(public/rich-text.js, 화면과 같은 규칙).
function bodyHtml(text) {
  return richText.toHtml(text);
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
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800&family=Nanum+Myeongjo:wght@400;700&display=swap">
  <link rel="stylesheet" href="/portal.css">
  <link rel="stylesheet" href="/page.css">
  ${noindex ? '' : '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3255503954415485" crossorigin="anonymous"></script>'}
  <style>
    .page-head h1.post-title { text-decoration:underline; text-decoration-color:#f5b941; text-decoration-thickness:3px; text-underline-offset:8px; text-decoration-skip-ink:none; line-height:1.5; }
    .post-meta { color:#c9d0e3; font-size:14px; margin:8px 0 0; }
    .post-meta .tag { display:inline-block; background:rgba(245,185,65,.18); color:#f5b941; border-radius:6px; padding:1px 8px; font-weight:800; margin-right:6px; }
    .issue-ref { margin:0 0 18px; padding:12px 14px; border-left:4px solid #f5b941; background:rgba(245,185,65,.10); border-radius:8px; font-size:14px; color:var(--muted, #5b6478); line-height:1.6; }
    .issue-ref a { color:var(--ink); font-weight:700; font-size:16px; }
    .post-photos { display:grid; gap:8px; margin:18px 0 6px; }
    .post-photos a { display:block; border-radius:10px; overflow:hidden; background:#111; }
    .post-photos img { width:100%; max-height:560px; object-fit:contain; display:block; }
    .forward-line { margin:16px 0 0; padding:10px 14px; border-radius:10px; background:#f2f5ff; border:1px solid #c5d0f0; color:#1d3b8a; font-weight:700; font-size:14.5px; }
    .progress-box { margin:16px 0 4px; padding:12px 14px; border-radius:10px; background:#eef7ee; border:1px solid #cfe6cf; font-size:14.5px; }
    .progress-head { margin:0; color:#245a2a; }
    .progress-answer { margin:8px 0 0; color:var(--ink); line-height:1.7; }
    .official-note { margin-top:14px; }
    .post-body { font-size:calc(17px * var(--fs, 1)); line-height:1.85; color:var(--ink); word-break:keep-all; overflow-wrap:anywhere; }
    .post-body p { margin:0 0 1.1em; }
    .post-body.poem { font-family:"Nanum Myeongjo","Noto Serif KR","Batang",serif; font-size:calc(18px * var(--fs, 1)); line-height:2.1; }
    .post-body a { color:var(--primary); }
    .post-body .rt-h { margin:1.6em 0 .7em; font-size:calc(19px * var(--fs, 1)); line-height:1.5; padding-bottom:6px; border-bottom:2px solid var(--primary, #1d3b8a); }
    .post-body u { text-decoration-thickness:2px; text-underline-offset:3px; }
    .rt-table { overflow-x:auto; margin:0 0 1.2em; -webkit-overflow-scrolling:touch; }
    .rt-table table { border-collapse:collapse; min-width:100%; font-size:calc(15px * var(--fs, 1)); line-height:1.5; }
    .rt-table th, .rt-table td { border:1px solid #d6dbe6; padding:7px 10px; text-align:left; white-space:nowrap; }
    .rt-table th { background:#eef2f9; font-weight:800; }
    .rt-table td.num { text-align:right; font-variant-numeric:tabular-nums; }
    .rt-table tbody tr:nth-child(even) td { background:#fafbfd; }
    .post-foot { display:flex; flex-wrap:wrap; gap:10px; margin-top:22px; padding-top:16px; border-top:1px solid var(--line-soft); align-items:center; }
    .post-foot .likes { color:var(--up); font-weight:800; margin-right:auto; }
    .related h2 { font-size:18px; margin:0 0 10px; }
    .related ul { list-style:none; margin:0; padding:0; }
    .related li { border-top:1px solid var(--line-soft); }
    .related a { display:flex; justify-content:space-between; gap:12px; padding:11px 0; color:var(--ink); text-decoration:none; }
    .related a:hover span:first-child { color:var(--primary); text-decoration:underline; }
    .related small { color:var(--muted); white-space:nowrap; }
    .crumbs { font-size:13.5px; }
    .share-row { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:22px 0 4px; padding:14px; border-radius:12px; background:#f4f6fb; }
    .share-label { font-weight:800; color:#0e1730; margin-right:4px; }
    .share-btn { display:inline-flex; align-items:center; min-height:42px; padding:0 16px; border-radius:10px; border:0; font:inherit; font-weight:800; font-size:15px; text-decoration:none; cursor:pointer; }
    .share-btn.naver { background:#03c75a; color:#fff; }
    .share-btn.kakao { background:#fee500; color:#191919; }
    .share-btn.copy { background:#fff; color:#1d3b8a; border:1px solid #c5d0f0; }
    .fs-tools { display:flex; align-items:center; justify-content:flex-end; gap:6px; margin:0 0 14px; font-size:14px; color:var(--muted, #5b6478); }
    .fs-tools button { min-width:46px; min-height:38px; padding:4px 10px; border:1px solid #c5d0f0; border-radius:8px; background:#f2f5ff; color:#1d3b8a; font-weight:800; font-size:15px; cursor:pointer; }
    .fs-tools button[aria-pressed="true"] { background:#1d3b8a; color:#fff; border-color:#1d3b8a; }
    .crumbs a { color:#c9d0e3; text-decoration:none; font-weight:700; }
    .crumbs a:hover { color:#fff; }
  </style>
  ${head}
</head>
<body>
${body}
  <script>(function(){var S=[0.9,1,1.15,1.3,1.5,1.75],K='postFontScale',i=1;try{var v=parseFloat(localStorage.getItem(K));if(S.indexOf(v)>=0)i=S.indexOf(v);}catch(e){}function set(n){i=Math.max(0,Math.min(S.length-1,n));document.documentElement.style.setProperty('--fs',S[i]);var r=document.querySelector('.fs-tools [data-fs=reset]');if(r)r.setAttribute('aria-pressed',S[i]===1?'true':'false');try{localStorage.setItem(K,S[i]);}catch(e){}}set(i);document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('.fs-tools [data-fs]');if(!b)return;var a=b.getAttribute('data-fs');set(a==='up'?i+1:a==='down'?i-1:1);});})();</script>
  <script defer src="/law-ref.js"></script>
  <script defer src="/kakao-share.js"></script>
  <script>document.addEventListener('click',async function(e){var k=e.target.closest&&e.target.closest('[data-share-kakao]'),c=e.target.closest&&e.target.closest('[data-share-copy]');if(!k&&!c)return;var url=location.origin+location.pathname,title=document.title.replace(/ \| .*$/,'');if(k){if(window.spaceKakaoShare&&await window.spaceKakaoShare({title:title,description:(document.querySelector('meta[name=description]')||{}).content||'',imageUrl:location.origin+'/share/info.png',link:url,button:'글 읽기'}))return;}try{await navigator.clipboard.writeText(title+'\n'+url);c=c||k;var t=c.textContent;c.textContent='✓ 복사했어요';setTimeout(function(){c.textContent=t;},2000);}catch(err){prompt('아래 주소를 복사해 주세요.',url);}});</script>
  <script defer src="/agency-links.js"></script>
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
      <p class="crumbs"><a href="/">스페이스 커뮤니티</a> › <a href="${boardHref(post.board)}">${escapeHtml(board.name)}</a></p>
      <h1 class="post-title">${escapeHtml(headline)}</h1>
      <p class="post-meta">${category ? `<span class="tag">${escapeHtml(category)}</span>` : ''}${escapeHtml(post.authorName || '회원')} · <time datetime="${escapeHtml(post.createdAt)}">${kstDate(post.createdAt)}</time>${post.editedAt ? ' · 수정됨' : ''} · 글번호 #${Number(post.no)}</p>
    </div>
  </header>
  <main class="page-wrap page-body">
    <article class="page-card">${post.issue && /^https:\/\//.test(post.issue.link || '') ? `
      <p class="issue-ref">평론한 이슈 · ${escapeHtml(post.issue.date ? `${post.issue.date.slice(4, 6)}월 ${Number(post.issue.date.slice(6, 8))}일` : '')} ${escapeHtml(post.category || '')}<br><a href="${escapeHtml(post.issue.link)}" target="_blank" rel="noopener nofollow">${escapeHtml(post.issue.title)}</a> <small>(${escapeHtml(post.issue.source || '원문')})</small></p>` : ''}${post.about && post.about.no ? `
      <p class="issue-ref">평론한 판결<br><a href="/post/${Number(post.about.no)}">${escapeHtml(post.about.title || '판결 글')}</a></p>` : ''}
      <div class="fs-tools" role="group" aria-label="글자 크기"><span>글자 크기</span><button type="button" data-fs="down" aria-label="글자 작게">가−</button><button type="button" data-fs="reset" aria-label="보통 크기">보통</button><button type="button" data-fs="up" aria-label="글자 크게">가+</button></div>
      <div class="post-body${post.category === '시' ? ' poem' : ''}">
${bodyHtml(post.text)}
      </div>${(post.images || []).filter(id => /^[0-9a-f]{32}$/.test(id)).length ? `
      <div class="post-photos">${post.images.filter(id => /^[0-9a-f]{32}$/.test(id)).map((id, index) => `<a href="/api/board/image?id=${id}" target="_blank" rel="noopener"><img src="/api/board/image?id=${id}" alt="첨부 사진 ${index + 1}" loading="lazy"></a>`).join('')}</div>` : ''}
${post.board === 'voice' && post.forward ? `
      <p class="forward-line">🏛️ ${post.forward.status === '전달함' ? `스페이스 커뮤니티가 ${escapeHtml(post.forward.region)}에 이 의견을 전달했습니다.` : `스페이스 커뮤니티가 ${escapeHtml(post.forward.region)}에 전달하려고 준비 중입니다.`}</p>` : ''}${(post.board === 'voice' || post.board === 'policy') && post.progress ? `
      <div class="progress-box"><p class="progress-head"><b>${escapeHtml(post.progress.status)}</b> ${escapeHtml(post.progress.channel)}${post.progress.receipt ? ` · 접수번호 ${escapeHtml(post.progress.receipt)}` : ''} · ${escapeHtml(kstDate(post.progress.updatedAt))} 기록</p>${post.progress.answer ? `<p class="progress-answer">${escapeHtml(post.progress.answer).replace(/\n/g, '<br>')}</p>` : ''}</div>` : ''}${post.board === 'voice' ? `
      <p class="note official-note">같은 불편을 겪고 계신가요? 시청·군청이 처리하도록 <a href="https://www.epeople.go.kr" target="_blank" rel="noopener">국민신문고</a>(설치·개선 요청)나 <a href="https://www.safetyreport.go.kr" target="_blank" rel="noopener">안전신문고</a>(고장·위험 신고)에 본인 이름으로 함께 접수해 주세요. 커뮤니티 게시판의 「📮 공식 민원으로 보내기」를 누르면 내용을 복사해 드립니다.</p>` : ''}
      <div class="share-row" role="group" aria-label="이 글 공유하기">
        <span class="share-label">이 글 알리기</span>
        <a class="share-btn naver" href="https://share.naver.com/web/shareView?url=${encodeURIComponent(url)}&title=${encodeURIComponent(headline)}" target="_blank" rel="noopener" title="네이버 블로그·카페·밴드로 공유">N 네이버 블로그·카페</a>
        <button class="share-btn kakao" type="button" data-share-kakao>카카오톡</button>
        <button class="share-btn copy" type="button" data-share-copy>주소 복사</button>
      </div>
      <div class="post-foot">
        <span class="likes">♥ 공감 ${post.likes || 0}</span>
        <a class="btn btn-primary" href="/#${board.anchor}">${escapeHtml(post.board === 'issue' ? '오늘의 이슈' : board.name)}에서 ${post.board === 'issue' ? '평론 더 보기·쓰기' : '공감·댓글 남기기'}</a>
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

function renderMissingPage(status, siteUrl = 'https://withpluces.com', custom = '') {
  const message = custom || (status === 403 ? '회원만 볼 수 있는 게시판의 글입니다. 로그인한 뒤 게시판에서 읽어 주세요.'
    : status === 410 ? '신고로 숨김 처리되었거나 운영자가 검토 중인 글입니다.'
      : '글을 찾을 수 없습니다. 주소를 다시 확인하거나 커뮤니티 홈에서 찾아 주세요.');
  return shell({
    title: '글을 볼 수 없습니다 · 스페이스 커뮤니티', description: message, canonical: '', siteUrl, noindex: true,
    body: `<header class="page-head"><div class="page-wrap"><a class="back" href="/">← 스페이스 커뮤니티 홈</a><h1>글을 볼 수 없습니다</h1></div></header>
  <main class="page-wrap page-body"><article class="page-card"><p>${escapeHtml(message)}</p><div class="page-cta"><a class="btn btn-primary" href="/">커뮤니티 홈</a></div></article></main>`,
  });
}

const boardNav = current => `<nav class="board-nav" aria-label="게시판">${LIST_BOARDS.map(board => current === board
  ? `<span aria-current="page">${escapeHtml(BOARD_INFO[board].name)}</span>`
  : `<a href="/board/${board}">${escapeHtml(BOARD_INFO[board].name)}</a>`).join('')}</nav>`;
const LIST_STYLE = `<style>
    .board-nav { display:flex; flex-wrap:wrap; gap:8px; margin:14px 0 0; }
    .board-nav a, .board-nav span { display:inline-flex; align-items:center; min-height:36px; padding:0 14px; border-radius:999px; font-weight:800; font-size:14px; text-decoration:none; }
    .board-nav a { color:#fff; border:1px solid rgba(255,255,255,.35); }
    .board-nav a:hover { background:rgba(255,255,255,.12); }
    .board-nav span { background:#f5b941; color:#0e1730; }
    .entry-list { list-style:none; margin:0; padding:0; }
    .entry-list li { border-bottom:1px solid var(--line-soft); padding:16px 0; }
    .entry-list li:first-child { padding-top:0; }
    .entry-list li:last-child { border-bottom:0; padding-bottom:0; }
    .entry-list h2 { font-size:18px; margin:0 0 6px; line-height:1.5; }
    .entry-list h2 a { color:var(--ink); text-decoration:none; }
    .entry-list h2 a:hover { color:var(--primary); text-decoration:underline; }
    .entry-list p { margin:0 0 6px; color:var(--ink); line-height:1.7; }
    .entry-list small { color:var(--muted); }
    .entry-list .tag { display:inline-block; background:#eef2f9; color:#1d3b8a; border-radius:6px; padding:0 7px; font-weight:800; margin-right:6px; }
    .pager { display:flex; flex-wrap:wrap; justify-content:center; gap:6px; margin:22px 0 0; }
    .pager a, .pager span { display:inline-flex; align-items:center; justify-content:center; min-width:42px; min-height:42px; padding:0 12px; border-radius:10px; font-weight:800; text-decoration:none; }
    .pager a { color:#1d3b8a; background:#f2f5ff; border:1px solid #c5d0f0; }
    .pager span[aria-current] { color:#fff; background:#1d3b8a; }
    .pager .gap { color:var(--muted); min-width:auto; padding:0 2px; }
    .letter-body a { color:var(--primary); }
    .letter-cta { display:flex; flex-wrap:wrap; gap:10px; margin-top:22px; padding-top:16px; border-top:1px solid var(--line-soft); }
  </style>`;

// 페이지 번호: 처음·끝 쪽과 지금 쪽 앞뒤 2쪽, 사이가 비면 …(public/portal.js의 첫 화면 목록도 같은 모양)
function pagerLinks(page, pages, pageUrl) {
  const numbers = [...new Set([1, ...Array.from({ length: 5 }, (_, index) => page - 2 + index), pages])].filter(number => number >= 1 && number <= pages);
  return `${page > 1 ? `<a href="${pageUrl(page - 1)}" rel="prev">‹ 이전</a>` : ''}${numbers.map((number, index) => `${index && number - numbers[index - 1] > 1 ? '<span class="gap">…</span>' : ''}${number === page ? `<span aria-current="page">${number}</span>` : `<a href="${pageUrl(number)}">${number}</a>`}`).join('')}${page < pages ? `<a href="${pageUrl(page + 1)}" rel="next">다음 ›</a>` : ''}`;
}

// 게시판 목록(withpluces.com/board/이름?page=N): 한 페이지에 5개, 숨김·회원 전용 글은 publicPosts에서 이미 빠져 있다.
// 없는 게시판이나 범위를 벗어난 페이지는 null(→ 404).
function renderBoardPage({ board, posts, page = 1 }, siteUrl = 'https://withpluces.com') {
  if (!LIST_BOARDS.includes(board)) return null;
  const info = BOARD_INFO[board];
  const entries = posts.filter(post => post.board === board).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  if (!Number.isInteger(page) || page < 1 || page > pages) return null;
  const pageUrl = number => `/board/${board}${number > 1 ? `?page=${number}` : ''}`;
  const shown = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pager = pages > 1 ? `
      <nav class="pager" aria-label="페이지">${pagerLinks(page, pages, pageUrl)}</nav>` : '';
  const list = shown.length ? `<ul class="entry-list">${shown.map(post => {
    const category = categoryLabel(post);
    return `
        <li><h2><a href="/post/${Number(post.no)}">${escapeHtml(headlineOf(post))}</a></h2>${summaryOf(post) ? `<p>${escapeHtml(summaryOf(post))}</p>` : ''}<small>${category ? `<span class="tag">${escapeHtml(category)}</span>` : ''}${escapeHtml(post.authorName || '회원')} · <time datetime="${escapeHtml(post.createdAt)}">${kstDate(post.createdAt)}</time> · #${Number(post.no)}${post.likes ? ` · ♥ ${post.likes}` : ''}</small></li>`;
  }).join('')}
      </ul>` : '<p>아직 올라온 글이 없습니다. 첫 글을 남겨 주세요.</p>';
  const canonical = `${siteUrl}${pageUrl(page)}`;
  const title = `${info.name}${page > 1 ? ` (${page}쪽)` : ''} · 스페이스 커뮤니티`;
  return shell({
    title, canonical, siteUrl, noindex: !entries.length,
    description: `스페이스 커뮤니티 ${info.name} 게시판의 글 목록입니다. 전체 ${entries.length}개${page > 1 ? `, ${page}쪽` : ''}.`,
    head: `${page > 1 ? `<link rel="prev" href="${siteUrl}${pageUrl(page - 1)}">` : ''}${page < pages ? `<link rel="next" href="${siteUrl}${pageUrl(page + 1)}">` : ''}${LIST_STYLE}`,
    body: `
  <header class="page-head">
    <div class="page-wrap">
      <p class="crumbs"><a href="/">스페이스 커뮤니티</a> › 게시판</p>
      <h1>${escapeHtml(info.name)}</h1>
      <p class="post-meta">전체 ${entries.length}개 · ${page} / ${pages}쪽</p>
      ${boardNav(board)}
    </div>
  </header>
  <main class="page-wrap page-body">
    <section class="page-card">
      ${list}${pager}
      <div class="letter-cta"><a class="btn btn-primary" href="/#${info.anchor}">${escapeHtml(info.name)}에 글쓰기·공감하기</a><a class="btn btn-outline" href="/">커뮤니티 홈</a></div>
    </section>
  </main>`,
  });
}

const letterDay = iso => kstDate(iso);
// 지난 레터 목록(withpluces.com/letter). 레터가 하나도 없으면 얇은 페이지가 되므로 noindex.
function renderLetterList(letters, siteUrl = 'https://withpluces.com') {
  const list = letters.length ? `<ul class="entry-list">${letters.map(letter => `
        <li><h2><a href="/letter/${escapeHtml(letter.slug)}">${escapeHtml(letter.subject)}</a></h2><small><time datetime="${escapeHtml(letter.sentAt)}">${letterDay(letter.sentAt)}</time> 발행</small></li>`).join('')}
      </ul>` : '<p>아직 발행된 레터가 없습니다. 첫 레터는 다가오는 월요일 아침 7시에 발행됩니다.</p>';
  return shell({
    title: '스페이스 레터 · 지난 경제·정책 브리핑 | 스페이스 커뮤니티', canonical: `${siteUrl}/letter`, siteUrl, noindex: !letters.length,
    description: "스페이스 커뮤니티가 매주 월요일 발행하는 경제·정책 브리핑 '스페이스 레터'의 지난 호를 모아 볼 수 있습니다.",
    head: LIST_STYLE,
    body: `
  <header class="page-head">
    <div class="page-wrap">
      <p class="crumbs"><a href="/">스페이스 커뮤니티</a> › 스페이스 레터</p>
      <h1>스페이스 레터</h1>
      <p class="post-meta">매주 월요일 아침 7시에 발행하는 경제·정책 브리핑입니다. 지난 레터를 모두 읽을 수 있습니다.</p>
    </div>
  </header>
  <main class="page-wrap page-body">
    <section class="page-card">
      ${list}
      <div class="letter-cta"><a class="btn btn-primary" href="/#newsletter-section">이메일로 구독하기</a><a class="btn btn-outline" href="/">커뮤니티 홈</a></div>
    </section>
  </main>`,
  });
}

// 지난 레터 한 호(withpluces.com/letter/2026-10-26). letter.html은 newsletter-api의 renderMarkup이 이스케이프한 본문이다.
function renderLetterPage({ letter, letters = [] }, siteUrl = 'https://withpluces.com') {
  const url = `${siteUrl}/letter/${letter.slug}`;
  const plain = String(letter.html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[name]).replace(/\s+/g, ' ').trim();
  const description = plain.length > 150 ? `${plain.slice(0, 149)}…` : plain || `${letterDay(letter.sentAt)} 발행 스페이스 레터`;
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'Article', headline: letter.subject, url, mainEntityOfPage: url, datePublished: letter.sentAt,
    author: { '@type': 'Organization', name: '스페이스 커뮤니티' }, publisher: { '@type': 'Organization', name: '스페이스 커뮤니티', url: siteUrl },
  };
  const others = letters.filter(entry => entry.slug !== letter.slug).slice(0, 8);
  return shell({
    title: `${letter.subject} | 스페이스 레터 · 스페이스 커뮤니티`, description, canonical: url, siteUrl,
    head: `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>${LIST_STYLE}`,
    body: `
  <header class="page-head">
    <div class="page-wrap">
      <p class="crumbs"><a href="/">스페이스 커뮤니티</a> › <a href="/letter">스페이스 레터</a></p>
      <h1 class="post-title">${escapeHtml(letter.subject)}</h1>
      <p class="post-meta"><time datetime="${escapeHtml(letter.sentAt)}">${letterDay(letter.sentAt)}</time> 발행 · 스페이스 레터</p>
    </div>
  </header>
  <main class="page-wrap page-body">
    <article class="page-card">
      <div class="post-body letter-body">
${String(letter.html).replace(/<a href="(https?:[^"]+)"/g, '<a href="$1" target="_blank" rel="noopener"')}
      </div>
      <div class="letter-cta"><a class="btn btn-primary" href="/#newsletter-section">이메일로 구독하기</a><a class="btn btn-outline" href="/letter">지난 레터 전체 보기</a></div>
    </article>${others.length ? `
    <section class="page-card related" aria-labelledby="related-title" style="margin-top:16px">
      <h2 id="related-title">다른 호 읽기</h2>
      <ul>${others.map(entry => `<li><a href="/letter/${escapeHtml(entry.slug)}"><span>${escapeHtml(entry.subject)}</span><small>${letterDay(entry.sentAt)}</small></a></li>`).join('')}</ul>
    </section>` : ''}
  </main>`,
  });
}

// 첫 화면: '지금 올라온 글' 자리표시(skeleton)를 최신 공개 글 5개(withpluces.com/?page=N이면 N쪽)와 페이지 번호 링크로 바꿔 둔다.
// 이후 갱신·쪽 넘김은 portal.js가 그대로 덮어쓴다. 범위를 벗어난 쪽은 1쪽을 보여 준다.
function injectLatestPosts(html, posts, page = 1) {
  const pattern = /(<ul class="feed-list" id="feed-list"[^>]*>)\s*(?:<li class="skeleton"><\/li>)+/;
  const entries = posts.filter(post => LIST_BOARDS.includes(post.board)).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  if (!entries.length || !pattern.test(html)) return html;
  const pages = Math.ceil(entries.length / PAGE_SIZE);
  if (!Number.isInteger(page) || page < 1 || page > pages) page = 1;
  const latest = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const items = latest.map(post => {
    const title = post.board === 'policy' && DEPARTMENTS[post.category] ? `[${DEPARTMENTS[post.category]}] ${headlineOf(post)}` : headlineOf(post);
    return `<li class="feed-item"><a class="feed-link" href="/post/${Number(post.no)}"><span class="badge ${post.board}">${escapeHtml(BOARD_INFO[post.board].name)}</span><span class="feed-title">${escapeHtml(title)}</span><span class="feed-meta"><span class="post-no">#${Number(post.no)}</span><span class="author">${escapeHtml(String(post.authorName || '회원').slice(0, 10))}</span><span class="when">${kstDate(post.createdAt)}</span></span></a></li>`;
  }).join('');
  return html.replace(pattern, (_, open) => `${open}\n            ${items}`)
    .replace(/(<nav class="feed-pager" id="feed-pager"[^>]*>)<\/nav>/, (_, open) => `${open}${pages > 1 ? pagerLinks(page, pages, number => `/${number > 1 ? `?page=${number}` : ''}#latest-section`) : ''}</nav>`);
}

const STATIC_PAGES = [
  ['/', 'daily', '1.0'], ['/about', 'monthly', '0.5'], ['/terms', 'yearly', '0.3'], ['/privacy', 'yearly', '0.3'],
];
function renderSitemap(posts, siteUrl = 'https://withpluces.com', today = new Date().toISOString().slice(0, 10), { letters = [] } = {}) {
  const day = iso => iso.slice(0, 10);
  const boards = LIST_BOARDS.map(board => posts.filter(post => post.board === board))
    .filter(entries => entries.length)
    .map(entries => [entries[0].board, entries.map(post => day(post.createdAt)).sort().at(-1)]);
  const urls = [
    ...STATIC_PAGES.map(([path, freq, priority]) => `<url><loc>${siteUrl}${path}</loc><lastmod>${today}</lastmod><changefreq>${freq}</changefreq><priority>${priority}</priority></url>`),
    ...boards.map(([board, lastmod]) => `<url><loc>${siteUrl}/board/${board}</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`),
    ...(letters.length ? [`<url><loc>${siteUrl}/letter</loc><lastmod>${day(letters[0].sentAt)}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>`] : []),
    ...letters.map(letter => `<url><loc>${siteUrl}/letter/${letter.slug}</loc><lastmod>${day(letter.sentAt)}</lastmod><changefreq>yearly</changefreq><priority>0.6</priority></url>`),
    ...posts.map(post => `<url><loc>${siteUrl}/post/${post.no}</loc><lastmod>${(post.editedAt || post.createdAt).slice(0, 10)}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

module.exports = { renderPostPage, renderMissingPage, renderSitemap, renderBoardPage, renderLetterList, renderLetterPage, injectLatestPosts, headlineOf, summaryOf, bodyHtml, LIST_BOARDS, PAGE_SIZE };
