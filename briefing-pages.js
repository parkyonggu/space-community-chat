// 시장동향 브리핑 전문 페이지: 주간은 withpluces.com/briefing/weekly/2026-10-30, 월간은 /briefing/monthly/2026-10.
// 본문 꾸미기는 게시판 글과 같은 규칙(public/rich-text.js: | 로 나눈 표, ## 소제목, **굵게**, 링크)을 쓴다.
// 주간과 월간은 이름·주소·목록을 따로 둔다(한 화면에 '주간·월간'을 섞어 쓰지 않는다).

const { shell, LIST_STYLE } = require('./post-page');
const richText = require('./public/rich-text.js');

const KINDS = {
  weekly: { name: '주간 시장동향', slug: /^\d{4}-\d{2}-\d{2}$/, example: '2026-10-30(금요일 날짜)' },
  monthly: { name: '월간 시장동향', slug: /^\d{4}-\d{2}$/, example: '2026-10(대상 월)' },
};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const kstDate = ms => {
  const date = new Date(ms + 9 * 60 * 60 * 1000);
  return `${date.getUTCFullYear()}년 ${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일`;
};

class BriefingError extends Error {}

// 게시 내용 검사: 잘못된 값이면 BriefingError(이유)
function normalize({ kind, period, title, summary = '', body }) {
  const info = KINDS[kind];
  if (!info) throw new BriefingError("kind는 'weekly'(주간) 또는 'monthly'(월간)만 쓸 수 있습니다.");
  const slug = String(period || '').trim();
  if (!info.slug.test(slug)) throw new BriefingError(`period 형식이 맞지 않습니다. ${info.name}은 ${info.example} 형식입니다.`);
  const cleanTitle = String(title || '').replace(/\s+/g, ' ').trim();
  if (!cleanTitle || cleanTitle.length > 120) throw new BriefingError('제목을 1~120자로 넣어 주세요.');
  const cleanBody = String(body || '').replace(/\r\n?/g, '\n').trim();
  if (!cleanBody || cleanBody.length > 120000) throw new BriefingError('본문을 1~120,000자로 넣어 주세요.');
  const cleanSummary = String(summary || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return { kind, slug, title: cleanTitle, summary: cleanSummary, body: cleanBody };
}

const pathOf = (kind, slug) => `/briefing/${kind}${slug ? `/${slug}` : ''}`;

const PAGE_STYLE = `<style>
    .briefing-source { margin:0 0 18px; padding:10px 14px; border-radius:10px; background:#f4f6fb; color:#26324a; font-size:14.5px; line-height:1.6; }
    .briefing-source strong { color:#1d3b8a; }
    .briefing-note { margin:26px 0 0; padding:14px 16px; border-radius:10px; background:#fff8e6; border:1px solid #f3dca2; color:#5b4a1d; font-size:14px; line-height:1.7; }
    .share-btn.talk { background:#0e1730; color:#f5b941; border:2px solid #f5b941; text-decoration:none; }
    .briefing-kinds { display:flex; flex-wrap:wrap; gap:8px; margin:14px 0 0; }
    .briefing-kinds a, .briefing-kinds span { display:inline-flex; align-items:center; min-height:36px; padding:0 14px; border-radius:999px; font-weight:800; font-size:14px; text-decoration:none; }
    .briefing-kinds a { color:#fff; border:1px solid rgba(255,255,255,.35); }
    .briefing-kinds span { background:#f5b941; color:#0e1730; }
    .post-body h2, .post-body .rt-h { scroll-margin-top:12px; }
    /* 휴대폰에서도 표가 옆으로 잘리지 않게: 칸 안에서 줄을 바꾼다 */
    .briefing-body .rt-table th, .briefing-body .rt-table td { white-space:normal; word-break:keep-all; }
    .briefing-body .rt-table td.num { white-space:nowrap; }
    .briefing-body .rt-table th:first-child, .briefing-body .rt-table td:first-child { min-width:6em; }
    @media (max-width: 560px) {
      .briefing-body .rt-table table { font-size:calc(13.5px * var(--fs, 1)); }
      .briefing-body .rt-table th, .briefing-body .rt-table td { padding:6px 7px; }
    }
  </style>`;

const kindNav = current => `<nav class="briefing-kinds" aria-label="브리핑 종류"><a href="/briefing">전체</a>${Object.entries(KINDS).map(([kind, info]) => kind === current
  ? `<span aria-current="page">${info.name}</span>` : `<a href="${pathOf(kind)}">${info.name}</a>`).join('')}</nav>`;

const NOTE = '이 브리핑은 공개된 시장 자료를 바탕으로 스페이스커뮤니티가 제공하는 정보이며, 특정 종목의 매수·매도를 권유하지 않습니다. 투자 판단과 책임은 투자자 본인에게 있습니다. 자료 수집·정리에는 AI 도구를 활용했습니다.';

function renderBriefingPage({ report, others = [] }, siteUrl = 'https://withpluces.com', { preview = false } = {}) {
  const info = KINDS[report.kind];
  const url = `${siteUrl}${pathOf(report.kind, report.slug)}`;
  const description = report.summary || `${info.name} · ${report.title} — 스페이스커뮤니티 제공`;
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'Article', headline: report.title, url, mainEntityOfPage: url,
    datePublished: new Date(report.publishedAt).toISOString(), dateModified: new Date(report.updatedAt).toISOString(),
    author: { '@type': 'Organization', name: '스페이스커뮤니티' }, publisher: { '@type': 'Organization', name: '스페이스커뮤니티', url: siteUrl },
  };
  const list = others.filter(entry => entry.slug !== report.slug).slice(0, 8);
  return shell({
    title: `${preview ? '[검토 중] ' : ''}${report.title} | ${info.name} · 스페이스커뮤니티`, description, canonical: url, siteUrl, noindex: preview,
    head: `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>${LIST_STYLE}${PAGE_STYLE}`,
    body: `
  <header class="page-head">
    <div class="page-wrap">
      <p class="crumbs"><a href="/">스페이스 커뮤니티</a> › <a href="/briefing">시장동향 브리핑</a> › <a href="${pathOf(report.kind)}">${info.name}</a></p>
      <h1 class="post-title">${escapeHtml(report.title)}</h1>
      <p class="post-meta"><span class="tag">${info.name}</span>${kstDate(report.publishedAt)} 발행 · 제공 스페이스커뮤니티</p>
    </div>
  </header>
  <main class="page-wrap page-body">
    <article class="page-card">
      <div class="fs-tools" aria-label="글자 크기"><span>글자 크기</span><button type="button" data-fs="down" aria-label="글자 작게">가−</button><button type="button" data-fs="reset" aria-pressed="true">보통</button><button type="button" data-fs="up" aria-label="글자 크게">가+</button></div>
      ${preview ? '<p class="briefing-note" style="margin:0 0 18px;font-weight:700">🔒 운영자 검토용 미리보기입니다. 아직 공개·발송되지 않았습니다. 뉴스레터 관리 화면의 \'발송승인\' 탭에서 승인하면 공개되고 스페이스톡·이메일·슬랙으로 나갑니다.</p>' : ''}
      <p class="briefing-source"><strong>스페이스커뮤니티 ${info.name} 브리핑</strong> · 수치마다 출처 링크를 달았습니다.</p>
      <div class="post-body briefing-body">
${richText.toHtml(report.body)}
      </div>
      <p class="briefing-note">${escapeHtml(NOTE)}</p>
      <div class="share-row"><span class="share-label">함께 보기</span><button type="button" class="share-btn kakao" data-share-kakao>카카오톡 공유</button><a class="share-btn naver" href="https://share.naver.com/web/shareView?url=${encodeURIComponent(url)}&title=${encodeURIComponent(report.title)}" target="_blank" rel="noopener" title="네이버 블로그·카페·밴드로 공유">N 네이버 블로그·카페</a><a class="share-btn talk" href="/chat">💬 스페이스톡에서 받아 보기</a><button type="button" class="share-btn copy" data-share-copy>주소 복사</button></div>
      <div class="letter-cta"><a class="btn btn-primary" href="/#newsletter-section">이메일로 받아 보기</a><a class="btn btn-outline" href="${pathOf(report.kind)}">${info.name} 전체 보기</a></div>
    </article>${list.length ? `
    <section class="page-card related" aria-labelledby="related-title" style="margin-top:16px">
      <h2 id="related-title">지난 ${info.name}</h2>
      <ul>${list.map(entry => `<li><a href="${pathOf(entry.kind, entry.slug)}"><span>${escapeHtml(entry.title)}</span><small>${kstDate(entry.publishedAt)}</small></a></li>`).join('')}</ul>
    </section>` : ''}
  </main>`,
  });
}

function renderBriefingList(kind, reports, siteUrl = 'https://withpluces.com') {
  const info = KINDS[kind];
  const list = reports.length ? `<ul class="entry-list">${reports.map(entry => `
        <li><h2><a href="${pathOf(entry.kind, entry.slug)}">${escapeHtml(entry.title)}</a></h2>${entry.summary ? `<p>${escapeHtml(entry.summary)}</p>` : ''}<small>${kstDate(entry.publishedAt)} 발행</small></li>`).join('')}
      </ul>` : `<p>아직 발행된 ${info.name} 브리핑이 없습니다.</p>`;
  return shell({
    title: `${info.name} 브리핑 | 스페이스커뮤니티`, canonical: `${siteUrl}${pathOf(kind)}`, siteUrl, noindex: !reports.length,
    description: `스페이스커뮤니티가 제공하는 ${info.name} 브리핑을 모아 볼 수 있습니다.`,
    head: `${LIST_STYLE}${PAGE_STYLE}`,
    body: `
  <header class="page-head">
    <div class="page-wrap">
      <p class="crumbs"><a href="/">스페이스 커뮤니티</a> › <a href="/briefing">시장동향 브리핑</a> › ${info.name}</p>
      <h1>${info.name} 브리핑</h1>
      <p class="post-meta">제공 스페이스커뮤니티</p>
      ${kindNav(kind)}
    </div>
  </header>
  <main class="page-wrap page-body">
    <section class="page-card">
      ${list}
      <p class="briefing-note">${escapeHtml(NOTE)}</p>
    </section>
  </main>`,
  });
}


// 시장동향 브리핑 첫 화면(/briefing): 월간과 주간을 한 화면에 나눠 보여 준다(섞지 않고 칸을 따로 둔다).
function renderBriefingHub({ weekly = [], monthly = [] }, siteUrl = 'https://withpluces.com') {
  const block = (kind, reports, limit) => {
    const info = KINDS[kind];
    const items = reports.slice(0, limit);
    const list = items.length ? `<ul class="entry-list">${items.map(entry => `
          <li><h3><a href="${pathOf(entry.kind, entry.slug)}">${escapeHtml(entry.title)}</a></h3>${entry.summary ? `<p>${escapeHtml(entry.summary)}</p>` : ''}<small>${kstDate(entry.publishedAt)} 발행</small></li>`).join('')}
        </ul>` : `<p>아직 발행된 ${info.name} 브리핑이 없습니다.</p>`;
    const more = reports.length > limit ? `<p class="hub-more"><a href="${pathOf(kind)}">${info.name} 전체 보기 ›</a></p>` : '';
    return `<section class="page-card hub-block" id="${kind}">
      <h2>${kind === 'monthly' ? '📅' : '📈'} ${info.name}</h2>
      <p class="post-meta">${kind === 'monthly' ? '매월 1일 아침 · 지난 한 달 시장 흐름' : '매주 토요일 아침 · 지난 한 주 시장 흐름'}</p>
      ${list}${more}
    </section>`;
  };
  return shell({
    title: '시장동향 브리핑 | 스페이스커뮤니티', canonical: `${siteUrl}/briefing`, siteUrl, noindex: !weekly.length && !monthly.length,
    description: '스페이스커뮤니티가 제공하는 월간·주간 시장동향 브리핑을 한곳에서 볼 수 있습니다.',
    head: `${LIST_STYLE}${PAGE_STYLE}<style>.hub-block h2{margin:0 0 4px;font-size:1.25rem}.hub-block h3{margin:0 0 4px;font-size:1.05rem}.hub-block+.hub-block{margin-top:18px}.hub-more a{font-weight:800}</style>`,
    body: `
  <header class="page-head">
    <div class="page-wrap">
      <p class="crumbs"><a href="/">스페이스 커뮤니티</a> › 시장동향 브리핑</p>
      <h1>시장동향 브리핑</h1>
      <p class="post-meta">제공 스페이스커뮤니티</p>
      <nav class="briefing-kinds" aria-label="브리핑 종류"><a href="#monthly">📅 월간 시장동향</a><a href="#weekly">📈 주간 시장동향</a></nav>
    </div>
  </header>
  <main class="page-wrap page-body">
    ${block('monthly', monthly, 3)}
    ${block('weekly', weekly, 6)}
    <section class="page-card"><p class="briefing-note">${escapeHtml(NOTE)}</p></section>
  </main>`,
  });
}

// SQLite(Durable Object)에 브리핑을 보관한다.
// 발송승인: 승인 모드에서 새로 올라온 브리핑은 status='pending'(목록·검색에 안 보이고 미리보기 토큰으로만 열림).
// 운영자가 관리 화면 '발송승인' 탭에서 승인하면 'approved'가 되어 공개되고 스페이스톡·메일·슬랙으로 나간다.
function createBriefingStore(sql, now = Date.now, newToken = () => crypto.randomUUID().replace(/-/g, '')) {
  sql.exec('CREATE TABLE IF NOT EXISTS briefings (kind TEXT NOT NULL, slug TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL, published_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (kind, slug))');
  let columns = null;
  try { columns = new Set([...sql.exec('PRAGMA table_info(briefings)')].map(row => row.name)); } catch { columns = null; }
  const addColumn = (name, definition) => {
    if (columns && columns.has(name)) return;
    try { sql.exec(`ALTER TABLE briefings ADD COLUMN ${name} ${definition}`); } catch (error) { if (columns) throw error; /* 이미 있는 칸 */ }
  };
  addColumn('status', "TEXT NOT NULL DEFAULT 'approved'");
  addColumn('preview_token', "TEXT NOT NULL DEFAULT ''");
  addColumn('mail', "TEXT NOT NULL DEFAULT ''");
  addColumn('approved_at', 'INTEGER');
  addColumn('result', "TEXT NOT NULL DEFAULT ''");
  const parse = value => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
  const view = row => ({
    kind: row.kind, slug: row.slug, title: row.title, summary: row.summary, body: row.body, publishedAt: row.published_at, updatedAt: row.updated_at,
    status: row.status || 'approved', previewToken: row.preview_token || '', mail: parse(row.mail), approvedAt: row.approved_at ?? null, result: parse(row.result),
  });
  const one = (kind, slug) => { const row = [...sql.exec('SELECT * FROM briefings WHERE kind = ? AND slug = ?', kind, slug)][0]; return row ? view(row) : null; };
  return {
    upsert(input, { pending = false } = {}) {
      const entry = normalize(input);
      const at = now();
      const existing = one(entry.kind, entry.slug);
      if (existing) sql.exec('UPDATE briefings SET title = ?, summary = ?, body = ?, updated_at = ? WHERE kind = ? AND slug = ?', entry.title, entry.summary, entry.body, at, entry.kind, entry.slug);
      else sql.exec('INSERT INTO briefings (kind, slug, title, summary, body, published_at, updated_at, status, preview_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        entry.kind, entry.slug, entry.title, entry.summary, entry.body, at, at, pending ? 'pending' : 'approved', pending ? newToken() : '');
      const saved = one(entry.kind, entry.slug);
      return { ...entry, updated: Boolean(existing), path: pathOf(entry.kind, entry.slug), status: saved.status, previewToken: saved.previewToken };
    },
    // 승인 전 브리핑은 미리보기 토큰이 맞을 때만 돌려준다.
    get(kind, slug, { preview = '', includePending = false } = {}) {
      const report = one(kind, slug);
      if (!report) return null;
      if (report.status !== 'approved' && !includePending && !(preview && preview === report.previewToken)) return null;
      return report;
    },
    list(kind, limit = 60) {
      return [...sql.exec("SELECT kind, slug, title, summary, published_at, updated_at, status, '' AS body, '' AS preview_token, '' AS mail, approved_at, '' AS result FROM briefings WHERE kind = ? AND status = 'approved' ORDER BY slug DESC LIMIT ?", kind, limit)].map(view);
    },
    // 발송승인 탭: 승인 대기 전부 + 최근 승인 몇 건
    approvals(recent = 6) {
      const pending = [...sql.exec("SELECT * FROM briefings WHERE status = 'pending' ORDER BY updated_at DESC")].map(view);
      const done = [...sql.exec("SELECT * FROM briefings WHERE status = 'approved' AND approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT ?", recent)].map(view);
      return { pending, done };
    },
    setMail(kind, slug, mail) {
      sql.exec('UPDATE briefings SET mail = ? WHERE kind = ? AND slug = ?', JSON.stringify(mail), kind, slug);
    },
    approve(kind, slug) {
      const at = now();
      sql.exec("UPDATE briefings SET status = 'approved', approved_at = ?, published_at = ? WHERE kind = ? AND slug = ? AND status = 'pending'", at, at, kind, slug);
      return one(kind, slug);
    },
    setResult(kind, slug, result) {
      sql.exec('UPDATE briefings SET result = ? WHERE kind = ? AND slug = ?', JSON.stringify(result), kind, slug);
    },
  };
}

module.exports = { KINDS, BriefingError, normalize, pathOf, renderBriefingPage, renderBriefingList, renderBriefingHub, createBriefingStore };
