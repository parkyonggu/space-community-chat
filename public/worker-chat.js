const chatBox = document.getElementById('chatBox');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('sendBtn');
const chatStatus = document.createElement('p');
chatStatus.className = 'form-status';
chatStatus.setAttribute('role', 'status');
chatBox.before(chatStatus);
let chatSocket;
let reconnectTimer;
let reconnectDelay = 1000;
let stopped = false;
let canSend = false;
let chatIdentity = window.spaceAuth ? window.spaceAuth.user?.id || '' : null;
let myName = '';

// 대화방에 나온 순서대로 서로 다른 색을 준다(흰 글씨가 잘 보이는 진한 색, 서로 확실히 다른 색만).
const CHAT_COLORS = ['#2f5bd3', '#c62828', '#1f7a54', '#7b3fb0', '#e65100', '#00838f', '#ad1457', '#5d4037', '#546e7a', '#6d8b00', '#283593', '#9e7700'];
const chatColors = new Map();
function colorOf(name) {
  if (!chatColors.has(name)) {
    const used = new Set(chatColors.values());
    let hash = 0;
    for (const char of name) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    // 아직 안 쓴 색 중에서 고르고, 다 썼으면 닉네임으로 정한다.
    const free = CHAT_COLORS.filter(color => !used.has(color));
    chatColors.set(name, free.length ? free[hash % free.length] : CHAT_COLORS[hash % CHAT_COLORS.length]);
  }
  return chatColors.get(name);
}
function timeLabel(at) {
  const date = new Date(at);
  const hours = date.getHours();
  return `${hours < 12 ? '오전' : '오후'} ${hours % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')}`;
}
const GROUP_GAP = 3 * 60 * 1000;
function renderChatMessage(result) {
  const name = typeof result.name === 'string' ? result.name : '';
  const at = Number.isFinite(result.at) ? result.at : Date.now();
  const mine = Boolean(name) && name === myName;
  const previous = chatBox.lastElementChild;
  const continued = previous && previous.dataset.name === name && at - Number(previous.dataset.at) < GROUP_GAP;
  const item = document.createElement('div');
  item.className = `chat-message${mine ? ' mine' : ''}${continued ? ' cont' : ''}`;
  item.dataset.name = name;
  item.dataset.at = String(at);
  if (name) item.style.setProperty('--who', colorOf(name));
  if (!mine && !continued) {
    const avatar = document.createElement('span');
    avatar.className = 'chat-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = [...(name || '?')][0];
    item.appendChild(avatar);
  }
  const body = document.createElement('div');
  body.className = 'chat-body';
  if (!continued) {
    const meta = document.createElement('div');
    meta.className = 'chat-meta';
    const who = document.createElement('strong');
    who.className = 'chat-name';
    who.textContent = mine ? '나' : name || '알 수 없음';
    meta.appendChild(who);
    body.appendChild(meta);
  }
  const line = document.createElement('div');
  line.className = 'chat-line';
  const bubble = document.createElement('div');
  bubble.className = 'chat-text';
  bubble.textContent = result.text;
  const time = document.createElement('time');
  time.className = 'chat-time';
  time.dateTime = new Date(at).toISOString();
  time.textContent = timeLabel(at);
  line.append(bubble, time);
  body.appendChild(line);
  item.appendChild(body);
  // 화면 낭독기용: "닉네임: 내용"
  item.setAttribute('aria-label', `${mine ? '나' : name}, ${timeLabel(at)}: ${result.text}`);
  const nearBottom = chatBox.scrollHeight - chatBox.scrollTop - chatBox.clientHeight < 80;
  chatBox.appendChild(item);
  if (chatBox.childElementCount > 200) {
    chatBox.firstElementChild.remove();
    const first = chatBox.firstElementChild;
    if (first && first.classList.contains('cont')) first.classList.remove('cont');
  }
  if (nearBottom || mine) chatBox.scrollTop = chatBox.scrollHeight;
}

function updateChatInput(signedIn) {
  chatSend.disabled = !canSend;
  chatInput.disabled = !canSend;
  chatInput.placeholder = canSend ? '메시지를 입력하세요. 여러 줄로 작성할 수 있습니다.' :
    signedIn ? '이메일 인증을 완료하면 채팅을 보낼 수 있습니다.' : '로그인한 회원만 채팅을 보낼 수 있습니다. 대화는 누구나 볼 수 있습니다.';
}

function connectChat() {
  chatSend.disabled = true;
  chatStatus.textContent = '채팅 서버에 연결 중입니다.';
  chatSocket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/chat`);
  chatSocket.addEventListener('open', () => {
    reconnectDelay = 1000;
    chatStatus.textContent = '채팅 서버에 연결되었습니다. 메시지는 현재 접속자에게 전달되며 기록으로 보관하지 않습니다.';
    chatStatus.dataset.error = 'false';
  });
  chatSocket.addEventListener('message', event => {
    let result;
    try { result = JSON.parse(event.data); } catch (error) {
      console.error('Invalid chat response:', error);
      chatStatus.textContent = '채팅 서버의 응답을 읽을 수 없습니다.';
      chatStatus.dataset.error = 'true';
      return;
    }
    if (result.type === 'hello') {
      canSend = result.canSend === true;
      myName = typeof result.you === 'string' ? result.you : '';
      updateChatInput(result.signedIn === true);
      return;
    }
    if (result.error) {
      chatStatus.textContent = result.error;
      chatStatus.dataset.error = 'true';
      return;
    }
    if (typeof result.text !== 'string') {
      console.error('Invalid chat message shape');
      chatStatus.textContent = '잘못된 채팅 메시지를 받았습니다.';
      chatStatus.dataset.error = 'true';
      return;
    }
    renderChatMessage(result);
  });
  chatSocket.addEventListener('error', () => {
    chatStatus.textContent = '채팅 연결 오류가 발생했습니다. 연결 상태를 확인해 주세요.';
    chatStatus.dataset.error = 'true';
  });
  chatSocket.addEventListener('close', () => {
    canSend = false;
    chatSend.disabled = true;
    chatStatus.textContent = '채팅 연결이 끊어졌습니다. 자동으로 다시 연결합니다.';
    chatStatus.dataset.error = 'true';
    if (!stopped) {
      reconnectTimer = setTimeout(connectChat, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    }
  });
}
function sendChat() {
  const text = chatInput.value.trim();
  if (!text || text.length > 2000) {
    chatStatus.textContent = '채팅은 1~2,000자로 입력해 주세요.';
    chatStatus.dataset.error = 'true';
    return;
  }
  if (chatSocket.readyState !== WebSocket.OPEN) {
    chatStatus.textContent = '채팅이 연결되지 않았습니다. 연결 후 다시 전송해 주세요.';
    chatStatus.dataset.error = 'true';
    return;
  }
  chatSocket.send(JSON.stringify({ text }));
  chatInput.value = '';
}
chatSend.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    sendChat();
  }
});
window.addEventListener('pagehide', () => {
  stopped = true;
  clearTimeout(reconnectTimer);
  chatSocket.close();
});
window.addEventListener('pageshow', event => {
  if (event.persisted) { stopped = false; connectChat(); }
});
window.addEventListener('space-auth', event => {
  const identity = event.detail?.user?.id || '';
  if (chatIdentity !== null && identity !== chatIdentity && chatSocket) {
    reconnectDelay = 200;
    chatSocket.close();
  }
  chatIdentity = identity;
});
connectChat();
