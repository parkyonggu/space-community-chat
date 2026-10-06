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
fs.mkdirSync(output, { recursive: true });
for (const file of ['signup.css', 'signup.js', 'reader-community.js', 'worker-chat.js', 'manifest.json', 'favicon.svg', 'privacy.html', 'robots.txt', 'sitemap.xml', 'boards.js', 'newsletter.html', 'newsletter-admin.html', 'newsletter-admin.js', 'portal.css', 'portal.js', 'letter.html', 'ads.txt']) {
  fs.copyFileSync(path.join(source, file), path.join(output, file));
}
fs.cpSync(path.join(source, 'icons'), path.join(output, 'icons'), { recursive: true });
fs.writeFileSync(path.join(output, 'index.html'), html);
fs.writeFileSync(path.join(output, 'community.html'), html);
fs.writeFileSync(path.join(output, 'article.html'), '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/"><title>스페이스 커뮤니티</title></head><body><a href="/">최신 커뮤니티 홈</a></body></html>');
fs.writeFileSync(path.join(output, '404.html'), '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>페이지 없음</title></head><body><a href="/">스페이스 커뮤니티 홈</a></body></html>');
fs.writeFileSync(path.join(output, '_headers'), '/*\n  Cache-Control: no-store\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n');
console.log(`Worker frontend built: ${output}`);
