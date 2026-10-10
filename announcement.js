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
  const description = (body.replace(/\s+/g, ' ').slice(0, 110) || '스페이스 커뮤니티가 알려 드립니다.') + (body.length > 110 ? '…' : '');
  const date = new Date(record.at + 9 * 60 * 60 * 1000);
  const when = `${date.getUTCFullYear()}. ${date.getUTCMonth() + 1}. ${date.getUTCDate()}.`;
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
  <meta property="og:image" content="${escapeHtml(siteUrl + kind.image)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/icons/icon-192.png">
  <style>
    :root { --navy:#0e1730; --gold:#f5b941; --ink:#0e1730; --text:#2b3550; --muted:#5d6680; --line:#e3e6ef; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:"Pretendard","Noto Sans KR",system-ui,sans-serif; background:#f4f5f9; color:var(--text); }
    .wrap { max-width:640px; margin:0 auto; padding:24px 16px 48px; }
    .card { background:#fff; border-radius:18px; overflow:hidden; box-shadow:0 10px 30px rgba(14,23,48,.12); }
    .head { display:flex; align-items:center; gap:12px; padding:18px 20px; background:var(--navy); color:#fff; }
    .head img { width:44px; height:44px; border-radius:12px; border:2px solid var(--gold); }
    .head strong { display:block; font-size:17px; }
    .head span { font-size:13px; color:var(--gold); font-weight:700; }
    .main { padding:22px 20px 8px; }
    h1 { margin:0 0 14px; font-size:22px; line-height:1.45; color:var(--ink); word-break:keep-all; }
    .body { font-size:16.5px; line-height:1.85; word-break:keep-all; overflow-wrap:anywhere; }
    .date { margin:18px 0 0; font-size:13px; color:var(--muted); }
    .actions { display:flex; flex-wrap:wrap; gap:8px; padding:18px 20px 22px; }
    .btn { display:inline-flex; align-items:center; justify-content:center; min-height:46px; padding:0 18px; border-radius:12px; font-weight:800; font-size:15px; text-decoration:none; border:1px solid var(--line); color:var(--navy); background:#fff; cursor:pointer; }
    .btn.gold { background:var(--gold); border-color:var(--gold); }
    .btn.kakao { background:#fee500; border-color:#fee500; color:#191919; }
    .note { margin:14px 4px 0; font-size:12.5px; color:var(--muted); line-height:1.6; }
  </style>
</head>
<body>
  <main class="wrap">
    <article class="card">
      <header class="head"><img src="/icons/icon-192.png" alt=""><div><strong>스페이스 커뮤니티</strong><span>${escapeHtml(kind.label)}</span></div></header>
      <div class="main">
        <h1>${escapeHtml(title)}</h1>
        <div class="body">${bodyHtml}</div>
        <p class="date">${escapeHtml(when)} 스페이스 커뮤니티 운영자 알림</p>
      </div>
      <div class="actions">
        <button class="btn kakao" type="button" id="share">카카오톡으로 공유</button>
        <a class="btn gold" href="/chat">스페이스톡에서 받아 보기</a>
        <a class="btn" href="/">커뮤니티 홈</a>
      </div>
    </article>
    <p class="note">스페이스톡의 「📣 모임안내」 채널을 받아 보면 새 모임안내·초청장을 알림으로 받을 수 있어요.</p>
  </main>
  <script src="/kakao-share.js"></script>
  <script>
    document.getElementById('share').addEventListener('click', async () => {
      const data = { title: ${JSON.stringify(`${kind.label} ${title}`).replace(/</g, '\\u003c')}, url: location.href };
      if (window.spaceKakaoShare && await window.spaceKakaoShare({ title: data.title, description: ${JSON.stringify(description).replace(/</g, '\\u003c')},
        imageUrl: ${JSON.stringify(siteUrl + kind.image)}, link: ${JSON.stringify(url)} })) return;
      try { if (navigator.share) { await navigator.share({ ...data, text: data.title }); return; } } catch (error) { if (error && error.name === 'AbortError') return; }
      try { await navigator.clipboard.writeText(data.title + '\\n' + data.url); alert('주소를 복사했어요. 카카오톡 대화방에 붙여넣어 보내 주세요.'); }
      catch { prompt('아래 주소를 복사해 카카오톡에 붙여넣어 주세요.', data.url); }
    });
  </script>
</body>
</html>`;
}

module.exports = { KINDS, ID, kindOf, parse, renderAnnouncementPage };
