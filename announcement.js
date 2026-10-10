// 광장채팅 '모임안내'·'초청장': 운영자가 [모임안내] 또는 [초청장]으로 시작해 올린 글.
// - 스페이스톡 '📣 모임안내' 채널에 「스페이스 커뮤니티」 이름으로 자동 전달한다.
// - 글마다 공유용 주소(/e/글번호)를 만들어, 카카오톡 등에 보내면 로고·제목이 담긴 미리보기 카드로 보이게 한다.
//   (카카오톡 메시지의 '보낸 사람'은 공유한 사람으로 정해져 있어, 카드 안에 스페이스 커뮤니티 로고와 이름을 싣는다.)

const KINDS = [
  { tag: '[모임안내]', id: 'meeting', label: '📣 모임안내', image: '/share/announcement.png' },
  { tag: '[초청장]', id: 'invitation', label: '💌 초청장', image: '/share/invitation.png' },
];
const ID = /^\d{10,15}-[a-z0-9]{6,16}$/;

const kindOf = text => KINDS.find(kind => typeof text === 'string' && text.trim().startsWith(kind.tag)) || null;

// 첫 줄(표시 뒤)을 제목, 나머지를 본문으로 나눈다.
function parse(text) {
  const kind = kindOf(text);
  if (!kind) return null;
  const lines = text.trim().slice(kind.tag.length).split('\n').map(line => line.trim());
  while (lines.length && !lines[0]) lines.shift();
  const title = (lines.shift() || kind.label.replace(/^\S+\s/, '')).slice(0, 80);
  const body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { kind, title, body };
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function renderAnnouncementPage(record, siteUrl = 'https://withpluces.com') {
  const parsed = parse(record?.text || '');
  if (!parsed) return null;
  const { kind, title, body } = parsed;
  const url = `${siteUrl}/e/${record.id}`;
  const poster = /^[0-9a-f]{32}$/.test(record.image || '') ? `${siteUrl}/api/board/image?id=${record.image}` : '';
  const description = (body.replace(/\s+/g, ' ').slice(0, 110) || '스페이스 커뮤니티가 알려 드립니다.') + (body.length > 110 ? '…' : '');
  const date = new Date(record.at + 9 * 60 * 60 * 1000);
  const dayText = `${date.getUTCFullYear()}년 ${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일 (${'일월화수목금토'[date.getUTCDay()]})`;
  const hours = date.getUTCHours();
  const timeText = `${hours < 12 ? '오전' : '오후'} ${hours % 12 || 12}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
  const bodyHtml = body.split('\n').map(line => (line ? escapeHtml(line) : '')).join('<br>');
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(`${kind.label} ${title}`)} · 스페이스 커뮤니티</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(url)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="스페이스 커뮤니티">
  <meta property="og:title" content="${escapeHtml(`${kind.label} ${title}`)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(url)}">
  <meta property="og:image" content="${escapeHtml(poster || siteUrl + kind.image)}">${poster ? '' : `
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">`}
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/icons/icon-192.png">
  <style>
    :root { --navy:#0e1730; --gold:#f5b941; --ink:#0e1730; --text:#2b3550; --muted:#5d6680; --line:#e3e6ef; }
    * { box-sizing:border-box; }
    html, body { height:100%; }
    body { margin:0; font-family:"Noto Sans KR","Pretendard",system-ui,sans-serif; background:#e9edf4; color:var(--text); -webkit-font-smoothing:antialiased; display:flex; flex-direction:column; }
    /* 스페이스톡 대화방 화면과 같은 모양 */
    .top { flex:none; display:flex; align-items:center; gap:10px; padding:10px 12px; background:var(--navy); color:#fff; }
    .top a.back { color:#fff; text-decoration:none; font-size:22px; padding:2px 8px; }
    .top .room h1 { margin:0; font-size:17px; font-weight:800; }
    .top .room span { display:block; font-size:12px; color:#b9c2dd; }
    .messages { flex:1; width:100%; max-width:760px; margin:0 auto; padding:12px 12px 20px; }
    .day { text-align:center; margin:8px 0 14px; }
    .day span { display:inline-block; padding:3px 12px; border-radius:999px; background:rgba(14,23,48,.08); font-size:12px; color:#4b5470; }
    .msg { display:flex; gap:8px; align-items:flex-start; }
    .avatar { flex:none; width:36px; height:36px; border-radius:13px; margin-top:2px; }
    .msg-body { display:flex; flex-direction:column; max-width:min(86%,520px); min-width:0; }
    .msg-name { font-size:12.5px; color:#2b3550; margin:0 0 4px 2px; }
    .msg-line { display:flex; align-items:flex-end; gap:6px; }
    .time { flex:none; font-size:11px; color:#7a8296; }
    .card { border-radius:4px 14px 14px 14px; overflow:hidden; background:#fff; border:1px solid var(--line); box-shadow:0 1px 1px rgba(14,23,48,.06); }
    .card-head { display:flex; align-items:center; gap:8px; padding:10px 12px; background:var(--navy); color:#fff; }
    .card-head img { width:28px; height:28px; border-radius:8px; border:1.5px solid var(--gold); }
    .card-head strong { font-size:14px; }
    .card-head span { margin-left:auto; font-size:12px; font-weight:800; color:var(--gold); }
    .card .poster { display:block; width:100%; max-height:none; background:#f4f5f9; }
    .card h2 { margin:0; padding:12px 14px 4px; font-size:17px; line-height:1.45; color:var(--ink); word-break:keep-all; }
    .card .body { padding:2px 14px 8px; font-size:15px; line-height:1.7; color:var(--text); word-break:keep-all; overflow-wrap:anywhere; }
    .card .actions { display:flex; flex-wrap:wrap; gap:6px; padding:8px 12px 12px; }
    .btn { display:inline-flex; align-items:center; justify-content:center; min-height:38px; padding:0 14px; border-radius:10px; font-weight:800; font-size:14px; text-decoration:none; border:1px solid var(--line); color:var(--navy); background:#fff; cursor:pointer; font-family:inherit; }
    .btn.kakao { background:#fee500; border-color:#fee500; color:#191919; }
    .bar { flex:none; display:flex; gap:8px; justify-content:center; flex-wrap:wrap; padding:10px 12px calc(10px + env(safe-area-inset-bottom)); background:#fff; border-top:1px solid var(--line); }
    .bar .btn.gold { background:var(--gold); border-color:var(--gold); }
  </style>
</head>
<body>
  <header class="top">
    <a class="back" href="/chat" aria-label="스페이스톡으로">‹</a>
    <div class="room"><h1>📣 모임안내</h1><span>스페이스 커뮤니티 소식 채널</span></div>
  </header>
  <main class="messages">
    <div class="day"><span>${escapeHtml(dayText)}</span></div>
    <div class="msg">
      <img class="avatar" src="/icons/icon-192.png" alt="">
      <div class="msg-body">
        <div class="msg-name">스페이스 커뮤니티</div>
        <div class="msg-line">
          <article class="card">
            <div class="card-head"><img src="/icons/icon-192.png" alt=""><strong>스페이스 커뮤니티</strong><span>${escapeHtml(kind.label)}</span></div>
            ${poster ? `<a href="${escapeHtml(poster)}" target="_blank" rel="noopener"><img class="poster" src="${escapeHtml(poster)}" alt="${escapeHtml(title)} 안내장"></a>` : ''}
            <h2>${escapeHtml(title)}</h2>
            <div class="body">${bodyHtml}</div>
            <div class="actions"><button class="btn kakao" type="button" id="share">카카오톡으로 공유</button></div>
          </article>
          <span class="time">${escapeHtml(timeText)}</span>
        </div>
      </div>
    </div>
  </main>
  <nav class="bar"><a class="btn gold" href="/chat">스페이스톡에서 받아 보기</a><a class="btn" href="/">커뮤니티 홈</a></nav>
  <script src="/kakao-share.js"></script>
  <script>
    document.getElementById('share').addEventListener('click', async () => {
      const data = { title: ${JSON.stringify(`${kind.label} ${title}`).replace(/</g, '\\u003c')}, url: location.href };
      if (window.spaceKakaoShare && await window.spaceKakaoShare({ title: data.title, description: ${JSON.stringify(description).replace(/</g, '\\u003c')},
        imageUrl: ${JSON.stringify(siteUrl + kind.image)}, link: ${JSON.stringify(url)},
        ${poster ? `poster: ${JSON.stringify(poster)}` : `card: { kindLabel: ${JSON.stringify(kind.label)}, cardTitle: ${JSON.stringify(title).replace(/</g, '\\u003c')}, body: ${JSON.stringify(body).replace(/</g, '\\u003c')} }`} })) return;
      try { if (navigator.share) { await navigator.share({ ...data, text: data.title }); return; } } catch (error) { if (error && error.name === 'AbortError') return; }
      try { await navigator.clipboard.writeText(data.title + '\\n' + data.url); alert('주소를 복사했어요. 카카오톡 대화방에 붙여넣어 보내 주세요.'); }
      catch { prompt('아래 주소를 복사해 카카오톡에 붙여넣어 주세요.', data.url); }
    });
  </script>
</body>
</html>`;
}

module.exports = { KINDS, ID, kindOf, parse, renderAnnouncementPage };
