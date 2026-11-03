const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'public', 'worker-chat.js'), 'utf8');

function client(admin = true, navigator = {}) {
  const created = [];
  const element = () => ({
    value: '', checked: false, dataset: {}, events: {}, children: [], style: { setProperty() {} },
    setAttribute() {}, before() {},
    querySelector() { return null; },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    addEventListener(name, handler) { this.events[name] = handler; },
  });
  const nodes = Object.fromEntries(['chatBox', 'chatInput', 'sendBtn'].map(id => [id, element()]));
  nodes.chatInput.parentElement = element();
  let socket;
  class FakeSocket {
    static OPEN = 1;
    constructor() { socket = this; this.events = {}; this.sent = []; this.readyState = 1; }
    addEventListener(name, handler) { this.events[name] = handler; }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() {}
  }
  const context = {
    document: {
      getElementById: id => nodes[id],
      createElement() { const node = element(); created.push(node); return node; },
    },
    window: { addEventListener() {} },
    location: { protocol: 'https:', host: 'example.test', origin: 'https://example.test' },
    navigator,
    WebSocket: FakeSocket, console, setTimeout, clearTimeout,
  };
  vm.runInNewContext(source, context);
  socket.events.message({ data: JSON.stringify({ type: 'hello', admin, canSend: true, signedIn: true, you: 'Test' }) });
  return { nodes, socket, option: created[1], check: created[2], status: created[0], created, share: context.shareAnnouncement, context };
}

test('admin picks 모임안내 or 초청장; the marker is added once and the choice resets', () => {
  const app = client();
  assert.equal(app.option.hidden, false);
  app.check.value = '[모임안내]';
  app.nodes.chatInput.value = 'Meeting at 2pm';
  app.nodes.sendBtn.events.click();
  assert.equal(app.socket.sent[0].text, '[모임안내]\nMeeting at 2pm');
  assert.equal(app.check.value, '');
  app.check.value = '[초청장]';
  app.nodes.chatInput.value = '[초청장]\n창립 기념식';
  app.nodes.sendBtn.events.click();
  assert.equal(app.socket.sent[1].text, '[초청장]\n창립 기념식');
});

test('manual marker and ordinary messages retain their content', () => {
  const app = client();
  for (const text of ['[모임안내] Meeting', 'Ordinary message']) {
    app.nodes.chatInput.value = text;
    app.nodes.sendBtn.events.click();
    assert.equal(app.socket.sent.at(-1).text, text);
  }
});

test('non-admin cannot use the kind selector to add a marker', () => {
  const app = client(false);
  assert.equal(app.option.hidden, true);
  assert.equal(app.check.disabled, true);
  app.check.value = '[모임안내]';
  app.nodes.chatInput.value = 'Ordinary message';
  app.nodes.sendBtn.events.click();
  assert.equal(app.socket.sent[0].text, 'Ordinary message');
});

test('announcements render as a 스페이스 커뮤니티 card with a share button; ordinary messages do not', () => {
  const app = client();
  for (const text of ['[모임안내]\n토요일 산책 모임\n오후 2시 양산천', 'Ordinary message']) {
    app.socket.events.message({ data: JSON.stringify({ type: 'message', id: '1791560000000-abcdef1234', text, own: true, name: 'Test', at: Date.now() }) });
  }
  const buttons = app.created.filter(node => node.className === 'chat-announcement-share');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].textContent, '카카오톡으로 공유');
  assert.ok(app.created.some(node => node.className === 'chat-card'));
  assert.ok(app.created.some(node => node.textContent === '스페이스 커뮤니티'));
  assert.ok(app.created.some(node => node.className === 'chat-card-title' && node.textContent === '토요일 산책 모임'));
});

test('native share sends the share page address so KakaoTalk shows the branded card', async () => {
  let payload;
  const app = client(true, { share: async value => { payload = value; } });
  await app.share({ id: '1791560000000-abcdef1234', text: '[초청장]\n창립 기념식\n11월 1일' });
  assert.equal(payload.url, 'https://example.test/e/1791560000000-abcdef1234');
  assert.equal(payload.title, '💌 초청장 창립 기념식');
  assert.equal(app.status.dataset.error, 'false');
});

test('unsupported native share copies the title and address', async () => {
  let copied;
  const app = client(true, { clipboard: { writeText: async text => { copied = text; } } });
  await app.share({ id: '1791560000000-abcdef1234', text: '[모임안내]\nMeeting' });
  assert.equal(copied, '📣 모임안내 Meeting\nhttps://example.test/e/1791560000000-abcdef1234');
  assert.match(app.status.textContent, /카카오톡/);
});

test('cancelling native share does not copy or report success', async () => {
  let copied = false;
  const app = client(true, {
    share: async () => { const error = new Error('Cancelled'); error.name = 'AbortError'; throw error; },
    clipboard: { writeText: async () => { copied = true; } },
  });
  const previousStatus = app.status.textContent;
  await app.share({ id: '1791560000000-abcdef1234', text: '[모임안내] Meeting' });
  assert.equal(copied, false);
  assert.equal(app.status.textContent, previousStatus);
});

test('Space Talk shares the announcement page address', async () => {
  const talkSource = fs.readFileSync(path.join(__dirname, 'public', 'chat.js'), 'utf8');
  const start = talkSource.indexOf('  async function shareText(');
  const end = talkSource.indexOf('  function announcementCard(', start);
  assert.ok(start >= 0 && end > start);
  const text = '[모임안내]\n토요일 산책\n오후 2시\n\n자세히 보기·카카오톡 공유: https://withpluces.com/e/1791560000000-abcdef1234';
  let payload;
  const context = { window: {}, navigator: { share: async value => { payload = value; } }, copyText: async () => true, toast() {} };
  vm.runInNewContext(talkSource.slice(start, end), context);
  await context.shareAnnouncement(text);
  assert.equal(payload.url, 'https://withpluces.com/e/1791560000000-abcdef1234');
  assert.equal(payload.text, '📣 모임안내 토요일 산책');
  const info = context.announcementOf(text);
  assert.equal(info.body, '오후 2시');
});

test('announcement channel uses the original mark for list and message avatars', () => {
  const talkSource = fs.readFileSync(path.join(__dirname, 'public', 'chat.js'), 'utf8');
  const start = talkSource.indexOf('  function avatar(');
  const end = talkSource.indexOf('  function updateTitle(', start);
  assert.ok(start >= 0 && end > start);
  const context = {
    make: (tag, className, text) => ({ tag, className, text, style: {}, setAttribute() {} }),
    colorOf: () => '#3346d3',
    initial: name => name[0],
  };
  vm.runInNewContext(talkSource.slice(start, end), context);
  for (const small of [false, true]) {
    const face = context.avatar('스페이스 커뮤니티', 'channel-event-announcements', small);
    assert.equal(face.tag, 'img');
    assert.equal(face.src, '/icons/icon-192.png?v=20261103');
    assert.equal(face.className, small ? 'avatar small' : 'avatar');
  }
  assert.equal(context.avatar('Member', 'user-id', true).tag, 'span');
});

test('KakaoTalk official card is tried first with logo image and page link', async () => {
  let card;
  const app = client(true, { share: async () => { throw new Error('should not reach'); } });
  app.context.window.spaceKakaoShare = async value => { card = value; return true; };
  await app.share({ id: '1791560000000-abcdef1234', text: '[초청장]\n창립 기념식\n11월 1일 오후 3시' });
  assert.equal(card.link, 'https://example.test/e/1791560000000-abcdef1234');
  assert.equal(card.imageUrl, 'https://example.test/share/invitation.png?v=20261103');
  assert.equal(card.title, '💌 초청장 창립 기념식');
  assert.match(app.status.textContent, /카카오톡 공유 창/);
});

test('photo messages render an image; text-only stays text', () => {
  const app = client();
  app.socket.events.message({ data: JSON.stringify({ type: 'message', id: '1791560000000-abcdef1234', text: '가로등이 꺼졌어요', image: 'a'.repeat(32), name: '이웃', at: Date.now() }) });
  const image = app.created.find(node => node.src === `/api/board/image?id=${'a'.repeat(32)}`);
  assert.ok(image, 'image element created');
  assert.ok(app.created.some(node => node.className === 'chat-text chat-photo'));
});
