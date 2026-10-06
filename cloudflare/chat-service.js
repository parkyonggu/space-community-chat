// 스페이스 톡 Durable Object: 대화방 저장(chat-core) + 실시간 전송(WebSocket, 절전 지원) + 웹 알림
import { DurableObject } from 'cloudflare:workers';
import chatCore from '../chat-core.js';
import { loadVapid, sendPush } from './web-push.js';

const { createChatCore, ChatError, RETENTION_DAYS, MAX_ROOM_MEMBERS } = chatCore;
const DAY = 24 * 60 * 60 * 1000;
const json = (body, status = 200, extra = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra } });

export class ChatService extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = createChatCore(ctx.storage.sql);
    this.limits = new Map();
    this.lastPush = new Map();
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

  announce(roomId, memberIds, message) {
    if (message) this.broadcast(memberIds, { type: 'message', roomId, message });
    this.broadcast(memberIds, { type: 'room', roomId });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === '/internal/user-deleted') {
        const { userId } = await request.json();
        for (const entry of this.core.deleteUser(userId)) this.announce(entry.roomId, entry.memberIds, entry.message);
        for (const socket of this.ctx.getWebSockets(userId)) socket.close(4001, 'Account deleted');
        return json({ ok: true });
      }
      let user = null;
      try { user = JSON.parse(decodeURIComponent(request.headers.get('X-Talk-User') || '')); } catch { user = null; }
      if (!user?.id) throw new ChatError(401, '로그인한 회원만 스페이스 톡을 이용할 수 있습니다.');
      if (!user.verified) throw new ChatError(403, '이메일 인증을 마친 회원만 스페이스 톡을 이용할 수 있습니다.');
      const me = this.core.ensureUser(user);

      if (path === '/ws') {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket 연결이 필요합니다.' }, 426);
        if (this.ctx.getWebSockets(user.id).length >= 6) throw new ChatError(429, '열려 있는 창이 너무 많습니다. 다른 창을 닫고 다시 시도해 주세요.');
        const pair = new WebSocketPair();
        this.ctx.acceptWebSocket(pair[1], [user.id]);
        pair[1].serializeAttachment({ id: user.id, nickname: user.nickname, admin: Boolean(user.admin), visible: true, start: Date.now(), count: 0 });
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

      if (first === 'me' && method === 'GET') {
        return json({ user: me, vapidPublicKey: (await this.vapid()).publicKey, retentionDays: RETENTION_DAYS, maxMembers: MAX_ROOM_MEMBERS });
      }
      if (first === 'unread' && method === 'GET') return json(this.core.unreadSummary(user));
      if (first === 'rooms' && !id) {
        if (method === 'GET') {
          const rooms = this.core.listRooms(user);
          return json({ rooms: rooms.map(room => ({ ...room, members: undefined, online: this.online(room.members.map(member => member.id)).length })) });
        }
        if (method === 'POST') {
          this.limit(`create:${user.id}`, 10, 60 * 60 * 1000);
          const result = this.core.createGroup(user, await body());
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
        if (method === 'POST' && action === 'update') {
          const result = this.core.update(user, id, await body());
          this.announce(id, result.memberIds, result.message);
          return json({ room: result.room });
        }
        if (method === 'POST' && action === 'kick') {
          const result = this.core.kick(user, id, (await body()).userId);
          this.announce(id, result.memberIds, result.message);
          this.broadcast([result.removedId], { type: 'removed', roomId: id });
          return json({ ok: true });
        }
      }
      if (first === 'invite' && id && method === 'GET') return json(this.core.invitePreview(id));
      if (first === 'join' && method === 'POST') {
        this.limit(`join:${user.id}`, 30, 60 * 60 * 1000);
        const result = this.core.join(user, (await body()).code);
        if (result.message) this.announce(result.room.id, result.room.members.map(member => member.id), result.message);
        return json({ room: result.room });
      }
      if (first === 'dm' && method === 'POST') {
        this.limit(`dm:${user.id}`, 30, 60 * 60 * 1000);
        const input = await body();
        const room = this.core.startDm(user, { code: input.code, userId: input.userId });
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
      if (first === 'admin' && id === 'reports') {
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
