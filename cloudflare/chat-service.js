// 스페이스 톡 Durable Object: 대화방 저장(chat-core) + 실시간 전송(WebSocket, 절전 지원) + 웹 알림
import { DurableObject } from 'cloudflare:workers';
import chatCore from '../chat-core.js';
import announcement from '../announcement.js';
import { loadVapid, sendPush } from './web-push.js';
import slackNotify from '../slack-notify.js';

const { createChatCore, ChatError, RETENTION_DAYS, MAX_ROOM_MEMBERS } = chatCore;
const DAY = 24 * 60 * 60 * 1000;
const POLICY_CHANNEL = 'channel-policy-briefing';
const POLICY_CHANNEL_NAME = '📰 오늘의 정책브리핑';
const EVENT_CHANNEL = 'channel-event-announcements';
const EVENT_CHANNEL_NAME = '📣 모임안내';
// 정보안내 채널: 운영자가 광장채팅에서 '📊 정보안내'로 올린 글(주간 시장분석 등)
const INFO_CHANNEL = 'channel-info-announcements';
const INFO_CHANNEL_NAME = '📊 정보안내';
// 모임안내 채널 글의 보낸 사람 이름(화면에는 로고와 함께 보인다)
const EVENT_SENDER = '스페이스 커뮤니티';
const sha256 = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const json = (body, status = 200, extra = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra } });

export class ChatService extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = createChatCore(ctx.storage.sql);
    ctx.storage.sql.exec('UPDATE chat_messages SET nickname = ? WHERE room_id = ? AND user_id IS NULL AND nickname IN (?, ?)',
      EVENT_SENDER, EVENT_CHANNEL, '광장채팅 운영자', '스페이스톡');
    this.limits = new Map();
    this.lastPush = new Map();
    // 운영자 슬랙 알림: 새 대화방·초대 링크 입장 (SLACK_WEBHOOK_URL이 있을 때만)
    this.slack = slackNotify.createSlackNotifier({ webhookUrl: env.SLACK_WEBHOOK_URL || '', siteUrl: env.SITE_URL || 'https://withpluces.com' });
    this.later = task => {
      if (!this.slack.ready) return;
      ctx.waitUntil(Promise.resolve().then(task).catch(error => console.error('Slack notify failed:', error.message)));
    };
    ctx.blockConcurrencyWhile(async () => {
      if (!(await ctx.storage.getAlarm())) await ctx.storage.setAlarm(Date.now() + DAY);
    });
  }

  async alarm() {
    this.core.purge();
    await this.ctx.storage.setAlarm(Date.now() + DAY);
  }

  vapid() {
    if (!this.vapidPromise) this.vapidPromise = loadVapid(async key => this.core.meta(key), async (key, value) => this.core.meta(key, value));
    return this.vapidPromise;
  }

  limit(key, max, duration) {
    const now = Date.now();
    const entry = this.limits.get(key);
    if (!entry || entry.until <= now) { this.limits.set(key, { count: 1, until: now + duration }); return; }
    entry.count += 1;
    if (entry.count > max) throw new ChatError(429, '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
    if (this.limits.size > 5000) for (const [name, value] of this.limits) if (value.until <= now) this.limits.delete(name);
  }

  broadcast(userIds, payload) {
    const data = JSON.stringify(payload);
    for (const userId of new Set(userIds)) {
      for (const socket of this.ctx.getWebSockets(userId)) {
        try { socket.send(data); } catch { /* closed socket; cleaned up on close */ }
      }
    }
  }

  online(userIds) {
    return userIds.filter(id => this.ctx.getWebSockets(id).length > 0);
  }

  // A member counts as "watching" if any of their open app windows is visible; others get a web notification.
  watching(userId) {
    return this.ctx.getWebSockets(userId).some(socket => socket.deserializeAttachment()?.visible);
  }

  async notify(roomId, senderId, memberIds) {
    const now = Date.now();
    const targets = memberIds.filter(id => id !== senderId && !this.watching(id) && now - (this.lastPush.get(`${id}:${roomId}`) || 0) > 15000);
    const subscriptions = this.core.pushTargets(roomId, targets);
    if (!subscriptions.length) return;
    const vapid = await this.vapid();
    await Promise.all(subscriptions.map(async row => {
      this.lastPush.set(`${row.user_id}:${roomId}`, now);
      if ((await sendPush(row.endpoint, vapid, `mailto:${this.env.CONTACT_EMAIL || 'dragon600120@gmail.com'}`)) === 'gone') this.core.removePush(row.endpoint);
    }));
  }

  deliver(result, sender) {
    this.broadcast(result.memberIds, { type: 'message', roomId: result.message.roomId, message: result.message });
    this.ctx.waitUntil(this.notify(result.message.roomId, sender.id, result.memberIds).catch(error => console.error('Notify failed:', error)));
  }

  // 회원 정보는 회원 서버(CommunityService)에서 확인한다: 이메일 인증을 마친 회원의 번호·닉네임만 받는다.
  async findMembers({ q, ids }) {
    const query = ids ? `ids=${ids.map(encodeURIComponent).join(',')}` : `q=${encodeURIComponent(q || '')}`;
    const response = await this.env.COMMUNITY.get(this.env.COMMUNITY.idFromName('community-v1')).fetch(`https://internal.invalid/internal/member-search?${query}`);
    if (!response.ok) throw new ChatError(503, '회원 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    return (await response.json()).members || [];
  }

  announce(roomId, memberIds, message) {
    if (message) this.broadcast(memberIds, { type: 'message', roomId, message });
    this.broadcast(memberIds, { type: 'room', roomId });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === '/internal/channel-post' && request.method === 'POST') {
        const { text, day } = await request.json();
        if (day && this.core.meta(`channel-posted:${day}`)) return json({ ok: true, skipped: 'already posted' });
        const result = this.core.postToChannel(POLICY_CHANNEL, { nickname: '정책브리핑', text });
        if (day) this.core.meta(`channel-posted:${day}`, '1');
        if (result) this.deliver(result, { id: null });
        return json({ ok: true, subscribers: result?.memberIds.length || 0 });
      }
      if (path === '/internal/event-announcement' && request.method === 'POST') {
        const { sourceId, text } = await request.json();
        if (!/^\d{10,15}-[a-z0-9]{6,16}$/.test(String(sourceId || ''))) throw new ChatError(400, '광장 메시지 식별자가 올바르지 않습니다.');
        if (typeof text !== 'string' || !announcement.kindOf(text) || text.length > 2000) throw new ChatError(400, '모임안내·초청장·정보안내 형식의 메시지가 아닙니다.');
        const key = `event-announcement:${sourceId}`;
        if (this.core.meta(key)) return json({ ok: true, skipped: 'already posted' });
        const info = announcement.kindOf(text).id === 'info';
        const channelId = info ? INFO_CHANNEL : EVENT_CHANNEL;
        const channelName = info ? INFO_CHANNEL_NAME : EVENT_CHANNEL_NAME;
        // 정보안내 채널을 처음 쓸 때 모임안내 구독자를 함께 받아 보게 한다(한 번만).
        if (info && !this.core.meta('info-channel-seeded')) {
          this.core.copyChannelMembers(EVENT_CHANNEL, INFO_CHANNEL, INFO_CHANNEL_NAME);
          this.core.meta('info-channel-seeded', '1');
        }
        const result = this.core.postToChannel(channelId, { nickname: EVENT_SENDER, roomName: channelName, text });
        this.core.meta(key, '1');
        this.deliver(result, { id: null });
        return json({ ok: true, subscribers: result.memberIds.length, channel: channelName });
      }
      if (path === '/internal/user-deleted') {
        const { userId } = await request.json();
        for (const entry of this.core.deleteUser(userId)) this.announce(entry.roomId, entry.memberIds, entry.message);
        for (const socket of this.ctx.getWebSockets(userId)) socket.close(4001, 'Account deleted');
        return json({ ok: true });
      }
      // 초대 미리보기와 손님 입장은 로그인 없이도 된다.
      const invitePath = /^\/api\/chat\/invite\/([^/]+)$/.exec(path);
      if (invitePath && request.method === 'GET') return json(this.core.invitePreview(decodeURIComponent(invitePath[1])));
      let user = null;
      try { user = JSON.parse(decodeURIComponent(request.headers.get('X-Talk-User') || '')); } catch { user = null; }
      if (path === '/api/chat/guest' && request.method === 'POST') {
        if (user?.id && user.verified) throw new ChatError(400, '이미 로그인되어 있습니다. 초대 링크로 바로 들어가세요.');
        this.limit(`guest:${request.headers.get('X-Client-IP') || 'unknown'}`, 10, 60 * 60 * 1000);
        let input = {};
        try { input = await request.json(); } catch { throw new ChatError(400, '요청 내용을 확인해 주세요.'); }
        this.core.invitePreview(input.code);
        const token = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        const guest = this.core.createGuest(await sha256(token), input.nickname);
        this.core.ensureUser(guest);
        const result = this.core.join(guest, input.code);
        if (result.message) this.announce(result.room.id, result.room.members.map(member => member.id), result.message);
        if (result.message) this.later(() => this.slack.talkJoin(guest, result.room, { guest: true }));
        const secure = new URL(request.url).protocol === 'https:' || !/^(localhost|127\.)/.test(new URL(request.url).hostname);
        return json({ room: result.room }, 201, { 'Set-Cookie': `space_talk_guest=${token}; Path=/; Max-Age=${180 * 24 * 3600}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}` });
      }
      if (!user?.verified) {
        const token = request.headers.get('X-Talk-Guest') || '';
        const guest = /^[0-9a-f]{64}$/.test(token) ? this.core.guest(await sha256(token)) : null;
        if (guest) user = guest;
      }
      if (!user?.id) throw new ChatError(401, '로그인한 회원만 스페이스 톡을 이용할 수 있습니다.');
      if (!user.verified) throw new ChatError(403, '이메일 인증을 마친 회원만 스페이스 톡을 이용할 수 있습니다.');
      const me = this.core.ensureUser(user);

      if (path === '/ws') {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket 연결이 필요합니다.' }, 426);
        if (this.ctx.getWebSockets(user.id).length >= 6) throw new ChatError(429, '열려 있는 창이 너무 많습니다. 다른 창을 닫고 다시 시도해 주세요.');
        const pair = new WebSocketPair();
        this.ctx.acceptWebSocket(pair[1], [user.id]);
        pair[1].serializeAttachment({ id: user.id, nickname: user.nickname, admin: Boolean(user.admin), guest: Boolean(user.guest), visible: true, start: Date.now(), count: 0 });
        pair[1].send(JSON.stringify({ type: 'hello', user: me }));
        return new Response(null, { status: 101, webSocket: pair[0] });
      }

      const parts = path.replace(/^\/api\/chat\/?/, '').split('/').filter(Boolean);
      const method = request.method;
      const body = async () => {
        if (!(request.headers.get('content-type') || '').includes('application/json')) return {};
        try { return await request.json(); } catch { throw new ChatError(400, '요청 내용을 확인해 주세요.'); }
      };
      const [first, id, action, sub, subAction] = parts;

      const guestOnly = message => { if (user.guest) throw new ChatError(403, message); };
      if (first === 'me' && method === 'GET') {
        return json({ user: { ...me, guest: Boolean(user.guest) }, vapidPublicKey: (await this.vapid()).publicKey, retentionDays: RETENTION_DAYS, maxMembers: MAX_ROOM_MEMBERS });
      }
      if (first === 'unread' && method === 'GET') return json(this.core.unreadSummary(user));
      if (first === 'rooms' && !id) {
        if (method === 'GET') {
          const rooms = this.core.listRooms(user);
          return json({ rooms: rooms.map(room => ({ ...room, members: undefined, online: this.online(room.members.map(member => member.id)).length })) });
        }
        if (method === 'POST') {
          guestOnly('대화방 만들기는 회원만 할 수 있습니다. 회원가입 후 이용해 주세요.');
          this.limit(`create:${user.id}`, 10, 60 * 60 * 1000);
          const result = this.core.createGroup(user, await body());
          this.later(() => this.slack.talkRoom(user, result.room));
          // 같은 계정으로 켜 둔 다른 기기(PC·휴대폰)에도 새 대화방이 바로 보이게 한다.
          this.broadcast([user.id], { type: 'room', roomId: result.room.id });
          return json({ room: result.room }, 201);
        }
      }
      if (first === 'rooms' && id) {
        if (!action && method === 'GET') {
          const room = this.core.room(user, id);
          return json({ room: { ...room, online: this.online(room.members.map(member => member.id)) } });
        }
        if (action === 'messages' && !sub && method === 'GET') return json(this.core.messages(user, id, { before: url.searchParams.get('before') }));
        if (action === 'messages' && !sub && method === 'POST') {
          this.limit(`send:${user.id}`, 40, 60000);
          const result = this.core.send(user, id, await body());
          this.deliver(result, user);
          return json({ message: result.message }, 201);
        }
        if (action === 'messages' && sub && subAction === 'edit' && method === 'POST') {
          this.limit(`edit:${user.id}`, 30, 10 * 60 * 1000);
          const result = this.core.editMessage(user, id, sub, (await body()).text);
          this.broadcast(result.memberIds, { type: 'edited', roomId: id, message: result.message });
          // 모임안내·초청장을 고치면 공유 주소(/e/…) 화면과 광장채팅 원문도 같이 고친다.
          const link = result.roomKind === 'channel' ? /\/e\/(\d{10,15}-[a-z0-9]{6,16})\s*$/.exec(result.message.text) : null;
          if (link && this.env.CHAT) {
            const text = result.message.text.replace(/\n*자세히 보기·카카오톡 공유: \S+\s*$/, '').replace(/\n*안내장 사진: \S+\s*$/, '');
            try {
              await this.env.CHAT.get(this.env.CHAT.idFromName('public-chat-v1')).fetch('https://internal.invalid/internal/announcement-edit', {
                method: 'POST', body: JSON.stringify({ id: link[1], text }),
              });
            } catch (error) { console.error('Announcement source edit failed:', error); }
          }
          return json({ message: result.message });
        }
        if (action === 'messages' && sub && subAction === 'delete' && method === 'POST') {
          const result = this.core.deleteMessage(user, id, sub);
          this.broadcast(result.memberIds, { type: 'deleted', roomId: id, messageId: result.messageId });
          return json({ ok: true });
        }
        if (action === 'messages' && sub && subAction === 'report' && method === 'POST') {
          this.limit(`report:${user.id}`, 20, 60 * 60 * 1000);
          return json(this.core.report(user, id, sub, (await body()).reason));
        }
        if (action === 'images' && method === 'POST') {
          this.limit(`image:${user.id}`, 30, 10 * 60 * 1000);
          const type = (request.headers.get('content-type') || '').split(';')[0].trim();
          const bytes = await request.arrayBuffer();
          return json(this.core.saveImage(user, id, type, bytes), 201);
        }
        if (method === 'POST' && action === 'leave') {
          const result = this.core.leave(user, id);
          this.announce(id, result.memberIds, result.message);
          return json({ ok: true });
        }
        if (method === 'POST' && action === 'mute') return json(this.core.mute(user, id, (await body()).muted));
        if (method === 'POST' && action === 'notice') {
          const result = this.core.setNotice(user, id, (await body()).text);
          this.announce(id, result.memberIds, result.message);
          return json({ room: result.room });
        }
        if (method === 'POST' && action === 'update') {
          const result = this.core.update(user, id, await body());
          this.announce(id, result.memberIds, result.message);
          return json({ room: result.room });
        }
        // 회원 불러오기: 이름으로 회원 찾기(검색어가 없으면 함께 대화한 사람들) → 골라서 바로 방에 넣기
        if (action === 'candidates' && method === 'GET') {
          guestOnly('회원 불러오기는 회원만 할 수 있습니다.');
          this.limit(`search:${user.id}`, 60, 60000);
          const room = this.core.room(user, id);
          const inRoom = new Set(room.members.map(member => member.id));
          const q = (url.searchParams.get('q') || '').trim().slice(0, 254);
          const found = q ? await this.findMembers({ q }) : this.core.acquaintances(user);
          return json({ members: found.filter(person => person.id !== user.id).map(person => ({ ...person, inRoom: inRoom.has(person.id) })), query: q });
        }
        if (action === 'add' && method === 'POST') {
          guestOnly('회원 불러오기는 회원만 할 수 있습니다.');
          this.limit(`add:${user.id}`, 20, 60 * 60 * 1000);
          const input = await body();
          const ids = Array.isArray(input.userIds) ? input.userIds.map(String).slice(0, 50) : [];
          const people = ids.length ? await this.findMembers({ ids }) : [];
          const result = this.core.addMembers(user, id, people);
          this.announce(id, result.memberIds, result.message);
          return json({ room: result.room, added: result.addedIds.length });
        }
        if (method === 'POST' && action === 'kick') {
          const result = this.core.kick(user, id, (await body()).userId);
          this.announce(id, result.memberIds, result.message);
          this.broadcast([result.removedId], { type: 'removed', roomId: id });
          return json({ ok: true });
        }
      }
      if (first === 'channel' && method === 'GET') return json(this.core.channel(user, POLICY_CHANNEL, POLICY_CHANNEL_NAME));
      if (first === 'channel' && id === 'subscribe' && method === 'POST') {
        const room = this.core.subscribeChannel(user, POLICY_CHANNEL, POLICY_CHANNEL_NAME);
        return json({ room });
      }
      if (first === 'event-channel' && method === 'GET') return json(this.core.channel(user, EVENT_CHANNEL, EVENT_CHANNEL_NAME));
      if (first === 'info-channel' && method === 'GET') return json(this.core.channel(user, INFO_CHANNEL, INFO_CHANNEL_NAME));
      if (first === 'info-channel' && id === 'subscribe' && method === 'POST') {
        const room = this.core.subscribeChannel(user, INFO_CHANNEL, INFO_CHANNEL_NAME);
        return json({ room });
      }
      if (first === 'event-channel' && id === 'subscribe' && method === 'POST') {
        const room = this.core.subscribeChannel(user, EVENT_CHANNEL, EVENT_CHANNEL_NAME);
        return json({ room });
      }
      if (first === 'invite' && id && method === 'GET') return json(this.core.invitePreview(id));
      if (first === 'join' && method === 'POST') {
        this.limit(`join:${user.id}`, 30, 60 * 60 * 1000);
        const result = this.core.join(user, (await body()).code);
        if (result.message) this.announce(result.room.id, result.room.members.map(member => member.id), result.message);
        if (result.message) this.later(() => this.slack.talkJoin(user, result.room));
        return json({ room: result.room });
      }
      if (first === 'dm' && method === 'POST') {
        guestOnly('1:1 대화는 회원만 시작할 수 있습니다. 회원가입 후 이용해 주세요.');
        this.limit(`dm:${user.id}`, 30, 60 * 60 * 1000);
        const input = await body();
        let room;
        if (input.via === 'square' && input.userId) {
          // 광장 채팅에서 이름을 눌러 바로 1:1: 두 사람이 지금 광장에 함께 접속해 있는지 광장 서버에 확인한다.
          const targetId = String(input.userId);
          let present = [];
          try {
            const response = await this.env.CHAT.get(this.env.CHAT.idFromName('public-chat-v1')).fetch('https://internal.invalid/internal/present');
            present = (await response.json()).ids || [];
          } catch (error) { console.error('Square presence check failed:', error); }
          if (!present.includes(user.id) || !present.includes(targetId)) throw new ChatError(403, '광장 채팅에 지금 함께 접속한 회원과만 바로 1:1 톡을 시작할 수 있습니다.');
          const [person] = await this.findMembers({ ids: [targetId] });
          if (!person) throw new ChatError(404, '대화 상대를 찾을 수 없습니다.');
          room = this.core.startDm(user, { userId: targetId, person, trusted: true });
        } else {
          room = this.core.startDm(user, { code: input.code, userId: input.userId });
        }
        this.broadcast(room.members.map(member => member.id), { type: 'room', roomId: room.id });
        return json({ room });
      }
      if (first === 'images' && id && method === 'GET') {
        const image = this.core.image(user, id);
        return new Response(image.data, { headers: { 'Content-Type': image.type, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" } });
      }
      if (first === 'push' && method === 'POST') {
        const input = await body();
        if (id === 'remove') { this.core.removePush(input.endpoint); return json({ ok: true }); }
        return json(this.core.savePush(user, input.endpoint));
      }
      if (first === 'admin' && id === 'channel' && method === 'POST') {
        guestOnly('권한이 없습니다.');
        if (!user.admin) throw new ChatError(403, '운영자만 채널에 글을 올릴 수 있습니다.');
        const text = String((await body()).text || '').trim();
        if (!text) throw new ChatError(400, '보낼 내용을 입력해 주세요.');
        this.core.subscribeChannel(user, POLICY_CHANNEL, POLICY_CHANNEL_NAME);
        const result = this.core.postToChannel(POLICY_CHANNEL, { nickname: '정책브리핑', text });
        this.deliver(result, { id: null });
        return json({ ok: true, subscribers: result.memberIds.length });
      }
      if (first === 'admin' && id === 'reports') {
        guestOnly('권한이 없습니다.');
        if (method === 'GET') return json({ reports: this.core.reports(user) });
        if (method === 'POST') {
          const input = await body();
          const result = this.core.resolveReport(user, input.messageId, input.action);
          if (result.deleted) this.broadcast(result.memberIds, { type: 'deleted', roomId: result.roomId, messageId: result.messageId });
          return json({ ok: true });
        }
      }
      throw new ChatError(404, '요청한 기능이 없습니다.');
    } catch (error) {
      if (!(error instanceof ChatError)) console.error('Talk failed:', error);
      return json({ error: error instanceof ChatError ? error.message : '스페이스 톡 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' }, error instanceof ChatError ? error.status : 500);
    }
  }

  async webSocketMessage(socket, raw) {
    const reply = payload => socket.send(JSON.stringify(payload));
    const state = socket.deserializeAttachment();
    if (typeof raw !== 'string' || raw.length > 8192) { reply({ type: 'error', error: '메시지가 너무 큽니다.' }); return; }
    let input;
    try { input = JSON.parse(raw); } catch { reply({ type: 'error', error: '올바른 요청이 아닙니다.' }); return; }
    const user = { id: state.id, nickname: state.nickname, admin: state.admin };
    try {
      if (input.type === 'ping') { reply({ type: 'pong' }); return; }
      if (input.type === 'presence') {
        socket.serializeAttachment({ ...state, visible: Boolean(input.visible) });
        return;
      }
      if (input.type === 'typing') {
        const { room } = this.core.membership(input.roomId, user.id);
        const others = this.core.members(room.id).map(member => member.id).filter(id => id !== user.id);
        this.broadcast(others, { type: 'typing', roomId: room.id, userId: user.id, nickname: user.nickname });
        return;
      }
      if (input.type === 'read') {
        const result = this.core.read(user, input.roomId, input.seq);
        if (result.changed) this.broadcast(result.memberIds, { type: 'read', roomId: input.roomId, userId: user.id, seq: result.seq });
        return;
      }
      if (input.type === 'send') {
        const now = Date.now();
        const window = now - state.start >= 60000 ? { ...state, start: now, count: 1 } : { ...state, count: state.count + 1 };
        socket.serializeAttachment(window);
        if (window.count > 40) throw new ChatError(429, '메시지를 너무 빨리 보내고 있습니다. 잠시 후 다시 보내 주세요.');
        const result = this.core.send(user, input.roomId, { text: input.text, imageId: input.imageId });
        reply({ type: 'sent', clientId: input.clientId, message: result.message });
        this.deliver(result, user);
        return;
      }
      throw new ChatError(400, '알 수 없는 요청입니다.');
    } catch (error) {
      if (!(error instanceof ChatError)) console.error('Talk socket failed:', error);
      reply({ type: 'error', clientId: input.clientId, roomId: input.roomId, error: error instanceof ChatError ? error.message : '처리 중 오류가 발생했습니다.' });
    }
  }

  webSocketClose(socket, code, reason) { try { socket.close(code, reason); } catch { /* already closed */ } }
  webSocketError(socket, error) {
    console.error('Talk WebSocket failed:', error);
    try { socket.close(1011, 'Connection failed'); } catch { /* already closed */ }
  }
}
