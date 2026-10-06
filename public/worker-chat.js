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

function connectChat() {
  chatSend.disabled = true;
  chatStatus.textContent = '채팅 서버에 연결 중입니다.';
  chatSocket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/chat`);
  chatSocket.addEventListener('open', () => {
    reconnectDelay = 1000;
    chatSend.disabled = false;
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
    item.textContent = result.text;
    chatBox.appendChild(item);
    if (chatBox.childElementCount > 200) chatBox.firstElementChild.remove();
    chatBox.scrollTop = chatBox.scrollHeight;
  });
  chatSocket.addEventListener('error', () => {
    chatStatus.textContent = '채팅 연결 오류가 발생했습니다. 연결 상태를 확인해 주세요.';
    chatStatus.dataset.error = 'true';
  });
  chatSocket.addEventListener('close', () => {
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
connectChat();
