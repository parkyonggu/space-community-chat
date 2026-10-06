const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const publicDir = path.join(__dirname, 'public');
const outputDir = path.join(__dirname, 'pages-dist');
let html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');

for (const script of [
  '<script defer src="/signup.js"></script>',
  '<script defer src="/reader-community.js"></script>',
  '<script src="/socket.io/socket.io.js"></script>',
]) {
  assert.ok(html.includes(script), `Missing expected script: ${script}`);
  html = html.replace(script, '');
}
const socketLine = html.split('\n').find(line => line.includes('const socket=io(),'));
assert.ok(socketLine, 'Missing expected chat initialization');
html = html.replace(socketLine, '');
html = html.replace(/  <dialog\b[\s\S]*?<\/dialog>/g, '');
html = html.replace(/(<button\b[^>]*class="[^"]*\bsubmitPolicy\b[^"]*"[^>]*)(>)/g, '$1 disabled$2');
html = html.replace('id="sendBtn"', 'id="sendBtn" disabled');
html = html.replace(/(<form\b[^>]*>)([\s\S]*?)(<\/form>)/g,
  '$1<fieldset disabled style="border:0;padding:0;margin:0;min-width:0">$2</fieldset>$3');
html = html.replace('<body>', `<body>
  <aside class="surface" role="note" style="margin:16px 20px">
    <strong>무료 공개 미리보기 · 서버 기능 준비 중</strong>
    <p>메뉴와 화면을 둘러볼 수 있습니다. 회원가입·로그인·실시간 채팅·게시글 등록·공유 댓글·구독 접수는 아직 제공하지 않으며, 입력이나 신청을 저장하지 않습니다.</p>
  </aside>`);
html = html.replace('</head>', '<script defer src="/pages-preview.js"></script></head>');
assert.ok(!html.includes('io()') && !html.includes('/signup.js') && !html.includes('/reader-community.js'));

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'index.html'), html);
fs.writeFileSync(path.join(outputDir, 'community.html'), html);
fs.writeFileSync(path.join(outputDir, 'article.html'),
  '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/"><title>스페이스 커뮤니티</title></head><body><a href="/">최신 커뮤니티 화면으로 이동</a></body></html>');
for (const filename of ['signup.css', 'manifest.json', 'favicon.svg', 'pages-preview.js']) {
  fs.copyFileSync(path.join(publicDir, filename), path.join(outputDir, filename));
}
fs.cpSync(path.join(publicDir, 'icons'), path.join(outputDir, 'icons'), { recursive: true });
fs.writeFileSync(path.join(outputDir, '_headers'), '/*\n  Cache-Control: no-store\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n');
fs.writeFileSync(path.join(outputDir, '404.html'),
  '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>페이지를 찾을 수 없습니다</title></head><body><h1>페이지를 찾을 수 없습니다</h1><a href="/">스페이스 커뮤니티 홈</a></body></html>');
console.log(`Cloudflare Pages preview built: ${outputDir}`);
