// 스페이스 톡 클라이언트: 대화 목록·대화방·실시간 전송·읽음 표시·사진·초대·1:1·웹 알림
(() => {
  // 카카오톡 카드 링크는 /chat?join=… 모양으로 보낸다(# 뒷부분이 빠지는 앱이 있어서). 열리면 예전처럼 #join=… 으로 바꿔 쓴다.
  {
    const query = new URLSearchParams(location.search);
    const key = ['join', 'dm'].find(name => query.get(name));
    if (key) history.replaceState(null, '', `/chat#${key}=${encodeURIComponent(query.get(key))}`);
  }
  const $ = id => document.getElementById(id);
  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = text;
    return element;
  };
  const COLORS = ['#3346d3', '#0f6b5c', '#9a3412', '#6b3fa0', '#0e7490', '#b45309', '#be123c', '#4d7c0f', '#1d4ed8', '#7c2d12'];
  const colorOf = key => COLORS[[...String(key)].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7) % COLORS.length];
  const initial = name => (String(name || '?').trim()[0] || '?').toUpperCase();

  const state = {
    me: null, csrf: '', rooms: [], channels: [], current: null, room: null, messages: [], hasMore: false, socket: null, retry: 1000,
    pending: new Map(), typingTimer: null, lastTypingSent: 0, vapidKey: '', retentionDays: 90, maxMembers: 100, filter: '', admin: false,
  };

  // ---------- helpers ----------
  function toast(message) {
    const element = $('toast');
    element.textContent = message;
    element.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { element.hidden = true; }, 2600);
  }
  // Clipboard API first; falls back to a temporary textarea for browsers that block it (older phones, in-app browsers).
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      area.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      area.remove();
      if (!ok) { toast('복사하지 못했어요. 글자를 길게 눌러 직접 복사해 주세요.'); return false; }
    }
    toast('복사했어요. 원하는 곳에 길게 눌러 붙여넣기 하세요.');
    return true;
  }
  function setConn(text, error = false) {
    $('conn').textContent = text;
    $('conn').dataset.error = String(error);
  }
  async function api(path, { method = 'GET', body, raw, type } = {}) {
    const headers = {};
    if (method !== 'GET') headers['X-CSRF-Token'] = state.csrf;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (raw) headers['Content-Type'] = type;
    const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers, body: raw || (body !== undefined ? JSON.stringify(body) : undefined) });
    const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
    if (!response.ok) {
      const error = new Error(data.error || `오류가 발생했습니다 (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return data;
  }
  const kst = iso => new Date(iso);
  function timeLabel(iso) {
    const date = kst(iso);
    const hours = date.getHours();
    return `${hours < 12 ? '오전' : '오후'} ${hours % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  function dayLabel(iso) {
    const date = kst(iso);
    return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 ${'일월화수목금토'[date.getDay()]}요일`;
  }
  function listTime(iso) {
    if (!iso) return '';
    const date = kst(iso);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return timeLabel(iso);
    const yesterday = new Date(now.getTime() - 86400000);
    if (date.toDateString() === yesterday.toDateString()) return '어제';
    return date.getFullYear() === now.getFullYear() ? `${date.getMonth() + 1}월 ${date.getDate()}일` : `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
  }
  function linkify(text) {
    const fragment = document.createDocumentFragment();
    const pattern = /https?:\/\/[^\s<>"']+/g;
    let last = 0;
    let match;
    while ((match = pattern.exec(text))) {
      fragment.append(text.slice(last, match.index));
      const url = match[0].replace(/[.,!?)\]]+$/, '');
      const link = make('a', '', url);
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      fragment.append(link);
      last = match.index + url.length;
      pattern.lastIndex = last;
    }
    fragment.append(text.slice(last));
    return fragment;
  }
  // 운영자 소식 채널(모임안내·정보안내): 스페이스 커뮤니티 로고로 보낸다
  const NOTICE_CHANNELS = ['channel-event-announcements', 'channel-info-announcements', 'channel-general-messages'];
  // 글 아래에 카카오톡·문자 공유 단추를 다는 소식 채널(정책브리핑 포함). 글이 접혀 있어도 단추는 늘 보인다.
  const POLICY_CHANNEL_ID = 'channel-policy-briefing';
  const SHARE_CHANNELS = [...NOTICE_CHANNELS, POLICY_CHANNEL_ID];
  function avatar(name, key, small = false) {
    if (['channel-event-announcements', 'channel-info-announcements', 'channel-general-messages'].includes(key)) {
      const image = make('img', `avatar${small ? ' small' : ''}`);
      image.src = '/icons/icon-192.png';
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      return image;
    }
    const element = make('span', `avatar${small ? ' small' : ''}`, initial(name));
    element.style.background = colorOf(key || name);
    element.setAttribute('aria-hidden', 'true');
    return element;
  }
  function updateTitle() {
    const total = state.rooms.reduce((sum, room) => sum + (room.muted ? 0 : room.unread), 0);
    document.title = `${total ? `(${total}) ` : ''}스페이스 톡`;
    if (navigator.setAppBadge) navigator.setAppBadge(total).catch(() => {});
  }

  // ---------- sheet (dialogs) ----------
  const sheet = $('sheet');
  function openSheet(title, build) {
    $('sheet-title').textContent = title;
    const body = $('sheet-body');
    body.replaceChildren();
    build(body);
    if (!sheet.open) sheet.showModal();
  }
  function closeSheet() { if (sheet.open) sheet.close(); }
  $('sheet-close').addEventListener('click', closeSheet);
  sheet.addEventListener('click', event => { if (event.target === sheet) closeSheet(); });

  function linkBox(url) {
    const box = make('div', 'link-box');
    const input = make('input');
    input.readOnly = true;
    input.value = url;
    input.setAttribute('aria-label', '링크');
    const copy = make('button', 'btn navy', '복사');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      await copyText(url);
    });
    box.append(input, copy);
    return box;
  }
  // 카카오톡 등으로 보내기: 휴대폰·지원 브라우저는 공유 창(카카오톡 선택), 그 밖에는 보낼 문구를 복사한다.
  async function shareText(text, url) {
    if (navigator.share) {
      try { await navigator.share(url ? { title: '스페이스 톡', text, url } : { title: '스페이스 톡', text }); return; } catch (error) { if (error?.name === 'AbortError') return; }
    }
    if (await copyText(url ? `${text}\n${url}` : text)) toast('복사했어요. 카카오톡 대화방에 길게 눌러 붙여넣기 하세요.');
  }
  // 모임안내·초청장: 글 끝의 공유 주소(/e/글번호)를 보내면 카카오톡이 스페이스 커뮤니티 로고가 담긴 카드로 보여 준다.
  const ANNOUNCE_KINDS = [{ tag: '[모임안내]', label: '📣 모임안내' }, { tag: '[초청장]', label: '💌 초청장' }, { tag: '[정보안내]', label: '📊 정보안내' }];
  const SHARE_LINE = /\n*자세히 보기·카카오톡 공유: (https?:\/\/\S+\/e\/[0-9a-z-]+)\s*$/;
  const POSTER_LINE = /\n*안내장 사진: (https?:\/\/\S+\/api\/board\/image\?id=[0-9a-f]{32})\s*$/;
  function announcementOf(text) {
    const value = String(text || '');
    const kind = ANNOUNCE_KINDS.find(entry => value.trim().startsWith(entry.tag));
    if (!kind) return null;
    const link = SHARE_LINE.exec(value)?.[1] || '';
    const rest = value.replace(SHARE_LINE, '').trim();
    const poster = POSTER_LINE.exec(rest)?.[1] || '';
    const lines = rest.replace(POSTER_LINE, '').trim().slice(kind.tag.length).split('\n').map(line => line.trim());
    while (lines.length && !lines[0]) lines.shift();
    return { kind, title: lines.shift() || kind.label, body: lines.join('\n').trim(), link, poster };
  }
  function shareAnnouncement(text) {
    const info = announcementOf(text);
    if (!info) return shareText(text);
    const title = `${info.kind.label} ${info.title}`;
    if (!info.link) return shareText(`${title}\n\n${info.body}\n\n— 스페이스 커뮤니티`);
    return (async () => {
      // 1순위: 카카오톡 공식 공유 카드. 안 되면 공유 창이나 주소 복사.
      if (window.spaceKakaoShare && await window.spaceKakaoShare({
        title, description: info.body.replace(/\s+/g, ' ').slice(0, 120) || '스페이스 커뮤니티가 알려 드립니다.',
        imageUrl: `${location.origin}${{ '[초청장]': '/share/invitation.png', '[정보안내]': '/share/info.png' }[info.kind.tag] || '/share/announcement.png'}`, link: info.link,
        ...(info.poster ? { poster: info.poster } : {}), card: { kindLabel: info.kind.label, cardTitle: info.title, body: info.body },
      })) return;
      await shareText(title, info.link);
    })();
  }
  // 긴 글은 처음엔 몇 줄만 보여 주고 「더 보기」로 펼친다(휴대폰에서 화면이 글로 꽉 차지 않게).
  const FOLD_LINES = 8;
  function foldText(text, className = '') {
    const value = String(text || '');
    const content = make('span', `fold-text${className ? ` ${className}` : ''}`);
    content.appendChild(linkify(value));
    // 휴대폰 말풍선 한 줄에 한글 약 16자가 들어간다. 그보다 확실히 짧으면 접지 않는다.
    if (value.split('\n').length <= FOLD_LINES && value.length <= FOLD_LINES * 16) return content;
    content.classList.add('folded');
    const holder = make('span', 'fold-wrap');
    const toggle = make('button', 'fold-toggle', '더 보기 ▾');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', event => {
      event.stopPropagation();
      const open = content.classList.toggle('folded') === false;
      toggle.textContent = open ? '접기 ▴' : '더 보기 ▾';
      toggle.setAttribute('aria-expanded', String(open));
    });
    toggle.addEventListener('dblclick', event => event.stopPropagation());
    holder.append(content, toggle);
    // 화면에 그려진 뒤 실제로 8줄을 넘지 않으면(넓은 PC 화면 등) 접기 단추를 뗀다.
    requestAnimationFrame(() => {
      if (!holder.isConnected || !content.classList.contains('folded')) return;
      if (content.scrollHeight <= content.clientHeight + 2) { content.classList.remove('folded'); toggle.remove(); }
    });
    return holder;
  }
  // 운영자 전용: 이 글을 운영자 슬랙 채널(#사이트-알림)로 보낸다. 끝의 공유 주소 줄은 떼고 보낸다.
  async function sendToSlack(message) {
    const info = !message.userId ? announcementOf(message.text) : null;
    // 모임안내·초청장·정보안내: 종류·제목·본문·안내장 주소로 정리해서 보낸다.
    const shown = info ? `${info.kind.label} ${info.title}${info.body ? `\n\n${info.body}` : ''}${info.poster ? `\n\n안내장 사진: ${info.poster}` : ''}${info.link ? `\n\n자세히 보기: ${info.link}` : ''}` :
      SHARE_CHANNELS.includes(state.room?.id) && !message.userId ? plainNotice(message.text).shown : message.text;
    const text = message.userId ? `${message.nickname || ''}: ${shown}` : shown;
    try {
      await api('/api/chat/slack', { method: 'POST', body: { room: state.room?.name || '스페이스 톡', text } });
      toast('슬랙으로 보냈어요.');
    } catch (error) { toast(error.message); }
  }
  // 문자(SMS)로 보내기: 휴대폰은 문자 앱을 글이 채워진 채로 열고, PC는 글을 복사한다.
  function sendSms(text) {
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) { location.href = `sms:?&body=${encodeURIComponent(text)}`; return; }
    copyText(text).then(ok => { if (ok) toast('복사했어요. 휴대폰 문자에 붙여넣기 하세요.'); });
  }
  // 운영자 소식 채널의 글자 메시지(💬 보통메시지 등) 아래: 카카오톡·문자로 바로 전달하는 단추
  // 보통메시지 글: 끝의 공유 주소 줄(/e/번호)을 떼어 내고 제목(첫 줄)·본문으로 나눈다.
  function plainNotice(text) {
    const value = String(text || '');
    const link = SHARE_LINE.exec(value)?.[1] || '';
    const shown = value.replace(SHARE_LINE, '').trim();
    const lines = shown.split('\n');
    const title = (lines.shift() || '').trim().slice(0, 80) || '스페이스 커뮤니티 소식';
    return { link, shown, title, body: lines.join('\n').trim() };
  }
  function forwardActions(message) {
    const policy = state.room?.id === POLICY_CHANNEL_ID;
    const roomName = state.room?.name || (policy ? '📰 오늘의 정책브리핑' : '💬 보통메시지');
    const info = plainNotice(message.text);
    // 공유 카드를 누르면 열 주소: 보통메시지는 글마다 만든 /e/번호, 정책브리핑은 홈페이지 정책브리핑 칸.
    info.link = info.link || `${location.origin}/${policy ? '#policy-panel' : ''}`;
    if (policy) {
      // 카드 그림에는 누를 수 없는 긴 원문 주소 줄을 빼고 제목·요약만 싣는다.
      info.body = info.body.split('\n').filter(line => !/^\s*https?:\/\/\S+\s*$/.test(line) && !line.startsWith('다른 정책 소식은'))
        .join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    const smsText = policy ? `${info.title}\n\n${info.body}\n\n전체 보기: ${info.link}` :
      `${info.shown}\n\n— 스페이스 커뮤니티 ${roomName}\n${info.link}`;
    const actions = make('div', 'msg-share');
    const kakao = make('button', 'btn kakao', '카카오톡으로 공유');
    kakao.type = 'button';
    kakao.title = '카카오톡 친구·단톡방을 골라 바로 보내기 (모임안내와 같은 카드)';
    kakao.addEventListener('click', async event => {
      event.stopPropagation();
      kakao.disabled = true;
      try {
        // 모임안내·정보안내와 같은 방식: 카카오톡 공식 공유 카드(글 전체를 그린 그림 + 「자세히 보기」)로 바로 보낸다.
        if (window.spaceKakaoShare && await window.spaceKakaoShare({
          title: info.title.startsWith('📰') ? info.title : `${roomName} ${info.title}`, description: info.body.replace(/\s+/g, ' ').slice(0, 120) || '스페이스 커뮤니티가 알려 드립니다.',
          imageUrl: `${location.origin}/share/announcement.png`, link: info.link,
          card: { kindLabel: roomName, cardTitle: info.title, body: info.body },
        })) return;
        await shareText(smsText);
      } finally { kakao.disabled = false; }
    });
    const sms = make('button', 'btn', '문자로 보내기');
    sms.type = 'button';
    sms.title = '문자 앱을 글이 채워진 채로 엽니다';
    sms.addEventListener('click', event => { event.stopPropagation(); sendSms(smsText); });
    const buttons = [kakao, sms];
    if (state.me?.admin) {
      const slack = make('button', 'btn', '📤 슬랙으로');
      slack.type = 'button';
      slack.title = '운영자 슬랙 채널로 보내기 (운영자에게만 보임)';
      slack.addEventListener('click', event => { event.stopPropagation(); sendToSlack(message); });
      buttons.push(slack);
    }
    for (const button of buttons) button.addEventListener('dblclick', event => event.stopPropagation());
    actions.append(...buttons);
    return actions;
  }
  function announcementCard(message, info) {
    const card = make('div', 'bubble announce-card');
    const head = make('div', 'announce-head');
    const logo = make('img');
    logo.src = '/icons/icon-192.png';
    logo.alt = '';
    head.append(logo, make('strong', '', '스페이스 커뮤니티'), make('span', '', info.kind.label));
    card.appendChild(head);
    if (info.poster) {
      const poster = make('img', 'announce-poster');
      poster.src = info.poster;
      poster.alt = `${info.title} 안내장`;
      poster.loading = 'lazy';
      poster.addEventListener('click', event => { event.stopPropagation(); viewImage(info.poster); });
      poster.addEventListener('load', () => keepBottom());
      card.appendChild(poster);
    }
    card.appendChild(make('strong', 'announce-title', info.title));
    if (info.body) {
      const body = make('div', 'announce-body');
      body.appendChild(foldText(info.body));
      card.appendChild(body);
    }
    const actions = make('div', 'announce-actions');
    const share = make('button', 'btn kakao', '카카오톡으로 공유');
    share.type = 'button';
    share.title = '공유 창에서 카카오톡 선택 · 지원하지 않으면 안내장 주소 복사';
    share.addEventListener('click', event => { event.stopPropagation(); shareAnnouncement(message.text); });
    actions.appendChild(share);
    if (info.link) {
      const open = make('a', 'btn', '안내장 보기');
      open.href = info.link;
      open.target = '_blank';
      open.rel = 'noopener';
      actions.appendChild(open);
    }
    // 운영자만: 이 안내를 운영자 슬랙 채널로 보낸다.
    if (state.me?.admin) {
      const slack = make('button', 'btn', '📤 슬랙으로');
      slack.type = 'button';
      slack.title = '운영자 슬랙 채널로 보내기 (운영자에게만 보임)';
      slack.addEventListener('click', event => { event.stopPropagation(); sendToSlack(message); });
      slack.addEventListener('dblclick', event => event.stopPropagation());
      actions.appendChild(slack);
    }
    card.appendChild(actions);
    return card;
  }
  function inviteText(roomName) {
    return [
      `[스페이스 톡 초대] '${roomName}' 대화방에 초대합니다.`,
      '아래 링크를 누르고 이름만 적으면 바로 들어옵니다. (회원가입 필요 없음)',
    ].join('\n');
  }
  // 초대 링크 보내기: 카카오톡 공유 창(한 번에 최대 10명·단톡방 선택, 보낸 뒤 '이어서 보내기')으로 로고 카드를 보낸다.
  // 카카오 공유를 쓸 수 없으면 휴대폰 공유 창 → 복사 순서로 대신한다.
  function shareButton(url, text, card) {
    const wrap = make('div', 'share-row');
    const kakao = make('button', 'btn kakao block', '카카오톡으로 보내기 (여러 명·단톡방)');
    kakao.type = 'button';
    kakao.addEventListener('click', async () => {
      const kakaoUrl = url.replace('/chat#', '/chat?');
      kakao.disabled = true;
      try {
        if (card && window.spaceKakaoShare && await window.spaceKakaoShare({ title: card.cardTitle, description: text, imageUrl: `${location.origin}/share/invitation.png`,
          link: kakaoUrl, button: card.button || '대화방 들어가기', card })) return;
        await shareText(text, url);
      } finally { kakao.disabled = false; }
    });
    const copy = make('button', 'btn block', '초대 문구 복사 (카톡·문자에 붙여넣기)');
    copy.type = 'button';
    copy.addEventListener('click', async () => { if (await copyText(`${text}\n${url}`)) toast('복사했어요. 카카오톡 대화방에 붙여넣기 하세요.'); });
    wrap.append(kakao, copy);
    return wrap;
  }

  // ---------- room list ----------
  function renderRooms() {
    const list = $('rooms');
    const keyword = state.filter.toLowerCase();
    const rooms = state.rooms.filter(room => !keyword || room.name.toLowerCase().includes(keyword));
    $('rooms-empty').hidden = Boolean(state.rooms.length) || !state.me || state.channels.some(channel => !channel.subscribed);
    const items = rooms.map(room => {
      const item = make('li');
      const button = make('button', 'room-item');
      button.type = 'button';
      if (room.id === state.current) button.setAttribute('aria-current', 'true');
      const face = avatar(room.name, room.id);
      if (room.kind === 'group') face.appendChild(make('span', 'count', String(room.memberCount)));
      const main = make('div', 'room-main');
      const name = make('div', 'room-name');
      name.appendChild(make('span', '', room.name));
      if (room.kind === 'group') name.appendChild(make('span', 'members', String(room.memberCount)));
      if (room.muted) {
        const muted = make('span', 'muted');
        muted.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M11 5L6 9H3v6h3l5 4V5z"/></svg>';
        muted.setAttribute('aria-label', '알림 꺼짐');
        name.appendChild(muted);
      }
      main.append(name, make('div', 'room-preview', room.lastPreview || (room.kind === 'dm' ? '1:1 대화를 시작해 보세요.' : '')));
      const side = make('div', 'room-side');
      side.appendChild(make('span', 'room-time', listTime(room.lastAt)));
      if (room.unread) side.appendChild(make('span', 'badge', room.unread > 999 ? '999+' : String(room.unread)));
      button.append(face, main, side);
      button.setAttribute('aria-label', `${room.name}${room.unread ? `, 읽지 않은 메시지 ${room.unread}개` : ''}`);
      button.addEventListener('click', () => { state.fromList = true; location.hash = `room=${room.id}`; });
      item.appendChild(button);
      return item;
    });
    if (!keyword) items.unshift(...state.channels.filter(channel => !channel.subscribed).map(channelCard));
    list.replaceChildren(...items);
    updateTitle();
  }
  function channelCard(channel) {
    const eventChannel = channel.roomId === 'channel-event-announcements';
    const infoChannel = channel.roomId === 'channel-info-announcements';
    const generalChannel = channel.roomId === 'channel-general-messages';
    const item = make('li', 'channel-card');
    const description = eventChannel ?
      '스페이스 커뮤니티가 보내는 모임안내·초청장을 받아 봐요. 카카오톡으로 바로 공유할 수 있고, 새 소식 알림도 받을 수 있어요.' :
      generalChannel ? '모임안내가 아닌 운영자의 일반 소식·전달 사항을 받아 봐요. 그림 카드 없이 글로 바로 읽을 수 있어요.' :
      infoChannel ? '주간 시장분석처럼 운영자가 정리한 정보를 받아 봐요. 지수가 왜 오르고 내렸는지 쉽게 풀어 드려요(투자 권유 아님).' :
      '매일 아침 7시 30분, 정부 부처의 전날 정책뉴스에서 가장 중요한 테마를 골라 보내 드려요. 새 소식 알림도 받을 수 있어요.';
    item.append(make('strong', '', channel.name), make('p', '', `${description}${channel.subscribers ? ` (${channel.subscribers}명 받아 보는 중)` : ''}`));
    const join = make('button', 'btn gold', '받아 보기');
    join.type = 'button';
    join.addEventListener('click', async () => {
      join.disabled = true;
      try {
        const endpoint = eventChannel ? '/api/chat/event-channel/subscribe' : generalChannel ? '/api/chat/general-channel/subscribe' : infoChannel ? '/api/chat/info-channel/subscribe' : '/api/chat/channel/subscribe';
        const { room } = await api(endpoint, { method: 'POST', body: {} });
        channel.subscribed = true;
        await loadRooms();
        toast(eventChannel ? '구독했어요. 운영자의 모임안내가 이 방으로 전달됩니다.' : generalChannel ? '구독했어요. 운영자의 보통메시지가 이 방으로 전달됩니다.' : infoChannel ? '구독했어요. 운영자의 정보안내(시장분석 등)가 이 방으로 전달됩니다.' : '구독했어요. 매일 아침 7시 30분에 정책브리핑이 이 방으로 옵니다.');
        location.hash = `room=${room.id}`;
      } catch (error) { toast(error.message); join.disabled = false; }
    });
    item.appendChild(join);
    return item;
  }
  async function loadRooms() {
    const [{ rooms }, channel, eventChannel, generalChannel, infoChannel] = await Promise.all([
      api('/api/chat/rooms'), api('/api/chat/channel').catch(() => null), api('/api/chat/event-channel').catch(() => null),
      api('/api/chat/general-channel').catch(() => null), api('/api/chat/info-channel').catch(() => null),
    ]);
    state.rooms = rooms;
    state.channels = [channel, eventChannel, generalChannel, infoChannel].filter(Boolean);
    renderRooms();
  }
  $('room-filter').addEventListener('input', event => { state.filter = event.target.value.trim(); renderRooms(); });

  // ---------- open a room ----------
  async function openRoom(roomId) {
    state.current = roomId;
    $('app').dataset.view = 'room';
    renderRooms();
    $('room-empty').hidden = true;
    $('room-bar').hidden = false;
    $('messages').hidden = false;
    $('composer').hidden = false;
    $('message-list').replaceChildren();
    $('typing').textContent = '';
    try {
      const [{ room }, data] = await Promise.all([api(`/api/chat/rooms/${roomId}`), api(`/api/chat/rooms/${roomId}/messages`)]);
      if (state.current !== roomId) return;
      state.room = room;
      state.messages = data.messages;
      state.hasMore = data.hasMore;
      state.room.members = data.members;
      renderRoomHead();
      renderMessages(true);
      markRead();
      setTimeout(() => { if (matchMedia('(min-width:761px)').matches) $('input').focus(); }, 50);
    } catch (error) {
      toast(error.message);
      closeRoom();
    }
  }
  function closeRoom() {
    state.current = null;
    state.room = null;
    $('app').dataset.view = 'list';
    $('room-empty').hidden = false;
    $('room-bar').hidden = true;
    $('messages').hidden = true;
    $('composer').hidden = true;
    renderRooms();
  }
  function renderRoomHead() {
    const room = state.room;
    $('room-title').textContent = room.name;
    const canRename = room.kind === 'group' && (room.isOwner || state.me.admin);
    $('room-title').style.cursor = canRename ? 'pointer' : '';
    $('room-title').title = canRename ? '눌러서 대화방 이름 바꾸기' : '';
    const online = (room.online || []).filter(id => id !== state.me.id).length;
    $('room-sub').textContent = room.kind === 'channel' ? `소식 채널 · ${room.memberCount}명 구독` : room.kind === 'group' ? `${room.memberCount}명 참여${online ? ` · ${online}명 접속 중` : ''}` : online ? '접속 중' : '1:1 대화';
    $('composer').hidden = room.kind === 'channel';
    $('btn-send').disabled = !$('input').value.trim();
    renderNotice();
  }
  function renderNotice() {
    const notice = state.room?.notice;
    $('room-notice').hidden = !notice;
    if (!notice) return;
    const text = $('notice-text');
    text.replaceChildren(linkify(notice.text), make('small', '', `${notice.by || ''} · ${listTime(notice.at)} 등록`));
    text.setAttribute('aria-expanded', 'false');
  }
  $('notice-text').addEventListener('click', event => {
    if (event.target.closest('a')) return;
    const text = $('notice-text');
    if (window.getSelection && String(window.getSelection()).length) return; // selecting text, not toggling
    text.setAttribute('aria-expanded', String(text.getAttribute('aria-expanded') !== 'true'));
  });
  $('notice-copy').addEventListener('click', () => { if (state.room?.notice) copyText(state.room.notice.text); });
  async function saveNotice(roomId, text) {
    try {
      const result = await api(`/api/chat/rooms/${roomId}/notice`, { method: 'POST', body: { text } });
      if (state.current === roomId) { state.room = { ...state.room, notice: result.room.notice }; renderNotice(); }
      toast(text ? '공지를 등록했어요.' : '공지를 내렸어요.');
      return true;
    } catch (error) { toast(error.message); return false; }
  }
  function noticeSheet(room) {
    openSheet('공지사항', body => {
      body.appendChild(make('p', '', '공지는 대화방 맨 위에 고정되어 모든 참여자에게 보입니다. 다른 곳에서 복사한 글을 붙여넣어도 됩니다.'));
      const label = make('label', '', '공지 내용');
      const area = make('textarea');
      area.rows = 6;
      area.maxLength = 1000;
      area.value = room.notice?.text || '';
      area.placeholder = '예: 이번 모임은 토요일 오후 2시, 도서관 3층 세미나실입니다.';
      label.appendChild(area);
      const save = make('button', 'btn gold block', '공지 등록');
      save.type = 'button';
      save.addEventListener('click', async () => {
        if (!area.value.trim()) { toast('공지 내용을 입력해 주세요.'); return; }
        if (await saveNotice(room.id, area.value)) closeSheet();
      });
      body.append(label, save);
      if (room.notice) {
        const remove = make('button', 'btn danger block', '공지 내리기');
        remove.type = 'button';
        remove.addEventListener('click', async () => { if (await saveNotice(room.id, '')) closeSheet(); });
        body.appendChild(remove);
      }
      area.focus();
    });
  }
  // Carry a chat message over to a board on the home page (소통·나눔 / 시민의 소리) as a draft.
  function moveToBoard(text) {
    openSheet('게시판에 옮겨 쓰기', body => {
      body.appendChild(make('p', '', '고를 게시판의 글쓰기 칸에 이 내용이 미리 채워집니다. 확인하고 다듬은 뒤 등록하세요.'));
      for (const [board, label] of [['community', '소통·나눔 광장'], ['voice', '시민의 소리'], ['research', '학술·논문·소고·이야기']]) {
        const button = make('button', 'btn block', label);
        button.type = 'button';
        button.addEventListener('click', () => {
          try { sessionStorage.setItem('space-draft', JSON.stringify({ board, text })); } catch { /* storage unavailable */ }
          location.href = `/#${board}-section`;
        });
        body.appendChild(button);
      }
    });
  }

  // ---------- messages ----------
  function unreadFor(message) {
    if (!state.room?.members || message.kind === 'system') return 0;
    return state.room.members.filter(member => member.id !== message.userId && member.joinedSeq < message.seq && member.lastReadSeq < message.seq).length;
  }
  function messageNode(message, previous) {
    if (message.kind === 'system') {
      const wrap = make('div', 'system');
      wrap.appendChild(make('span', '', message.text));
      return wrap;
    }
    const mine = message.userId === state.me.id;
    const cont = previous && previous.kind !== 'system' && previous.userId === message.userId &&
      new Date(message.createdAt) - new Date(previous.createdAt) < 60000 && timeLabel(previous.createdAt) === timeLabel(message.createdAt);
    const row = make('div', `msg${mine ? ' mine' : ''}${cont ? ' cont' : ''}${message.pending ? ' pending' : ''}`);
    row.dataset.id = message.id;
    if (!mine) row.appendChild(avatar(message.nickname,
      NOTICE_CHANNELS.includes(state.room?.id) && !message.userId ? state.room.id : message.userId, true));
    const body = make('div', 'msg-body');
    if (!mine) body.appendChild(make('div', 'msg-name', message.nickname || '알 수 없음'));
    const line = make('div', 'msg-line');
    let bubble;
    if (message.deletedAt) {
      bubble = make('div', 'bubble deleted', '삭제된 메시지입니다.');
    } else if (message.kind === 'image') {
      bubble = make('div', 'bubble photo');
      const image = make('img');
      image.src = message.localUrl || `/api/chat/images/${message.imageId}`;
      image.alt = `${message.nickname || ''}님이 보낸 사진`;
      image.loading = 'lazy';
      image.addEventListener('load', () => keepBottom());
      image.addEventListener('click', () => viewImage(image.src));
      bubble.appendChild(image);
    } else if (message.kind === 'text' && !message.userId && announcementOf(message.text)) {
      bubble = announcementCard(message, announcementOf(message.text));
    } else {
      bubble = make('div', 'bubble');
      const notice = message.kind === 'text' && !message.userId && SHARE_CHANNELS.includes(state.room?.id);
      // 보통메시지는 끝의 공유 주소 줄을 화면에서 감추고, 아래 단추로 보낸다.
      bubble.appendChild(foldText(notice ? plainNotice(message.text).shown : message.text));
      if (notice) bubble.appendChild(forwardActions(message));
    }
    if (!message.deletedAt && !message.pending) {
      bubble.tabIndex = 0;
      bubble.setAttribute('aria-haspopup', 'dialog');
      bubble.title = '눌러서 메뉴 열기';
      bubble.addEventListener('contextmenu', event => { event.preventDefault(); messageMenu(message); });
      let press;
      bubble.addEventListener('touchstart', () => { press = setTimeout(() => messageMenu(message), 550); }, { passive: true });
      ['touchend', 'touchmove', 'touchcancel'].forEach(name => bubble.addEventListener(name, () => clearTimeout(press), { passive: true }));
      bubble.addEventListener('keydown', event => { if (event.key === 'Enter') messageMenu(message); });
      bubble.addEventListener('dblclick', () => messageMenu(message));
    }
    const meta = make('div', 'meta');
    if (message.failed) {
      const retry = make('button', 'fail', '전송 실패 · 다시 보내기');
      retry.type = 'button';
      retry.style.border = '0';
      retry.style.background = 'none';
      retry.addEventListener('click', () => resend(message));
      meta.appendChild(retry);
    } else {
      const unread = message.pending ? 0 : unreadFor(message);
      if (unread) meta.appendChild(make('span', 'unread', String(unread)));
      meta.appendChild(make('span', '', message.pending ? '보내는 중' : timeLabel(message.createdAt)));
      if (message.editedAt && !message.deletedAt) meta.appendChild(make('span', 'edited', '수정됨'));
    }
    line.append(bubble, meta);
    body.appendChild(line);
    row.appendChild(body);
    return row;
  }
  function nearBottom() {
    const box = $('messages');
    return box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  }
  function keepBottom(force = false) {
    const box = $('messages');
    if (force || nearBottom()) box.scrollTop = box.scrollHeight;
  }
  function renderMessages(scroll = false) {
    const list = $('message-list');
    const box = $('messages');
    const stick = scroll || nearBottom();
    const nodes = [];
    let previous = null;
    for (const message of state.messages) {
      if (!previous || kst(previous.createdAt).toDateString() !== kst(message.createdAt).toDateString()) {
        const day = make('div', 'day');
        day.appendChild(make('span', '', dayLabel(message.createdAt)));
        nodes.push(day);
        previous = null;
      }
      nodes.push(messageNode(message, previous));
      previous = message;
    }
    if (!state.messages.length) {
      const empty = make('div', 'system');
      const channelHint = state.room?.id === 'channel-event-announcements' ?
        '운영자가 광장채팅에 올린 모임안내·초청장이 「스페이스 커뮤니티」 이름으로 이곳에 전달됩니다.' :
        state.room?.id === 'channel-info-announcements' ? '운영자가 광장채팅에 올린 정보안내(주간 시장분석 등)가 「스페이스 커뮤니티」 이름으로 이곳에 전달됩니다.' : '매일 아침 7시 30분에 전날 정책뉴스로 만든 정책브리핑이 이곳에 올라옵니다.';
      empty.appendChild(make('span', '', state.room?.kind === 'channel' ? channelHint : state.room?.kind === 'dm' ? '1:1 대화를 시작해 보세요.' : '첫 메시지를 보내 보세요.'));
      nodes.push(empty);
    }
    list.replaceChildren(...nodes);
    $('btn-older').hidden = !state.hasMore;
    if (stick) box.scrollTop = box.scrollHeight;
    $('btn-jump').hidden = true;
  }
  $('btn-older').addEventListener('click', async () => {
    const first = state.messages.find(message => message.seq);
    if (!first) return;
    const box = $('messages');
    const before = box.scrollHeight;
    try {
      const data = await api(`/api/chat/rooms/${state.current}/messages?before=${first.seq}`);
      state.messages = [...data.messages, ...state.messages];
      state.hasMore = data.hasMore;
      renderMessages();
      box.scrollTop = box.scrollHeight - before;
    } catch (error) { toast(error.message); }
  });
  $('messages').addEventListener('scroll', () => {
    if (nearBottom()) { $('btn-jump').hidden = true; markRead(); }
  });
  $('btn-jump').addEventListener('click', () => { keepBottom(true); $('btn-jump').hidden = true; markRead(); });

  function markRead() {
    if (!state.current || document.visibilityState !== 'visible' || !nearBottom()) return;
    const last = [...state.messages].reverse().find(message => message.seq);
    if (!last) return;
    const room = state.rooms.find(entry => entry.id === state.current);
    if (room && room.unread) { room.unread = 0; renderRooms(); }
    send({ type: 'read', roomId: state.current, seq: last.seq });
  }

  function viewImage(src) {
    const viewer = make('dialog', 'viewer');
    const image = make('img');
    image.src = src;
    image.alt = '사진 크게 보기';
    viewer.appendChild(image);
    viewer.addEventListener('click', () => viewer.close());
    viewer.addEventListener('close', () => viewer.remove());
    document.body.appendChild(viewer);
    viewer.showModal();
  }

  function messageMenu(message) {
    if (message.kind === 'system' || message.deletedAt) return;
    const mine = message.userId === state.me.id;
    openSheet('메시지', body => {
      const menu = make('div', 'menu-list');
      const add = (label, action, danger) => {
        const button = make('button', danger ? 'danger' : '', label);
        button.type = 'button';
        button.addEventListener('click', action);
        menu.appendChild(button);
      };
      if (message.kind === 'text') add('복사', async () => { closeSheet(); await copyText(message.text); });
      if (message.kind === 'text') add('카카오톡으로 보내기', () => {
        closeSheet();
        if (announcementOf(message.text)) shareAnnouncement(message.text);
        else if (!message.userId && SHARE_CHANNELS.includes(state.room?.id)) forwardActions(message).querySelector('.kakao').click();
        else shareText(`${message.text}\n\n— 스페이스 톡 '${state.room.name}'에서 (${message.nickname || ''})`);
      });
      if (message.kind === 'text') add('문자로 보내기', () => {
        closeSheet();
        const info = announcementOf(message.text);
        sendSms(info ? `${info.kind.label} ${info.title}${info.body ? `\n\n${info.body}` : ''}${info.link ? `\n\n${info.link}` : ''}` : `${message.text}\n\n— 스페이스 톡 '${state.room.name}'에서`);
      });
      if (message.kind === 'text' && state.me.admin) add('📤 슬랙으로 보내기 (운영자)', () => { closeSheet(); sendToSlack(message); });
      if (message.kind === 'text') add('게시판에 옮겨 쓰기 (소통·나눔 등)', () => moveToBoard(message.text));
      if (message.kind === 'text' && (state.room.isOwner || state.room.kind === 'dm' || state.me.admin)) add('공지로 등록', async () => { if (await saveNotice(state.current, message.text)) closeSheet(); });
      if (!mine && !state.me.guest && state.room.kind === 'group' && message.userId) add(`${message.nickname}님과 1:1 대화`, () => { closeSheet(); startDm({ userId: message.userId }); });
      const canEdit = message.kind === 'text' && ((mine && Date.now() - new Date(message.createdAt) < 24 * 60 * 60 * 1000) ||
        (state.me.admin && !message.userId && state.room.kind === 'channel'));
      if (canEdit) add('✏️ 고치기 (보낸 내용 수정)', () => editSheet(message));
      const canDelete = (mine && Date.now() - new Date(message.createdAt) < 5 * 60 * 1000) || state.room.isOwner || state.me.admin;
      if (canDelete) add('삭제 (모두에게서)', async () => {
        if (!confirm('이 메시지를 모두에게서 삭제할까요?')) return;
        try { await api(`/api/chat/rooms/${state.current}/messages/${message.id}/delete`, { method: 'POST', body: {} }); closeSheet(); } catch (error) { toast(error.message); }
      }, true);
      if (!mine && message.userId) add('신고하기', () => reportSheet(message), true);
      body.appendChild(menu);
    });
  }
  // 보낸 메시지 고치기. 모임안내 카드는 끝의 '안내장 사진·자세히 보기' 줄을 그대로 두고 본문만 고친다.
  function editSheet(message) {
    const trailer = (/(\n*안내장 사진: \S+)?\n*자세히 보기·카카오톡 공유: \S+\s*$/.exec(message.text) || [''])[0];
    const base = trailer ? message.text.slice(0, message.text.length - trailer.length) : message.text;
    openSheet('보낸 메시지 고치기', body => {
      body.appendChild(make('p', '', '고친 내용은 이 방의 모든 사람에게 바로 바뀌어 보이고 "수정됨"이 붙어요. 이미 카카오톡으로 보낸 카드는 바뀌지 않으니, 필요하면 고친 뒤 다시 보내 주세요.'));
      const input = make('textarea', 'edit-text');
      input.value = base;
      input.rows = Math.min(14, Math.max(4, base.split('\n').length + 1));
      input.setAttribute('aria-label', '고칠 내용');
      const save = make('button', 'btn navy block', '고친 내용 저장');
      save.type = 'button';
      save.addEventListener('click', async () => {
        let text = input.value.trim();
        if (!text) { toast('내용을 적어 주세요.'); return; }
        // 모임안내·초청장·정보안내는 맨 앞의 [정보안내] 같은 표시가 있어야 카드·카톡 공유·공유 화면이 유지된다.
        // 표시를 지웠거나 그 위에 다른 줄을 넣었으면 표시를 맨 앞으로 되돌린다(그 다음 줄이 제목).
        const kind = ANNOUNCE_KINDS.find(entry => base.trim().startsWith(entry.tag));
        if (kind && !text.startsWith(kind.tag)) {
          text = `${kind.tag}\n${text.split(kind.tag).join('').replace(/^\s+/, '')}`;
          toast(`맨 앞의 ${kind.tag} 표시를 되살렸어요. 표시 바로 다음 줄이 제목이 됩니다.`);
        }
        save.disabled = true;
        try {
          const result = await api(`/api/chat/rooms/${state.current}/messages/${message.id}/edit`, { method: 'POST', body: { text: `${text}${trailer}` } });
          applyEdit(result.message);
          closeSheet();
          toast('고쳤어요.');
        } catch (error) { toast(error.message); save.disabled = false; }
      });
      body.append(input, save);
      setTimeout(() => input.focus(), 50);
    });
  }
  function applyEdit(updated) {
    if (!updated || updated.roomId !== state.current) return;
    const message = state.messages.find(entry => entry.id === updated.id);
    if (message) { message.text = updated.text; message.editedAt = updated.editedAt; renderMessages(); }
  }
  function reportSheet(message) {
    openSheet('메시지 신고', body => {
      body.appendChild(make('p', '', '욕설, 허위사실, 개인정보 노출, 광고·불법 내용이면 신고해 주세요. 신고된 메시지는 운영자가 검토합니다.'));
      const label = make('label', '', '신고 사유');
      const select = make('select');
      ['욕설·비방', '허위사실·명예훼손', '개인정보 노출', '광고·스팸', '음란·불법', '기타'].forEach(value => select.appendChild(make('option', '', value)));
      label.appendChild(select);
      const submit = make('button', 'btn navy block', '신고하기');
      submit.type = 'button';
      submit.addEventListener('click', async () => {
        submit.disabled = true;
        try { const result = await api(`/api/chat/rooms/${state.current}/messages/${message.id}/report`, { method: 'POST', body: { reason: select.value } }); toast(result.message); closeSheet(); } catch (error) { toast(error.message); submit.disabled = false; }
      });
      body.append(label, submit);
    });
  }

  // ---------- sending ----------
  const input = $('input');
  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(140, input.scrollHeight)}px`;
    $('btn-send').disabled = !input.value.trim();
  }
  input.addEventListener('input', () => {
    autosize();
    if (state.current && input.value.trim() && Date.now() - state.lastTypingSent > 2500) {
      state.lastTypingSent = Date.now();
      send({ type: 'typing', roomId: state.current });
    }
  });
  input.addEventListener('keydown', event => {
    const desktop = matchMedia('(pointer:fine)').matches;
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && desktop) {
      event.preventDefault();
      $('composer').requestSubmit();
    }
  });
  function pushPending(message) {
    state.pending.set(message.clientId, message);
    state.messages.push(message);
    renderMessages(true);
  }
  async function transmit(message) {
    if (send({ type: 'send', roomId: message.roomId, clientId: message.clientId, text: message.text, imageId: message.imageId })) return;
    // Realtime connection is down: send over plain HTTPS instead so nothing is lost.
    try {
      const result = await api(`/api/chat/rooms/${message.roomId}/messages`, { method: 'POST', body: { text: message.text, imageId: message.imageId } });
      handle({ type: 'sent', clientId: message.clientId, message: result.message });
    } catch (error) {
      message.failed = true;
      message.pending = false;
      toast(error.message);
      if (message.roomId === state.current) renderMessages();
    }
  }
  $('composer').addEventListener('submit', event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || !state.current) return;
    if (text.length > 2000) { toast('메시지는 2,000자까지 보낼 수 있어요.'); return; }
    const message = { id: `local-${crypto.randomUUID()}`, clientId: crypto.randomUUID(), roomId: state.current, userId: state.me.id, nickname: state.me.nickname,
      kind: 'text', text, createdAt: new Date().toISOString(), pending: true };
    input.value = '';
    autosize();
    pushPending(message);
    transmit(message);
    input.focus();
  });
  function resend(message) {
    message.failed = false;
    message.pending = true;
    message.createdAt = new Date().toISOString();
    renderMessages();
    transmit(message);
  }

  // photos: shrink on the device before upload
  async function shrink(file) {
    if (file.type === 'image/gif' && file.size <= 2 * 1024 * 1024) return file;
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) throw new Error('사진을 읽을 수 없습니다.');
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.7, 0.55]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= 2 * 1024 * 1024) return blob;
    }
    throw new Error('사진이 너무 큽니다.');
  }
  $('file').addEventListener('change', event => {
    const file = event.target.files[0];
    event.target.value = '';
    sendPhoto(file);
  });
  // Pasting a copied picture into the message box sends it as a photo; pasted text goes in as usual.
  input.addEventListener('paste', event => {
    const file = [...(event.clipboardData?.files || [])].find(item => item.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    if (confirm('복사한 사진을 보낼까요?')) sendPhoto(file);
  });
  async function sendPhoto(file) {
    if (!file || !state.current) return;
    if (!file.type.startsWith('image/')) { toast('사진 파일만 보낼 수 있어요.'); return; }
    const roomId = state.current;
    const message = { id: `local-${crypto.randomUUID()}`, clientId: crypto.randomUUID(), roomId, userId: state.me.id, nickname: state.me.nickname,
      kind: 'image', text: '', createdAt: new Date().toISOString(), pending: true, localUrl: URL.createObjectURL(file) };
    pushPending(message);
    try {
      const blob = await shrink(file);
      const { imageId } = await api(`/api/chat/rooms/${roomId}/images`, { method: 'POST', raw: blob, type: blob.type || 'image/jpeg' });
      message.imageId = imageId;
      transmit(message);
    } catch (error) {
      toast(error.message);
      message.failed = true;
      message.pending = false;
      renderMessages();
    }
  }

  // ---------- realtime ----------
  function send(payload) {
    if (state.socket?.readyState !== WebSocket.OPEN) return false;
    state.socket.send(JSON.stringify(payload));
    return true;
  }
  function connect() {
    clearTimeout(connect.timer);
    setConn('연결 중…');
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/talk`);
    state.socket = socket;
    socket.addEventListener('open', () => {
      state.retry = 1000;
      setConn('실시간 연결됨');
      send({ type: 'presence', visible: document.visibilityState === 'visible' });
      // catch up on anything missed while disconnected
      loadRooms().catch(() => {});
      if (state.current) refreshCurrent();
    });
    socket.addEventListener('message', event => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      handle(data);
    });
    socket.addEventListener('close', event => {
      if (event.code === 4001) { setConn('계정이 삭제되어 연결을 끊었습니다.', true); return; }
      setConn('연결이 끊겼습니다. 다시 연결하는 중…', true);
      for (const message of state.pending.values()) if (message.pending) { message.pending = false; message.failed = true; }
      if (state.current) renderMessages();
      connect.timer = setTimeout(connect, state.retry);
      state.retry = Math.min(state.retry * 2, 20000);
    });
  }
  setInterval(() => send({ type: 'ping' }), 45000);

  async function refreshCurrent() {
    const roomId = state.current;
    try {
      const [{ room }, data] = await Promise.all([api(`/api/chat/rooms/${roomId}`), api(`/api/chat/rooms/${roomId}/messages`)]);
      if (state.current !== roomId) return;
      const failed = state.messages.filter(message => message.failed);
      state.room = { ...room, members: data.members };
      state.messages = [...data.messages, ...failed];
      state.hasMore = data.hasMore;
      renderRoomHead();
      renderMessages();
      markRead();
    } catch (error) {
      if (error.status === 403 || error.status === 404) { toast('대화방에 더 이상 참여하고 있지 않아요.'); closeRoom(); history.replaceState(null, '', '/chat'); }
    }
  }

  function handle(data) {
    if (data.type === 'hello') return;
    if (data.type === 'sent') {
      const local = state.pending.get(data.clientId);
      state.pending.delete(data.clientId);
      if (local) {
        const index = state.messages.indexOf(local);
        if (local.localUrl) URL.revokeObjectURL(local.localUrl);
        if (index >= 0 && !state.messages.some(message => message.id === data.message.id)) state.messages[index] = data.message;
        else if (index >= 0) state.messages.splice(index, 1);
        if (local.roomId === state.current) renderMessages();
      }
      return;
    }
    if (data.type === 'error') {
      const local = data.clientId && state.pending.get(data.clientId);
      if (local) { local.pending = false; local.failed = true; if (local.roomId === state.current) renderMessages(); }
      toast(data.error);
      return;
    }
    if (data.type === 'message') {
      const { message } = data;
      const room = state.rooms.find(entry => entry.id === data.roomId);
      if (room) {
        room.lastAt = message.createdAt;
        room.lastPreview = message.kind === 'image' ? '사진' : message.text.slice(0, 80);
        if (message.userId !== state.me.id && message.kind !== 'system' && !(data.roomId === state.current && document.visibilityState === 'visible' && nearBottom())) room.unread += 1;
        state.rooms.sort((left, right) => right.lastAt.localeCompare(left.lastAt));
        renderRooms();
      } else {
        loadRooms().catch(() => {});
      }
      if (data.roomId === state.current) {
        if (state.messages.some(entry => entry.id === message.id)) return;
        const atBottom = nearBottom();
        state.messages.push(message);
        if (message.userId === state.me.id) {
          const member = state.room.members.find(entry => entry.id === state.me.id);
          if (member) member.lastReadSeq = message.seq;
        }
        renderMessages();
        if (atBottom) { keepBottom(true); markRead(); } else if (message.userId !== state.me.id) $('btn-jump').hidden = false;
        if (message.userId !== state.me.id && message.kind !== 'system') $('typing').textContent = '';
      }
      return;
    }
    if (data.type === 'read' && data.roomId === state.current && state.room) {
      const member = state.room.members.find(entry => entry.id === data.userId);
      if (member && data.seq > member.lastReadSeq) { member.lastReadSeq = data.seq; renderMessages(); }
      return;
    }
    if (data.type === 'edited') {
      applyEdit(data.message);
      loadRooms().catch(() => {});
      return;
    }
    if (data.type === 'deleted') {
      if (data.roomId === state.current) {
        const message = state.messages.find(entry => entry.id === data.messageId);
        if (message) { message.deletedAt = new Date().toISOString(); message.text = ''; renderMessages(); }
      }
      loadRooms().catch(() => {});
      return;
    }
    if (data.type === 'typing' && data.roomId === state.current) {
      $('typing').textContent = `${data.nickname}님이 입력 중…`;
      clearTimeout(state.typingTimer);
      state.typingTimer = setTimeout(() => { $('typing').textContent = ''; }, 3500);
      return;
    }
    if (data.type === 'room') {
      loadRooms().catch(() => {});
      if (data.roomId === state.current) api(`/api/chat/rooms/${data.roomId}`).then(({ room }) => {
        if (state.current === data.roomId) { state.room = { ...room }; renderRoomHead(); renderMessages(); }
      }).catch(() => refreshCurrent());
      return;
    }
    if (data.type === 'removed') {
      if (data.roomId === state.current) { toast('대화방에서 내보내졌어요.'); closeRoom(); history.replaceState(null, '', '/chat'); }
      loadRooms().catch(() => {});
    }
  }

  document.addEventListener('visibilitychange', () => {
    send({ type: 'presence', visible: document.visibilityState === 'visible' });
    // 다른 기기(휴대폰·PC)에서 만들거나 초대받은 대화방이 있을 수 있으니, 창으로 돌아오면 목록을 새로 받는다.
    if (document.visibilityState === 'visible') loadRooms().catch(() => {});
    if (document.visibilityState === 'visible') { markRead(); if (navigator.clearAppBadge && !state.rooms.some(room => room.unread)) navigator.clearAppBadge().catch(() => {}); }
  });

  // ---------- room menu ----------
  $('btn-back').addEventListener('click', () => {
    if (state.fromList) { state.fromList = false; history.back(); return; }
    history.replaceState(null, '', '/chat');
    route();
  });
  $('btn-room-menu').addEventListener('click', () => roomMenu());
  // 방장·운영자는 대화방 이름을 눌러 바로 이름을 바꿀 수 있다.
  $('room-title').addEventListener('click', () => {
    const room = state.room;
    if (room?.kind === 'group' && (room.isOwner || state.me.admin)) renameSheet(room);
  });
  function roomMenu() {
    const room = state.room;
    if (!room) return;
    openSheet(room.kind === 'dm' ? `${room.name}님과의 대화` : room.name, body => {
      if (room.kind === 'channel') body.appendChild(make('p', '', '정부 부처가 대한민국 정책브리핑에 올린 전날 정책뉴스를 매일 아침 7시 30분에 모아 보내 드리는 읽기 전용 채널입니다. 제목 아래 링크를 누르면 원문을 볼 수 있어요.'));
      const online = new Set(room.online || []);
      if (room.kind === 'group') {
        body.appendChild(make('div', 'section-title', `참여자 ${room.memberCount}명 / 최대 ${room.maxMembers}명`));
        if (!state.me.guest) {
          const call = make('button', 'btn gold block call-members', '👥 회원 불러오기 (이름으로 찾아 바로 넣기)');
          call.type = 'button';
          call.addEventListener('click', () => addMembersSheet(room));
          body.appendChild(call);
        }
        for (const member of room.members) {
          const row = make('div', 'member');
          row.appendChild(avatar(member.nickname, member.id, true));
          const who = make('div', 'who');
          who.appendChild(make('strong', '', `${member.nickname}${member.id === state.me.id ? ' (나)' : ''}`));
          const sub = make('span');
          if (online.has(member.id)) sub.appendChild(make('span', 'dot-online'));
          sub.append(member.role === 'owner' ? '방장' : online.has(member.id) ? '접속 중' : '');
          who.appendChild(sub);
          const acts = make('div', 'acts');
          if (member.id !== state.me.id) {
            if (!state.me.guest) {
              const dm = make('button', '', '1:1 대화');
              dm.type = 'button';
              dm.addEventListener('click', () => { closeSheet(); startDm({ userId: member.id }); });
              acts.appendChild(dm);
            }
            if (room.isOwner) {
              const kick = make('button', '', '내보내기');
              kick.type = 'button';
              kick.addEventListener('click', async () => {
                if (!confirm(`${member.nickname}님을 대화방에서 내보낼까요?`)) return;
                try { await api(`/api/chat/rooms/${room.id}/kick`, { method: 'POST', body: { userId: member.id } }); closeSheet(); } catch (error) { toast(error.message); }
              });
              acts.appendChild(kick);
            }
          }
          row.append(who, acts);
          body.appendChild(row);
        }
        body.appendChild(make('div', 'section-title', '초대 링크'));
        const url = `${location.origin}/chat#join=${room.inviteCode}`;
        body.appendChild(make('p', '', '링크를 받은 사람은 이름만 적고 회원가입 없이 바로 들어올 수 있습니다. 링크가 원치 않게 퍼졌다면 방장이 새 링크로 바꿀 수 있습니다.'));
        body.appendChild(linkBox(url));
        const share = shareButton(url, inviteText(room.name), { kindLabel: '💬 스페이스 톡 초대', cardTitle: `'${room.name}' 대화방에 초대합니다`, body: '아래 「대화방 들어가기」를 누르고 이름만 적으면 바로 들어올 수 있어요.\n회원가입은 필요 없습니다.' });
        if (share) body.appendChild(share);
      }
      const menu = make('div', 'menu-list');
      const add = (label, action, danger) => {
        const button = make('button', danger ? 'danger' : '', label);
        button.type = 'button';
        button.addEventListener('click', action);
        menu.appendChild(button);
      };
      add(room.muted ? '이 방 알림 켜기' : '이 방 알림 끄기', async () => {
        try {
          const result = await api(`/api/chat/rooms/${room.id}/mute`, { method: 'POST', body: { muted: !room.muted } });
          room.muted = result.muted;
          const entry = state.rooms.find(item => item.id === room.id);
          if (entry) entry.muted = result.muted;
          renderRooms();
          toast(result.muted ? '이 방의 알림을 껐어요.' : '이 방의 알림을 켰어요.');
          closeSheet();
        } catch (error) { toast(error.message); }
      });
      if (room.kind !== 'channel' && (room.isOwner || room.kind === 'dm' || state.me.admin)) add(room.notice ? '공지사항 수정·내리기' : '공지사항 등록', () => noticeSheet(room));
      if (room.notice) add('공지 복사', () => { closeSheet(); copyText(room.notice.text); });
      if (room.notice) add('공지를 카카오톡으로 보내기', () => { closeSheet(); shareText(`[${room.name} 공지]\n${room.notice.text}`); });
      if (room.kind === 'group' && (room.isOwner || state.me.admin)) add('✏️ 대화방 이름 바꾸기 (모든 참여자에게)', () => renameSheet(room));
      if (room.kind === 'group' && room.isOwner) {
        add('초대 링크 새로 만들기', async () => {
          if (!confirm('기존 초대 링크는 더 이상 쓸 수 없게 됩니다. 새 링크를 만들까요?')) return;
          try { const result = await api(`/api/chat/rooms/${room.id}/update`, { method: 'POST', body: { resetInvite: true } }); state.room = result.room; toast('새 초대 링크를 만들었어요.'); roomMenu(); } catch (error) { toast(error.message); }
        });
      }
      add(room.kind === 'channel' ? '구독 그만하기' : '대화방 나가기', async () => {
        if (!confirm(room.kind === 'channel' ? '정책브리핑 받아 보기를 그만할까요? 나중에 목록에서 다시 받아 볼 수 있어요.' : room.kind === 'group' ? '대화방을 나가면 대화 내용이 내 목록에서 사라집니다. 나갈까요?' : '1:1 대화방을 나갈까요? 상대는 더 이상 메시지를 보낼 수 없습니다.')) return;
        try {
          await api(`/api/chat/rooms/${room.id}/leave`, { method: 'POST', body: {} });
          closeSheet();
          state.rooms = state.rooms.filter(entry => entry.id !== room.id);
          closeRoom();
          history.replaceState(null, '', '/chat');
        } catch (error) { toast(error.message); }
      }, true);
      body.appendChild(menu);
    });
  }
  function renameSheet(room) {
    openSheet('대화방 이름 바꾸기 (모든 참여자에게)', body => {
      body.appendChild(make('p', '', '대화방 이름은 방장 또는 운영자만 바꿀 수 있어요. 바꾸면 이 방의 모든 참여자에게 새 이름으로 보이고, 대화방에 바뀌었다는 안내가 표시됩니다.'));
      const label = make('label', '', '새 이름');
      const field = make('input');
      field.type = 'text';
      field.maxLength = 40;
      field.value = room.name;
      label.appendChild(field);
      const save = make('button', 'btn navy block', '저장');
      save.type = 'button';
      save.addEventListener('click', async () => {
        try { const result = await api(`/api/chat/rooms/${room.id}/update`, { method: 'POST', body: { name: field.value } }); state.room = result.room; renderRoomHead(); closeSheet(); } catch (error) { toast(error.message); }
      });
      body.append(label, save);
      field.focus();
    });
  }

  // ---------- create / join / 1:1 ----------
  function createSheet() {
    openSheet('새 대화방 만들기', body => {
      body.appendChild(make('p', '', '만든 뒤 초대 링크를 보내면 회원들이 들어올 수 있어요. 대화는 참여자만 볼 수 있습니다.'));
      const nameLabel = make('label', '', '대화방 이름');
      const name = make('input');
      name.type = 'text';
      name.maxLength = 40;
      name.placeholder = '예: 우리 동네 정책 모임';
      nameLabel.appendChild(name);
      const sizeLabel = make('label', '', '최대 인원');
      const size = make('select');
      [5, 10, 20, 30, 50, state.maxMembers].filter((value, index, list) => list.indexOf(value) === index).forEach(value => {
        const option = make('option', '', `${value}명`);
        option.value = String(value);
        size.appendChild(option);
      });
      size.value = '20';
      sizeLabel.appendChild(size);
      const create = make('button', 'btn gold block', '만들기');
      create.type = 'button';
      create.addEventListener('click', async () => {
        if (!name.value.trim()) { toast('대화방 이름을 입력해 주세요.'); name.focus(); return; }
        create.disabled = true;
        try {
          const { room } = await api('/api/chat/rooms', { method: 'POST', body: { name: name.value, maxMembers: Number(size.value) } });
          await loadRooms();
          location.hash = `room=${room.id}`;
          inviteSheet(room);
        } catch (error) { toast(error.message); create.disabled = false; }
      });
      body.append(nameLabel, sizeLabel, create);
      name.focus();
    });
  }
  // ---------- 회원 불러오기: 닉네임으로 찾아 여러 명을 골라 한 번에 방에 넣는다 ----------
  function addMembersSheet(room) {
    const chosen = new Map();
    openSheet('회원 불러오기', body => {
      body.appendChild(make('p', '', `스페이스 커뮤니티 회원을 이름(닉네임)이나 가입한 이메일 주소로 찾아 '${room.name}' 방에 바로 넣어요. 휴대폰 번호를 적으면 그 번호로 초대 문자를 보낼 수 있어요.`));
      const search = make('input', 'member-search');
      search.type = 'search';
      search.placeholder = '이름(닉네임) 또는 가입한 이메일 주소';
      search.setAttribute('aria-label', '회원 이름 검색');
      search.maxLength = 254;
      const heading = make('div', 'section-title', '함께 대화한 사람들');
      const list = make('div', 'member-pick');
      const submit = make('button', 'btn navy block', '선택한 회원 불러오기');
      submit.type = 'button';
      submit.disabled = true;
      const refreshButton = () => {
        submit.disabled = !chosen.size;
        submit.textContent = chosen.size ? `선택한 ${chosen.size}명 불러오기` : '불러올 회원을 골라 주세요';
      };
      const render = (people, query) => {
        heading.textContent = query ? `'${query}' 검색 결과` : '함께 대화한 사람들';
        list.replaceChildren();
        if (!people.length) {
          list.appendChild(make('p', 'empty-note', query ? (query.includes('@') ? '이 이메일로 가입한 회원이 없어요. 주소 전체를 정확히 적었는지 확인하거나, 초대 링크를 보내 주세요.' : '이 이름(닉네임)의 회원이 없어요. 전화기에 저장된 이름과 사이트 닉네임이 다를 수 있어요. 이메일 주소로 찾거나, 휴대폰 번호를 적어 초대 문자를 보내 보세요.') : '위 칸에 이름이나 이메일을 적어 회원을 찾아 보세요.'));
          return;
        }
        for (const person of people) {
          const row = make('label', 'member');
          row.appendChild(avatar(person.nickname, person.id, true));
          const who = make('div', 'who');
          who.appendChild(make('strong', '', person.nickname));
          if (person.inRoom) who.appendChild(make('span', '', '이미 이 방에 있어요'));
          const box = make('input');
          box.type = 'checkbox';
          box.disabled = person.inRoom;
          box.checked = person.inRoom || chosen.has(person.id);
          box.setAttribute('aria-label', `${person.nickname} 고르기`);
          box.addEventListener('change', () => {
            if (box.checked) chosen.set(person.id, person.nickname); else chosen.delete(person.id);
            refreshButton();
          });
          row.append(who, box);
          list.appendChild(row);
        }
      };
      let timer = null;
      let latest = 0;
      // 휴대폰 번호: 스페이스 커뮤니티는 전화번호를 받지 않아 회원을 찾을 수 없으므로, 그 번호로 초대 문자(링크)를 보내게 한다.
      const phoneOf = value => {
        const digits = value.replace(/[\s-]/g, '');
        return /^(01[016789]\d{7,8}|0\d{8,10})$/.test(digits) ? digits : null;
      };
      const phoneInvite = phone => {
        heading.textContent = '휴대폰 번호로 초대하기';
        list.replaceChildren();
        list.appendChild(make('p', 'empty-note', '스페이스 커뮤니티는 가입할 때 전화번호를 받지 않아서, 번호로는 회원을 찾을 수 없어요. 대신 이 번호로 초대 문자를 보내면, 받은 분이 링크를 누르고 이름만 적어 바로 들어옵니다.'));
        if (!room.inviteCode) return;
        const url = `${location.origin}/chat#join=${room.inviteCode}`;
        const text = `${inviteText(room.name)}\n${url}`;
        const sms = make('a', 'btn gold block', `📱 ${phone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3')}로 초대 문자 보내기`);
        sms.href = `sms:${phone}${/iPhone|iPad|iPod/.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(text)}`;
        const copy = make('button', 'btn block', '초대 문구 복사 (카톡에 붙여넣기)');
        copy.type = 'button';
        copy.addEventListener('click', async () => { if (await copyText(text)) toast('복사했어요. 카카오톡이나 문자에 붙여넣어 보내세요.'); });
        list.append(sms, copy);
        if (!/Android|iPhone|iPad|iPod/.test(navigator.userAgent)) list.appendChild(make('p', 'empty-note', 'PC에서는 문자 보내기가 열리지 않을 수 있어요. 휴대폰에서 누르거나 초대 문구를 복사해 보내 주세요.'));
      };
      const load = async () => {
        const query = search.value.trim();
        const ticket = ++latest;
        const phone = phoneOf(query);
        if (phone) { phoneInvite(phone); return; }
        try {
          const result = await api(`/api/chat/rooms/${room.id}/candidates?q=${encodeURIComponent(query)}`);
          if (ticket === latest) render(result.members || [], query);
        } catch (error) { if (ticket === latest) list.replaceChildren(make('p', 'empty-note', error.message)); }
      };
      search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
      submit.addEventListener('click', async () => {
        submit.disabled = true;
        try {
          const result = await api(`/api/chat/rooms/${room.id}/add`, { method: 'POST', body: { userIds: [...chosen.keys()] } });
          toast(`${result.added}명을 불렀어요.`);
          closeSheet();
          if (state.current === room.id && result.room) state.room = { ...state.room, ...result.room };
          loadRooms();
        } catch (error) { toast(error.message); refreshButton(); }
      });
      body.append(search, heading, list, submit);
      refreshButton();
      load();
      setTimeout(() => search.focus(), 50);
    });
  }
  function inviteSheet(room) {
    const url = `${location.origin}/chat#join=${room.inviteCode}`;
    openSheet('친구 초대하기', body => {
      body.appendChild(make('p', '', `'${room.name}' 대화방이 만들어졌어요. 스페이스 커뮤니티 회원은 이름으로 바로 불러오고, 회원이 아닌 분은 아래 초대 링크를 보내 주세요.`));
      const call = make('button', 'btn gold block call-members', '👥 회원 불러오기 (이름으로 찾아 바로 넣기)');
      call.type = 'button';
      call.addEventListener('click', () => addMembersSheet(room));
      body.appendChild(call);
      body.appendChild(make('div', 'section-title', '회원이 아닌 분 초대 링크'));
      body.appendChild(linkBox(url));
      const share = shareButton(url, inviteText(room.name), { kindLabel: '💬 스페이스 톡 초대', cardTitle: `'${room.name}' 대화방에 초대합니다`, body: '아래 「대화방 들어가기」를 누르고 이름만 적으면 바로 들어올 수 있어요.\n회원가입은 필요 없습니다.' });
      if (share) body.appendChild(share);
    });
  }
  async function joinFlow(code) {
    try {
      const preview = await api(`/api/chat/invite/${encodeURIComponent(code)}`);
      openSheet('대화방 초대', body => {
        body.appendChild(make('p', '', `'${preview.name}' 대화방에 초대받았어요. 현재 ${preview.memberCount}명 / 최대 ${preview.maxMembers}명`));
        const join = make('button', 'btn gold block', '들어가기');
        join.type = 'button';
        join.addEventListener('click', async () => {
          join.disabled = true;
          try { const { room } = await api('/api/chat/join', { method: 'POST', body: { code } }); closeSheet(); await loadRooms(); location.hash = `room=${room.id}`; } catch (error) { toast(error.message); join.disabled = false; }
        });
        body.appendChild(join);
      });
    } catch (error) { toast(error.message); }
  }
  async function startDm(target) {
    try {
      const { room } = await api('/api/chat/dm', { method: 'POST', body: target });
      await loadRooms();
      location.hash = `room=${room.id}`;
    } catch (error) { toast(error.message); }
  }
  function myLinkSheet() {
    const url = `${location.origin}/chat#dm=${state.me.code}`;
    openSheet('초대하기 (1:1 대화)', body => {
      body.appendChild(make('p', '', '이 링크를 받은 회원은 나와 바로 1:1 대화를 시작할 수 있어요. 링크를 아는 회원만 대화를 걸 수 있습니다.'));
      body.appendChild(linkBox(url));
      const share = shareButton(url, `[스페이스 톡] ${state.me.nickname}님과 1:1 대화해요.\n아래 링크를 누르고 로그인하면 바로 대화가 시작됩니다. (처음이면 회원가입 후 이용)`,
        { kindLabel: '💬 스페이스 톡 1:1 대화', cardTitle: `${state.me.nickname}님과 1:1 대화해요`, body: '아래 「대화 시작하기」를 누르고 로그인하면 바로 대화가 시작됩니다.\n처음이면 회원가입 후 이용해 주세요.', button: '대화 시작하기' });
      if (share) body.appendChild(share);
    });
  }
  $('btn-new').addEventListener('click', createSheet);
  $('empty-new').addEventListener('click', createSheet);
  $('empty-link').addEventListener('click', myLinkSheet);
  $('btn-menu').addEventListener('click', () => {
    openSheet('메뉴', body => {
      const menu = make('div', 'menu-list');
      const add = (label, action) => {
        const button = make('button', '', label);
        button.type = 'button';
        button.addEventListener('click', action);
        menu.appendChild(button);
      };
      if (state.me.guest) {
        body.appendChild(make('p', 'guest-badge', `${state.me.nickname}(으)로 참여 중입니다. 초대받은 대화방에서 대화할 수 있고, 이 휴대폰(브라우저)에서 계속 이어서 쓸 수 있어요. 대화방을 직접 만들거나 PC 등 다른 기기에서도 같은 대화방을 보려면 회원가입(또는 로그인)을 해 주세요. 손님으로 들어온 대화는 이 기기에만 보입니다.`));
        const join = make('a', '', '회원가입 하기');
        join.href = '/#signup';
        menu.appendChild(join);
      } else {
        body.appendChild(make('p', 'account-line', `접속 계정: ${state.me.nickname} (회원) — 휴대폰과 PC에서 같은 계정으로 로그인하면 대화방이 똑같이 보여요.`));
        add('새 대화방 만들기', createSheet);
        add('초대하기', myLinkSheet);
      }
      add(pushEnabled() ? '이 기기 알림 끄기' : '이 기기 알림 켜기', () => { closeSheet(); pushEnabled() ? disablePush() : enablePush(); });
      if (state.me.admin) add('신고된 메시지 관리 (운영자)', reportsSheet);
      const home = make('a', '', '스페이스 커뮤니티 홈');
      home.href = '/';
      menu.appendChild(home);
      body.appendChild(menu);
      body.appendChild(make('p', '', `대화 내용은 ${state.retentionDays}일 동안 보관된 뒤 자동으로 삭제됩니다. 대화는 참여자만 볼 수 있고, 신고된 메시지만 운영자가 확인합니다.`));
    });
  });
  async function reportsSheet() {
    try {
      const { reports } = await api('/api/chat/admin/reports');
      openSheet('신고된 메시지', body => {
        if (!reports.length) { body.appendChild(make('p', '', '처리할 신고가 없습니다.')); return; }
        for (const report of reports) {
          const item = make('div', 'report-item');
          item.appendChild(make('strong', '', `${report.roomName} · ${report.nickname} · 신고 ${report.count}건`));
          item.appendChild(make('div', 'quote', report.text));
          item.appendChild(make('p', '', `사유: ${report.reason} · ${new Date(report.createdAt).toLocaleString('ko-KR')}`));
          const row = make('div', 'row');
          for (const [label, action] of [['메시지 삭제', 'delete'], ['문제 없음', 'keep']]) {
            const button = make('button', `btn${action === 'delete' ? ' danger' : ''}`, label);
            button.type = 'button';
            button.addEventListener('click', async () => {
              try { await api('/api/chat/admin/reports', { method: 'POST', body: { messageId: report.messageId, action } }); item.remove(); toast('처리했습니다.'); } catch (error) { toast(error.message); }
            });
            row.appendChild(button);
          }
          item.appendChild(row);
          body.appendChild(item);
        }
      });
    } catch (error) { toast(error.message); }
  }

  // ---------- web push ----------
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let registration = null;
  let subscription = null;
  const pushEnabled = () => Boolean(subscription) && Notification.permission === 'granted';
  function keyBytes(base64) {
    const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
  }
  function updatePushBar() {
    const bar = $('push-bar');
    if (!state.me) { bar.hidden = true; return; }
    if (!pushSupported) {
      bar.hidden = !isIos;
      $('push-text').textContent = '아이폰은 Safari 공유 버튼 → "홈 화면에 추가"로 설치한 뒤 알림을 켤 수 있어요.';
      $('btn-push').hidden = true;
      return;
    }
    $('btn-push').hidden = false;
    if (Notification.permission === 'denied') {
      bar.hidden = false;
      $('push-text').textContent = '알림이 차단되어 있어요. 브라우저 설정에서 이 사이트의 알림을 허용해 주세요.';
      $('btn-push').hidden = true;
      return;
    }
    bar.hidden = pushEnabled() || localStorageGet('talk-push-dismissed') === '1';
    $('push-text').textContent = '새 메시지가 오면 휴대폰·PC로 알려 드릴까요?';
  }
  function localStorageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function localStorageSet(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } }
  async function enablePush() {
    if (!pushSupported) { toast(isIos ? '홈 화면에 추가한 뒤 알림을 켤 수 있어요.' : '이 브라우저는 웹 알림을 지원하지 않아요.'); return; }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { toast('알림이 허용되지 않았어요.'); updatePushBar(); return; }
      registration = registration || await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(state.vapidKey) });
      await api('/api/chat/push', { method: 'POST', body: { endpoint: subscription.endpoint } });
      toast('이 기기에서 새 메시지 알림을 받습니다.');
    } catch (error) {
      console.error('Push subscribe failed:', error);
      toast('알림을 켜지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
    updatePushBar();
  }
  async function disablePush() {
    try {
      if (subscription) {
        await api('/api/chat/push/remove', { method: 'POST', body: { endpoint: subscription.endpoint } }).catch(() => {});
        await subscription.unsubscribe();
      }
      subscription = null;
      toast('이 기기의 알림을 껐어요.');
    } catch (error) { toast('알림을 끄지 못했어요.'); }
    updatePushBar();
  }
  $('btn-push').addEventListener('click', enablePush);
  async function initPush() {
    if (!pushSupported) { updatePushBar(); return; }
    try {
      registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      subscription = await registration.pushManager.getSubscription();
      // re-register the endpoint so the server always knows this device (endpoints can rotate)
      if (subscription && Notification.permission === 'granted') await api('/api/chat/push', { method: 'POST', body: { endpoint: subscription.endpoint } });
    } catch (error) { console.error('Service worker failed:', error); }
    updatePushBar();
  }
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type === 'open' && typeof event.data.url === 'string') location.hash = new URL(event.data.url, location.origin).hash.slice(1);
  });

  // install prompt (Android/desktop Chrome)
  let installEvent = null;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installEvent = event;
    if (!standalone) $('install-bar').hidden = false;
  });
  $('btn-install').addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice.catch(() => null);
    installEvent = null;
    $('install-bar').hidden = true;
  });

  // ---------- routing ----------
  function route() {
    if (!state.me) return;
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.get('join')) { const code = params.get('join'); history.replaceState(null, '', '/chat'); if (state.current) closeRoom(); joinFlow(code); return; }
    if (params.get('dm')) { const code = params.get('dm'); history.replaceState(null, '', '/chat'); startDm({ code }); return; }
    const roomId = params.get('room');
    if (roomId && roomId !== state.current) openRoom(roomId);
    else if (!roomId && state.current) closeRoom();
  }
  window.addEventListener('hashchange', route);

  // ---------- 초대 링크로 바로 입장(회원가입 없이) ----------
  async function guestGate(code, gate) {
    let preview;
    try { preview = await api(`/api/chat/invite/${encodeURIComponent(code)}`); } catch (error) { gate('초대 링크를 열 수 없어요', error.message); return; }
    gate(`'${preview.name}' 대화방에 초대받았어요`, `현재 ${preview.memberCount}명이 대화하고 있어요. 이름만 적으면 바로 들어갈 수 있어요.`);
    $('guest-form').hidden = false;
    $('btn-new').hidden = true;
    $('gate-login').classList.remove('gold');
    $('gate-login').textContent = '회원 로그인';
    const input = $('guest-name');
    try { input.value = localStorage.getItem('space-guest-name') || ''; } catch { /* storage unavailable */ }
    input.focus();
    $('guest-form').addEventListener('submit', async event => {
      event.preventDefault();
      const nickname = input.value.trim();
      if (nickname.length < 2) { toast('이름을 2자 이상 적어 주세요.'); input.focus(); return; }
      $('guest-go').disabled = true;
      try {
        const { room } = await api('/api/chat/guest', { method: 'POST', body: { code, nickname } });
        try { localStorage.setItem('space-guest-name', nickname); localStorage.removeItem('space-pending-invite'); } catch { /* storage unavailable */ }
        location.replace(`/chat#room=${room.id}`);
        location.reload();
      } catch (error) { toast(error.message); $('guest-go').disabled = false; }
    });
  }

  // ---------- start ----------
  async function start() {
    let session;
    try { session = await (await fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' })).json(); } catch { session = null; }
    const gate = (title, text) => {
      $('gate').hidden = false;
      $('gate-title').textContent = title;
      $('gate-text').textContent = text;
      $('rooms-empty').hidden = true;
      $('room-filter').parentElement.hidden = true;
      setConn('');
    };
    const rememberInvite = () => {
      const params = new URLSearchParams(location.hash.slice(1));
      const code = params.get('join') || '';
      const dm = params.get('dm') || '';
      if (code || dm) {
        try { localStorage.setItem('space-pending-invite', JSON.stringify({ join: code, dm, until: Date.now() + 14 * 86400000 })); } catch { /* storage unavailable */ }
      }
      try { sessionStorage.setItem('space-after-login', `/chat${location.hash}`); } catch { /* storage unavailable */ }
    };
    $('gate-login').addEventListener('click', () => { rememberInvite(); location.href = '/#login'; });
    $('gate-signup').addEventListener('click', rememberInvite);
    const invited = /(^|[#&])(join|dm)=/.test(location.hash);
    if (invited) rememberInvite();
    const member = Boolean(session?.user) && (session.user.emailVerified || !session.mailConfigured);
    state.csrf = session?.csrfToken || '';
    if (!member) {
      // 초대 링크로 이미 손님 입장한 브라우저면 그대로 이어서 쓴다.
      let guestMe = null;
      try { guestMe = await api('/api/chat/me'); } catch { guestMe = null; }
      if (!guestMe?.user?.guest) {
        const code = new URLSearchParams(location.hash.slice(1)).get('join');
        if (code) { await guestGate(code, gate); return; }
        if (!session?.user) { gate('로그인이 필요해요', '스페이스 톡은 스페이스 커뮤니티 회원끼리 대화하는 공간입니다. 로그인하면 단체 대화방과 1:1 대화를 이용할 수 있어요. 초대 링크를 받았다면 그 링크로 바로 들어올 수 있어요.'); return; }
        gate('이메일 인증이 필요해요', '가입한 이메일로 받은 인증 링크를 눌러 인증을 마치면 스페이스 톡을 이용할 수 있어요. 메일이 없다면 홈 상단의 "인증 메일 보내기"를 눌러 주세요.');
        $('gate-login').textContent = '홈으로 가기';
        $('gate-signup').hidden = true;
        return;
      }
    }
    try {
      const me = await api('/api/chat/me');
      state.me = { ...me.user, admin: Boolean(member && session.user.admin) };
      if (state.me.guest) document.body.classList.add('guest-mode');
      state.vapidKey = me.vapidPublicKey;
      state.retentionDays = me.retentionDays;
      state.maxMembers = me.maxMembers;
    } catch (error) { gate('스페이스 톡을 열 수 없어요', error.message); return; }
    await loadRooms().catch(error => toast(error.message));
    connect();
    initPush();
    // 가입·인증을 거치느라 초대 링크가 사라졌으면 저장해 둔 초대를 이어서 연다.
    if (!/(^|[#&])(join|dm|room)=/.test(location.hash)) {
      try {
        const pending = JSON.parse(localStorage.getItem('space-pending-invite') || 'null');
        localStorage.removeItem('space-pending-invite');
        if (pending && pending.until > Date.now()) {
          if (pending.join) history.replaceState(null, '', `/chat#join=${encodeURIComponent(pending.join)}`);
          else if (pending.dm) history.replaceState(null, '', `/chat#dm=${encodeURIComponent(pending.dm)}`);
        }
      } catch { /* storage unavailable */ }
    } else {
      try { localStorage.removeItem('space-pending-invite'); } catch { /* storage unavailable */ }
    }
    route();
  }
  start();
})();
