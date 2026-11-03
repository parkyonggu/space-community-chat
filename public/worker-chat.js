const chatBox = document.getElementById('chatBox');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('sendBtn');
const chatStatus = document.createElement('p');
chatStatus.className = 'form-status';
chatStatus.setAttribute('role', 'status');
chatBox.before(chatStatus);
// 운영자만: 보낼 글을 '📣 모임안내'나 '💌 초청장'으로 고르면 스페이스톡 모임안내 채널에도 「스페이스 커뮤니티」 이름으로 전달된다.
const ANNOUNCE_KINDS = [
  { tag: '[모임안내]', label: '📣 모임안내' },
  { tag: '[초청장]', label: '💌 초청장' },
  { tag: '[정보안내]', label: '📊 정보안내' },
];
const announcementOption = document.createElement('label');
announcementOption.className = 'chat-announcement-option';
announcementOption.hidden = true;
const announcementKind = document.createElement('select');
announcementKind.disabled = true;
announcementKind.setAttribute('aria-label', '글 종류');
// 'general' = 💬 보통메시지: 모임안내가 아닌 일반 전달. 표시를 붙이지 않고 스페이스톡 '💬 보통메시지' 채널로 글자 그대로 보낸다.
const GENERAL_FORWARD = 'general';
for (const [value, label] of [['', '광장에만 올리기 (스페이스톡 전달 안 함)'], [GENERAL_FORWARD, '💬 보통메시지 (스페이스톡 구독자에게도 전송)'], ...ANNOUNCE_KINDS.map(kind => [kind.tag, `${kind.label} (스페이스톡 구독자에게도 전송)`])]) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  announcementKind.appendChild(option);
}
announcementOption.append('운영자 글 종류: ', announcementKind);
chatInput.parentElement.before(announcementOption);
// ---------- 광장채팅 사진: 붙여넣기(Ctrl+V)·끌어다 놓기·📷 버튼 → 미리보기 → 보내기 ----------
const photoBar = document.createElement('div');
photoBar.className = 'chat-photo-bar';
const photoPick = document.createElement('button');
photoPick.type = 'button';
photoPick.className = 'chat-photo-btn';
photoPick.textContent = '📷 사진';
photoPick.title = '사진 보내기 (복사한 사진은 입력칸에 Ctrl+V로 붙여넣어도 됩니다)';
const photoFile = document.createElement('input');
photoFile.type = 'file';
photoFile.accept = 'image/*';
photoFile.hidden = true;
const photoPreview = document.createElement('div');
photoPreview.className = 'chat-photo-preview';
photoPreview.hidden = true;
photoBar.append(photoPick, photoFile, photoPreview);
chatInput.parentElement.before(photoBar);
let pendingPhoto = null;
async function shrinkPhoto(file) {
  let source;
  try { source = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {
    source = await new Promise(resolve => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = URL.createObjectURL(file);
    });
  }
  if (!source) throw new Error('사진을 읽을 수 없습니다. JPG·PNG 사진을 골라 주세요.');
  const scale = Math.min(1, 1600 / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.85, 0.72, 0.6]) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= 1400 * 1024) return blob;
  }
  throw new Error('사진이 너무 큽니다.');
}
function clearPhoto() {
  if (pendingPhoto?.url) URL.revokeObjectURL(pendingPhoto.url);
  pendingPhoto = null;
  photoPreview.hidden = true;
  photoPreview.replaceChildren();
}
async function choosePhoto(file) {
  if (!file) return;
  if (!canSend) {
    chatStatus.textContent = '로그인(이메일 인증)한 회원만 사진을 보낼 수 있습니다.';
    chatStatus.dataset.error = 'true';
    return;
  }
  clearPhoto();
  try {
    const blob = await shrinkPhoto(file);
    pendingPhoto = { blob, url: URL.createObjectURL(blob) };
    const thumb = document.createElement('img');
    thumb.src = pendingPhoto.url;
    thumb.alt = '보낼 사진';
    const note = document.createElement('span');
    note.className = 'chat-photo-note';
    note.textContent = '「전송」을 누르면 사진과 글이 한 번에 올라가요';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'chat-photo-cancel';
    cancel.textContent = '취소';
    cancel.addEventListener('click', clearPhoto);
    photoPreview.replaceChildren(thumb, note, cancel);
    photoPreview.hidden = false;
    chatStatus.textContent = isAdmin && announcementKind.value && announcementKind.value !== GENERAL_FORWARD
      ? '안내장 사진이 붙었습니다. 입력칸 첫 줄에 제목을 적고 「전송」을 누르면 사진과 글이 하나의 안내장으로 올라가고 스페이스톡에도 전달됩니다.'
      : '사진이 붙었습니다. 글을 함께 적고 「전송」을 누르면 한 번에 올라갑니다. 광장 사진은 누구나 볼 수 있어요.';
    chatStatus.dataset.error = 'false';
  } catch (error) {
    chatStatus.textContent = error.message;
    chatStatus.dataset.error = 'true';
  }
}
async function sendPhoto() {
  if (!pendingPhoto) return;
  if (chatSocket?.readyState !== WebSocket.OPEN) {
    chatStatus.textContent = '채팅이 연결되지 않았습니다. 연결 후 다시 보내 주세요.';
    chatStatus.dataset.error = 'true';
    return;
  }
  photoPreview.querySelectorAll('button').forEach(button => { button.disabled = true; });
  chatStatus.textContent = '사진을 올리는 중입니다…';
  try {
    const response = await fetch('/api/board/image?purpose=chat', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'image/jpeg', 'X-CSRF-Token': window.spaceAuth?.csrfToken || '' }, body: pendingPhoto.blob,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `사진 올리기 실패 (${response.status})`);
    let text = chatInput.value.trim().slice(0, 1990);
    // 운영자가 모임안내·초청장을 골랐으면 사진도 안내장으로 보낸다(첫 줄 = 제목).
    const chosen = isAdmin ? announcementKind.value : '';
    const general = chosen === GENERAL_FORWARD;
    if (chosen && !general && !announcementOf(text)) text = `${chosen}\n${text || ANNOUNCE_KINDS.find(kind => kind.tag === chosen).label.replace(/^\S+\s/, '')}`;
    chatSocket.send(JSON.stringify({ text, image: result.id, ...(general ? { forward: GENERAL_FORWARD } : {}) }));
    announcementKind.value = '';
    chatInput.value = '';
    clearPhoto();
    chatStatus.textContent = '사진을 보냈습니다.';
    chatStatus.dataset.error = 'false';
  } catch (error) {
    chatStatus.textContent = error.message;
    chatStatus.dataset.error = 'true';
    photoPreview.querySelectorAll('button').forEach(button => { button.disabled = false; });
  }
}
photoPick.addEventListener('click', () => photoFile.click());
photoFile.addEventListener('change', () => { choosePhoto(photoFile.files?.[0]); photoFile.value = ''; });
chatInput.addEventListener('paste', event => {
  const file = [...(event.clipboardData?.files || [])].find(item => item.type.startsWith('image/'))
    || [...(event.clipboardData?.items || [])].find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile();
  if (!file) return;
  event.preventDefault();
  choosePhoto(file);
});
for (const target of [chatInput, chatBox]) {
  target.addEventListener('dragover', event => { if ([...(event.dataTransfer?.types || [])].includes('Files')) event.preventDefault(); });
  target.addEventListener('drop', event => {
    const file = [...(event.dataTransfer?.files || [])].find(item => item.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    choosePhoto(file);
  });
}

function announcementOf(text) {
  if (typeof text !== 'string') return null;
  const kind = ANNOUNCE_KINDS.find(entry => text.trim().startsWith(entry.tag));
  if (!kind) return null;
  const lines = text.trim().slice(kind.tag.length).split('\n').map(line => line.trim());
  while (lines.length && !lines[0]) lines.shift();
  return { kind, title: lines.shift() || kind.label, body: lines.join('\n').trim() };
}
let chatSocket;
let reconnectTimer;
let reconnectDelay = 1000;
let stopped = false;
let canSend = false;
let chatIdentity = window.spaceAuth ? window.spaceAuth.user?.id || '' : null;
let myName = '';
let isAdmin = false;
let squareMessages = [];

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
function dayLabel(at) {
  const date = new Date(at);
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${'일월화수목금토'[date.getDay()]})`;
}
function dayKey(at) { const date = new Date(at); return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`; }
function lastMessageElement() {
  const last = chatBox.lastElementChild;
  return last && last.classList.contains('chat-message') ? last : null;
}
function deleteButton(id) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chat-del';
  button.textContent = '삭제';
  let armed = null;
  button.addEventListener('click', () => {
    if (!armed) {
      button.textContent = '정말 삭제';
      button.classList.add('armed');
      armed = setTimeout(() => { armed = null; button.textContent = '삭제'; button.classList.remove('armed'); }, 3000);
      return;
    }
    clearTimeout(armed);
    if (chatSocket?.readyState === WebSocket.OPEN) chatSocket.send(JSON.stringify({ type: 'delete', id }));
  });
  return button;
}
// 카카오톡 공유: 안내문 대신 공유 주소(/e/글번호)를 보낸다. 카카오톡이 로고·제목이 담긴 미리보기 카드로 보여 준다.
async function shareAnnouncement(message) {
  const info = announcementOf(message.text);
  const title = info ? `${info.kind.label} ${info.title}` : '스페이스 커뮤니티 안내';
  const url = message.id ? `${location.origin}/e/${message.id}` : `${location.origin}/`;
  const report = (text, error = false) => {
    chatStatus.textContent = text;
    chatStatus.dataset.error = String(error);
  };
  // 1순위: 카카오톡 공식 공유 카드(스페이스 커뮤니티 로고·이름). 안 되면 휴대폰 공유 창, 그것도 안 되면 주소 복사.
  const posterUrl = typeof message.image === 'string' && /^[0-9a-f]{32}$/.test(message.image) ? `${location.origin}/api/board/image?id=${message.image}` : '';
  if (info && message.id && window.spaceKakaoShare && await window.spaceKakaoShare({
    title, description: info.body.replace(/\s+/g, ' ').slice(0, 120) || '스페이스 커뮤니티가 알려 드립니다.',
    imageUrl: `${location.origin}${{ '[초청장]': '/share/invitation.png?v=20261103', '[정보안내]': '/share/info.png?v=20261103' }[info.kind.tag] || '/share/announcement.png?v=20261103'}`, link: url,
    ...(posterUrl ? { poster: posterUrl } : {}), card: { kindLabel: info.kind.label, cardTitle: info.title, body: info.body },
  })) {
    report('카카오톡 공유 창을 열었습니다. 보낼 대화방을 골라 주세요.');
    return;
  }
  if (navigator.share) {
    try {
      await navigator.share({ title, text: title, url });
      report('공유 창에서 고른 곳으로 안내장을 보냈습니다.');
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.error('Announcement share failed:', error);
    }
  }
  const content = `${title}\n${url}`;
  let copied = false;
  try {
    await navigator.clipboard.writeText(content);
    copied = true;
  } catch (error) {
    console.error('Announcement clipboard failed:', error);
    const area = document.createElement('textarea');
    area.value = content;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    try {
      area.select();
      area.setSelectionRange(0, content.length);
      copied = document.execCommand('copy');
    } catch (failure) {
      console.error('Announcement copy fallback failed:', failure);
    } finally {
      area.remove();
    }
  }
  if (!copied) { report(`복사하지 못했습니다. 이 주소를 카카오톡에 붙여넣어 주세요: ${url}`, true); return; }
  report('안내장 주소를 복사했습니다. 카카오톡 대화방에 붙여넣으면 스페이스 커뮤니티 로고가 담긴 카드로 보입니다.');
}
function announcementCard(message, info) {
  const card = document.createElement('div');
  card.className = 'chat-card';
  const head = document.createElement('div');
  head.className = 'chat-card-head';
  const logo = document.createElement('img');
  logo.src = '/icons/icon-192.png?v=20261103';
  logo.alt = '';
  const brand = document.createElement('strong');
  brand.textContent = '스페이스 커뮤니티';
  const kind = document.createElement('span');
  kind.textContent = info.kind.label;
  head.append(logo, brand, kind);
  card.appendChild(head);
  if (typeof message.image === 'string' && /^[0-9a-f]{32}$/.test(message.image)) {
    const link = document.createElement('a');
    link.href = `/api/board/image?id=${message.image}`;
    link.target = '_blank';
    link.rel = 'noopener';
    const poster = document.createElement('img');
    poster.className = 'chat-card-poster';
    poster.src = link.href;
    poster.alt = `${info.title} 안내장`;
    poster.loading = 'lazy';
    link.appendChild(poster);
    card.appendChild(link);
  }
  const title = document.createElement('strong');
  title.className = 'chat-card-title';
  title.textContent = info.title;
  card.appendChild(title);
  if (info.body) {
    const body = document.createElement('p');
    body.className = 'chat-card-body';
    body.textContent = info.body;
    card.appendChild(body);
  }
  const actions = document.createElement('div');
  actions.className = 'chat-card-actions';
  const share = document.createElement('button');
  share.type = 'button';
  share.className = 'chat-announcement-share';
  share.textContent = '카카오톡으로 공유';
  share.title = '공유 창에서 카카오톡 선택 · 지원하지 않으면 안내장 주소 복사';
  share.addEventListener('click', () => shareAnnouncement(message));
  actions.appendChild(share);
  if (message.id) {
    const open = document.createElement('a');
    open.className = 'chat-card-link';
    open.href = `/e/${message.id}`;
    open.target = '_blank';
    open.rel = 'noopener';
    open.textContent = '안내장 보기';
    actions.appendChild(open);
  }
  card.appendChild(actions);
  return card;
}
function renderChatMessage(result) {
  const name = typeof result.name === 'string' ? result.name : '';
  const at = Number.isFinite(result.at) ? result.at : Date.now();
  const mine = result.own === true || (Boolean(name) && name === myName);
  const lastAny = chatBox.lastElementChild;
  const lastDay = lastAny ? lastAny.dataset.day : null;
  if (lastDay !== dayKey(at)) {
    const divider = document.createElement('div');
    divider.className = 'chat-day';
    divider.dataset.day = dayKey(at);
    divider.textContent = dayLabel(at);
    chatBox.appendChild(divider);
  }
  const previous = lastMessageElement();
  const continued = previous && previous.dataset.name === name && at - Number(previous.dataset.at) < GROUP_GAP;
  const item = document.createElement('div');
  item.className = `chat-message${mine ? ' mine' : ''}${continued ? ' cont' : ''}`;
  item.dataset.name = name;
  item.dataset.at = String(at);
  item.dataset.day = dayKey(at);
  if (result.id) item.dataset.id = result.id;
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
  const info = announcementOf(result.text);
  const bubble = info ? announcementCard(result, info) : document.createElement('div');
  if (!info) {
    bubble.className = result.image ? 'chat-text chat-photo' : 'chat-text';
    if (typeof result.image === 'string' && /^[0-9a-f]{32}$/.test(result.image)) {
      const link = document.createElement('a');
      link.href = `/api/board/image?id=${result.image}`;
      link.target = '_blank';
      link.rel = 'noopener';
      const image = document.createElement('img');
      image.src = link.href;
      image.alt = `${name || '회원'}님이 보낸 사진`;
      image.loading = 'lazy';
      link.appendChild(image);
      bubble.appendChild(link);
      if (result.text) {
        const caption = document.createElement('p');
        caption.textContent = result.text;
        bubble.appendChild(caption);
      }
    } else {
      bubble.textContent = result.text;
    }
  }
  const time = document.createElement('time');
  time.className = 'chat-time';
  time.dateTime = new Date(at).toISOString();
  time.textContent = timeLabel(at);
  line.append(bubble, time);
  if (result.id && (mine || isAdmin)) line.appendChild(deleteButton(result.id));
  body.appendChild(line);
  item.appendChild(body);
  // 화면 낭독기용: "닉네임: 내용"
  item.setAttribute('aria-label', `${mine ? '나' : name}, ${timeLabel(at)}: ${result.image ? '사진 ' : ''}${result.text}`);
  chatBox.appendChild(item);
}
const chatPresence = document.getElementById('chatPresence');
function renderPresence(result) {
  if (!chatPresence) return;
  const members = Array.isArray(result.members) ? result.members.filter(name => typeof name === 'string') : [];
  const guests = Number.isFinite(result.guests) ? result.guests : 0;
  const total = members.length + guests;
  const label = document.createElement('span');
  label.className = 'presence-label';
  label.innerHTML = '<span class="dot" aria-hidden="true"></span>';
  label.append(`지금 접속 ${total}명`);
  const list = document.createElement('span');
  list.className = 'presence-list';
  // 내 이름을 맨 앞에, 나머지는 가나다순.
  const ordered = members.includes(myName) ? [myName, ...members.filter(name => name !== myName)] : members;
  const peopleByName = new Map((Array.isArray(result.people) ? result.people : []).map(person => [person.name, person]));
  ordered.forEach(name => {
    const person = peopleByName.get(name);
    // 다른 회원 이름은 누르면 바로 스페이스톡 1:1 (내가 메시지를 보낼 수 있는 회원일 때)
    const clickable = canSend && name !== myName && person?.id;
    const chip = document.createElement(clickable ? 'button' : 'span');
    chip.className = `presence-chip${clickable ? ' is-talk' : ''}`;
    chip.style.setProperty('--who', colorOf(name));
    chip.textContent = name === myName ? `${name}(나)` : name;
    if (clickable) {
      chip.type = 'button';
      chip.title = `${name}님과 바로 1:1 톡`;
      chip.setAttribute('aria-label', `${name}님과 스페이스톡 1:1 대화 열기`);
      chip.addEventListener('click', () => startSquareDm(person, chip));
    }
    list.appendChild(chip);
  });
  if (guests) {
    const rest = document.createElement('span');
    rest.className = 'presence-guests';
    rest.textContent = members.length ? `외 ${guests}명 보는 중` : `${guests}명 보는 중`;
    rest.title = '로그인하지 않고 화면만 보고 있는 방문자';
    list.appendChild(rest);
  }
  squarePeople = Array.isArray(result.people) ? result.people.filter(person => person && typeof person.id === 'string' && typeof person.name === 'string') : [];
  const others = squarePeople.filter(person => person.name !== myName);
  const parts = [label, list];
  if (canSend && others.length) {
    const talk = document.createElement('button');
    talk.type = 'button';
    talk.className = 'presence-talk';
    talk.textContent = others.length > 1 ? `💬 ${others.length}명 함께 톡` : '💬 함께 톡';
    talk.title = '지금 광장을 보고 있는 회원 여럿과 스페이스톡 단체 대화방을 만듭니다 (한 명과는 이름을 누르면 바로 1:1)';
    talk.addEventListener('click', openTalkTogether);
    parts.push(talk);
  }
  chatPresence.replaceChildren(...parts);
}

// ---------- 광장에서 바로 스페이스톡: 지금 접속한 회원을 골라 단체 대화방을 만들고 초대 알림을 띄운다 ----------
let squarePeople = [];
function talkDialog() {
  let dialog = document.getElementById('talk-together');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'talk-together';
  dialog.className = 'talk-together';
  dialog.innerHTML = `<form method="dialog" class="tt-form">
    <h3>지금 함께 있는 회원과 스페이스톡</h3>
    <p class="tt-help">함께 이야기할 회원을 고르세요. 고른 회원은 새 단체 대화방에 바로 들어가고, 광장을 보고 있으면 초대 알림이 뜹니다.</p>
    <div class="tt-people" role="group" aria-label="함께할 회원"></div>
    <label class="tt-name">대화방 이름 <input type="text" maxlength="40" required></label>
    <p class="tt-status" role="status"></p>
    <div class="tt-actions"><button type="button" class="tt-create">대화방 만들기</button><button type="submit" class="tt-close">닫기</button></div>
  </form>`;
  document.body.appendChild(dialog);
  dialog.querySelector('.tt-create').addEventListener('click', createTalkTogether);
  return dialog;
}
function openTalkTogether() {
  const dialog = talkDialog();
  const others = squarePeople.filter(person => person.name !== myName);
  const box = dialog.querySelector('.tt-people');
  box.replaceChildren(...others.map(person => {
    const row = document.createElement('label');
    row.className = 'tt-person';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.value = person.id;
    check.checked = true;
    check.dataset.name = person.name;
    const name = document.createElement('span');
    name.textContent = person.name;
    name.style.color = colorOf(person.name);
    row.append(check, name);
    return row;
  }));
  const today = new Date();
  dialog.querySelector('.tt-name input').value = `광장 대화 · ${today.getMonth() + 1}월 ${today.getDate()}일`;
  const status = dialog.querySelector('.tt-status');
  status.textContent = others.length ? '' : '지금 함께 있는 다른 회원이 없습니다.';
  const create = dialog.querySelector('.tt-create');
  create.hidden = false;
  create.disabled = !others.length;
  if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
}
async function talkApi(path, body) {
  const response = await fetch(path, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.spaceAuth?.csrfToken || '' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `오류가 발생했습니다 (${response.status})`);
  return data;
}
async function createTalkTogether() {
  const dialog = talkDialog();
  const status = dialog.querySelector('.tt-status');
  const create = dialog.querySelector('.tt-create');
  const chosen = [...dialog.querySelectorAll('.tt-person input:checked')];
  const name = dialog.querySelector('.tt-name input').value.trim();
  if (!chosen.length) { status.textContent = '함께할 회원을 한 명 이상 골라 주세요.'; return; }
  if (!name) { status.textContent = '대화방 이름을 적어 주세요.'; return; }
  create.disabled = true;
  status.textContent = '대화방을 만드는 중입니다…';
  try {
    const userIds = chosen.map(input => input.value);
    const { room } = await talkApi('/api/chat/rooms', { name, maxMembers: Math.max(30, userIds.length + 1) });
    await talkApi(`/api/chat/rooms/${encodeURIComponent(room.id)}/add`, { userIds });
    if (chatSocket?.readyState === WebSocket.OPEN) chatSocket.send(JSON.stringify({ type: 'talk-invite', roomId: room.id, roomName: name, userIds }));
    const link = document.createElement('a');
    link.href = `/chat#room=${room.id}`;
    link.className = 'tt-open';
    link.textContent = '스페이스톡에서 대화 시작하기 →';
    status.replaceChildren(document.createTextNode(`「${name}」 대화방을 만들고 ${chosen.map(input => input.dataset.name).join(', ')}님을 불렀습니다. `), link);
    create.hidden = true;
    link.addEventListener('click', event => { event.preventDefault(); dialog.close?.(); openTalkPanel(room.id, name); });
  } catch (error) {
    status.textContent = error.message;
    create.disabled = false;
  }
}
// 광장 화면을 떠나지 않고 스페이스톡을 여는 작은 창(휴대폰에서는 아래에서 올라오는 전체 창)
function openTalkPanel(roomId, title = '스페이스톡') {
  let panel = document.getElementById('talk-panel');
  const src = `/chat#room=${encodeURIComponent(roomId)}`;
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'talk-panel';
    panel.className = 'talk-panel';
    panel.setAttribute('aria-label', '스페이스톡 대화');
    const head = document.createElement('div');
    head.className = 'tp-head';
    const name = document.createElement('strong');
    name.className = 'tp-title';
    const full = document.createElement('a');
    full.className = 'tp-full';
    full.target = '_blank';
    full.rel = 'noopener';
    full.textContent = '크게 보기 ↗';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tp-close';
    close.setAttribute('aria-label', '스페이스톡 창 닫기');
    close.textContent = '×';
    close.addEventListener('click', () => { panel.hidden = true; });
    head.append(name, full, close);
    const frame = document.createElement('iframe');
    frame.className = 'tp-frame';
    frame.title = '스페이스톡 대화';
    panel.append(head, frame);
    document.body.appendChild(panel);
  }
  panel.querySelector('.tp-title').textContent = `💬 ${title}`;
  panel.querySelector('.tp-full').href = src;
  const frame = panel.querySelector('.tp-frame');
  // 이미 열린 스페이스톡이면 주소의 방 번호만 바꿔 다시 불러오지 않는다.
  try {
    if (frame.contentWindow && frame.contentWindow.location.pathname === '/chat') frame.contentWindow.location.hash = `room=${roomId}`;
    else frame.src = src;
  } catch { frame.src = src; }
  panel.hidden = false;
}
async function startSquareDm(person, chip) {
  if (chip) chip.disabled = true;
  try {
    const { room } = await talkApi('/api/chat/dm', { userId: person.id, via: 'square' });
    openTalkPanel(room.id, `${person.name}님과 1:1`);
    if (chatSocket?.readyState === WebSocket.OPEN) chatSocket.send(JSON.stringify({ type: 'talk-invite', roomId: room.id, roomName: '', userIds: [person.id], dm: true }));
  } catch (error) {
    chatStatus.textContent = error.message;
    chatStatus.dataset.error = 'true';
  } finally {
    if (chip) chip.disabled = false;
  }
}
function showTalkInvite(result) {
  const from = typeof result.from === 'string' ? result.from : '회원';
  const roomName = typeof result.roomName === 'string' && result.roomName ? `「${result.roomName}」 ` : '';
  const bar = document.createElement('div');
  bar.className = 'talk-invite';
  bar.setAttribute('role', 'alert');
  const text = document.createElement('span');
  text.textContent = result.dm ? `💬 ${from}님이 1:1 톡을 걸었어요.` : `💬 ${from}님이 스페이스톡 ${roomName}대화방에 불렀어요.`;
  // 같은 사람이 다시 걸면 알림을 하나만 둔다.
  document.querySelectorAll(`.talk-invite[data-room="${CSS.escape(result.roomId)}"]`).forEach(old => old.remove());
  bar.dataset.room = result.roomId;
  const open = document.createElement('a');
  open.href = `/chat#room=${encodeURIComponent(result.roomId)}`;
  open.textContent = result.dm ? '바로 대화하기' : '대화방 열기';
  open.addEventListener('click', event => {
    event.preventDefault();
    openTalkPanel(result.roomId, result.dm ? `${from}님과 1:1` : (result.roomName || '스페이스톡'));
    bar.remove();
  });
  const close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', '알림 닫기');
  close.textContent = '×';
  close.addEventListener('click', () => bar.remove());
  bar.append(text, open, close);
  chatPresence?.after(bar);
}
function renderAllChat() {
  chatBox.replaceChildren();
  squareMessages.forEach(renderChatMessage);
  chatBox.scrollTop = chatBox.scrollHeight;
}
function addChatMessage(result) {
  const nearBottom = chatBox.scrollHeight - chatBox.scrollTop - chatBox.clientHeight < 80;
  squareMessages.push(result);
  if (squareMessages.length > 300) { squareMessages = squareMessages.slice(-200); renderAllChat(); return; }
  renderChatMessage(result);
  const mine = result.own === true || (result.name && result.name === myName);
  if (nearBottom || mine) chatBox.scrollTop = chatBox.scrollHeight;
}

function updateChatInput(signedIn) {
  chatSend.disabled = !canSend;
  chatInput.disabled = !canSend;
  announcementOption.hidden = !isAdmin;
  announcementKind.disabled = !isAdmin || !canSend;
  if (!isAdmin) announcementKind.value = '';
  chatInput.placeholder = canSend ? (isAdmin ? '메시지 입력 · 스페이스톡에도 보내려면 위에서 💬 보통메시지나 모임안내·초청장·정보안내를 고르세요' : '메시지를 입력하세요. 여러 줄로 작성할 수 있습니다.') :
    signedIn ? '이메일 인증을 완료하면 채팅을 보낼 수 있습니다.' : '로그인한 회원만 채팅을 보낼 수 있습니다. 대화는 누구나 볼 수 있습니다.';
}

function connectChat() {
  chatSend.disabled = true;
  chatStatus.textContent = '채팅 서버에 연결 중입니다.';
  chatSocket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/chat`);
  chatSocket.addEventListener('open', () => {
    reconnectDelay = 1000;
    chatStatus.textContent = '채팅 서버에 연결되었습니다. 광장 대화는 누구나 볼 수 있고, 올린 날부터 45일 동안 보관된 뒤 자동으로 삭제됩니다.';
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
      isAdmin = result.admin === true;
      updateChatInput(result.signedIn === true);
      return;
    }
    if (result.type === 'presence') { renderPresence(result); return; }
    if (result.type === 'talk-invite') { if (typeof result.roomId === 'string') showTalkInvite(result); return; }
    if (result.type === 'talk-invite-sent') {
      const status = document.querySelector('#talk-together .tt-status');
      if (status && result.delivered) status.append(document.createTextNode(` (광장에 있는 ${result.delivered}명에게 알림을 보냈어요)`));
      return;
    }
    if (result.type === 'forwarded') {
      chatStatus.textContent = `스페이스톡 「${result.channel || '📣 모임안내'}」 채널로 보냈습니다${result.subscribers ? ` (구독자 ${result.subscribers}명)` : ''}.${result.general ? '' : ' 글 아래 「카카오톡으로 공유」로 카카오톡에도 보낼 수 있어요.'}`;
      chatStatus.dataset.error = 'false';
      return;
    }
    if (result.type === 'forward-error') {
      chatStatus.textContent = result.error || '스페이스톡 채널로 전달하지 못했습니다.';
      chatStatus.dataset.error = 'true';
      return;
    }
    if (result.type === 'history') {
      squareMessages = Array.isArray(result.messages) ? result.messages.filter(item => typeof item?.text === 'string') : [];
      renderAllChat();
      if (!squareMessages.length) chatBox.appendChild(Object.assign(document.createElement('p'), { className: 'chat-empty', textContent: `아직 올라온 대화가 없습니다. 광장 대화는 올린 날부터 ${result.retentionDays || 45}일 동안 보입니다.` }));
      return;
    }
    if (result.type === 'edited') {
      const item = squareMessages.find(entry => entry.id === result.id);
      if (item && typeof result.text === 'string') {
        item.text = result.text;
        const scroll = chatBox.scrollTop;
        renderAllChat();
        chatBox.scrollTop = scroll;
      }
      return;
    }
    if (result.type === 'deleted') {
      squareMessages = squareMessages.filter(item => item.id !== result.id);
      const scroll = chatBox.scrollTop;
      renderAllChat();
      chatBox.scrollTop = scroll;
      return;
    }
    if (result.error) {
      chatStatus.textContent = result.error;
      chatStatus.dataset.error = 'true';
      return;
    }
    if (typeof result.text !== 'string' && !result.image) {
      console.error('Invalid chat message shape');
      chatStatus.textContent = '잘못된 채팅 메시지를 받았습니다.';
      chatStatus.dataset.error = 'true';
      return;
    }
    chatBox.querySelector('.chat-empty')?.remove();
    addChatMessage(result);
  });
  chatSocket.addEventListener('error', () => {
    chatStatus.textContent = '채팅 연결 오류가 발생했습니다. 연결 상태를 확인해 주세요.';
    chatStatus.dataset.error = 'true';
  });
  chatSocket.addEventListener('close', () => {
    canSend = false;
    chatSend.disabled = true;
    announcementKind.disabled = true;
    chatStatus.textContent = '채팅 연결이 끊어졌습니다. 자동으로 다시 연결합니다.';
    chatStatus.dataset.error = 'true';
    if (!stopped) {
      reconnectTimer = setTimeout(connectChat, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    }
  });
}
function sendChat() {
  // 사진이 붙어 있으면 사진과 입력한 글을 한 메시지로 보낸다(안내장도 한 번에).
  if (pendingPhoto) { sendPhoto(); return; }
  let text = chatInput.value.trim();
  if (!text) {
    chatStatus.textContent = '채팅은 1~2,000자로 입력해 주세요.';
    chatStatus.dataset.error = 'true';
    return;
  }
  const chosen = isAdmin ? announcementKind.value : '';
  const general = chosen === GENERAL_FORWARD;
  if (chosen && !general && !announcementOf(text)) text = `${chosen}\n${text}`;
  if (text.length > 2000) {
    chatStatus.textContent = `글이 너무 깁니다(${text.length.toLocaleString('ko-KR')}자). 광장 채팅은 2,000자까지 보낼 수 있어요. 긴 글은 게시판에 올린 뒤 그 글의 「📊 정보안내로 알리기」 버튼을 눌러 요약과 주소만 보내 주세요.`;
    chatStatus.dataset.error = 'true';
    return;
  }
  if (chatSocket.readyState !== WebSocket.OPEN) {
    chatStatus.textContent = '채팅이 연결되지 않았습니다. 연결 후 다시 전송해 주세요.';
    chatStatus.dataset.error = 'true';
    return;
  }
  chatSocket.send(JSON.stringify({ text, ...(general ? { forward: GENERAL_FORWARD } : {}) }));
  chatInput.value = '';
  announcementKind.value = '';
}
chatSend.addEventListener('click', sendChat);
// 게시판 글의 「📊 정보안내로 알리기」: 글 종류와 초안을 채우고 광장 채팅으로 옮겨 간다. 전송은 운영자가 확인한 뒤 직접 누른다.
window.addEventListener('space-announce-draft', event => {
  const { tag = '', text = '' } = event.detail || {};
  if (!ANNOUNCE_KINDS.some(kind => kind.tag === tag)) return;
  announcementKind.value = tag;
  chatInput.value = String(text).slice(0, 1900);
  // 게시판 안의 '실시간 채팅' 탭으로 바꾼 뒤 그 자리로 옮겨 간다.
  document.querySelector('.board-tabs [data-target="chat-section"]')?.click();
  setTimeout(() => document.getElementById('chat-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  chatStatus.textContent = isAdmin
    ? '정보안내 초안을 채웠습니다. 내용을 확인·수정한 뒤 「전송」을 누르면 광장 채팅과 스페이스톡 「📊 정보안내」로 함께 갑니다.'
    : '운영자 계정으로 로그인해야 정보안내로 보낼 수 있습니다.';
  chatStatus.dataset.error = isAdmin ? 'false' : 'true';
  setTimeout(() => { chatInput.focus({ preventScroll: true }); chatInput.setSelectionRange(0, 0); chatInput.scrollTop = 0; }, 450);
});
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
