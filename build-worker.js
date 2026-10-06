const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const source = path.join(__dirname, 'public');
const output = path.join(__dirname, 'worker-dist');
let html = fs.readFileSync(path.join(source, 'index.html'), 'utf8');
const socketLine = html.split('\n').find(line => line.includes('const socket=io(),'));
assert.ok(socketLine, 'Chat initialization was not found');
html = html.replace(socketLine, '');
html = html.replace('<script src="/socket.io/socket.io.js"></script>', '<script defer src="/worker-chat.js"></script>');
html = html.replace('<body>', `<body>
  <aside class="surface" role="note" style="margin:16px 20px"><strong>무료 시범 운영</strong><p>회원·댓글·구독 신청은 서버에 저장되며 <a href="/privacy">개인정보처리방침</a>에 따라 처리합니다. 채팅은 현재 접속자에게만 전달됩니다. 사용량이 많으면 일시적으로 이용이 제한될 수 있습니다. 게시판·댓글·채팅 글쓰기는 로그인한 회원만 할 수 있습니다. 뉴스레터 발송은 아직 준비 중입니다.</p></aside>`);
fs.mkdirSync(output, { recursive: true });
for (const file of ['signup.css', 'signup.js', 'reader-community.js', 'worker-chat.js', 'manifest.json', 'favicon.svg', 'privacy.html', 'robots.txt', 'sitemap.xml', 'boards.js']) {
  fs.copyFileSync(path.join(source, file), path.join(output, file));
}
fs.cpSync(path.join(source, 'icons'), path.join(output, 'icons'), { recursive: true });
fs.writeFileSync(path.join(output, 'index.html'), html);
fs.writeFileSync(path.join(output, 'community.html'), html);
fs.writeFileSync(path.join(output, 'article.html'), '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/"><title>스페이스 커뮤니티</title></head><body><a href="/">최신 커뮤니티 홈</a></body></html>');
fs.writeFileSync(path.join(output, '404.html'), '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>페이지 없음</title></head><body><a href="/">스페이스 커뮤니티 홈</a></body></html>');
fs.writeFileSync(path.join(output, '_headers'), '/*\n  Cache-Control: no-store\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n');
console.log(`Worker frontend built: ${output}`);
