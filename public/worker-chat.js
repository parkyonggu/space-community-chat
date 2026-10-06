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
    const item = document.createElement('div');
    item.className = 'chat-message';
    if (typeof result.name === 'string') {
      const name = document.createElement('strong');
      name.textContent = `${result.name}: `;
      item.appendChild(name);
    }
    item.appendChild(document.createTextNode(result.text));
    chatBox.appendChild(item);
    if (chatBox.childElementCount > 200) chatBox.firstElementChild.remove();
    chatBox.scrollTop = chatBox.scrollHeight;
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
