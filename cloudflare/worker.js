import { DurableObject } from 'cloudflare:workers';
import { createHash } from 'node:crypto';
import auth from '../auth-api.js';
import community from '../community-api.js';
import board from '../board-api.js';
import newsletter from '../newsletter-api.js';
import portal from '../portal-api.js';
export { ChatService } from './chat-service.js';

const json = (body, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

class SqlStore {
  constructor(state, name, collections) {
    this.state = state;
    this.name = name;
    this.collections = collections;
    state.storage.sql.exec('CREATE TABLE IF NOT EXISTS entries (store TEXT, collection TEXT, id TEXT, value TEXT, PRIMARY KEY (store, collection, id))');
  }

  async read() {
    const result = Object.fromEntries(this.collections.map(name => [name, []]));
    for (const row of this.state.storage.sql.exec('SELECT collection, value FROM entries WHERE store = ?', this.name)) {
      result[row.collection].push(JSON.parse(row.value));
    }
    if (result.comments) result.comments.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return result;
  }

  async write(value) {
    this.state.storage.transactionSync(() => {
      const old = new Map([...this.state.storage.sql.exec('SELECT collection, id, value FROM entries WHERE store = ?', this.name)]
        .map(row => [`${row.collection}:${row.id}`, row]));
      for (const collection of this.collections) {
        for (const entry of value[collection]) {
          const id = entry.id || entry.tokenHash || entry.email;
          if (!id) throw new Error('Storage entry has no identifier');
          const key = `${collection}:${id}`;
          const serialized = JSON.stringify(entry);
          if (old.get(key)?.value !== serialized) {
            this.state.storage.sql.exec('INSERT OR REPLACE INTO entries (store, collection, id, value) VALUES (?, ?, ?, ?)',
              this.name, collection, id, serialized);
          }
          old.delete(key);
        }
      }
      for (const row of old.values()) {
        this.state.storage.sql.exec('DELETE FROM entries WHERE store = ? AND collection = ? AND id = ?', this.name, row.collection, row.id);
      }
    });
  }
}

export class CommunityService extends DurableObject {
  constructor(state, env) {
    super(state, env);
    this.state = state;
    const sql = state.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS request_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)');
    sql.exec('CREATE INDEX IF NOT EXISTS request_limits_expiry ON request_limits (expires)');
    const rateLimit = (key, max, duration, now) => {
      const digest = createHash('sha256').update(key).digest('hex');
      return state.storage.transactionSync(() => {
        sql.exec('DELETE FROM request_limits WHERE expires <= ?', now);
        const row = [...sql.exec('SELECT count FROM request_limits WHERE key = ?', digest)][0];
        if (!row && [...sql.exec('SELECT COUNT(*) AS count FROM request_limits')][0].count >= 10000) return false;
        if (!row) sql.exec('INSERT INTO request_limits VALUES (?, 1, ?)', digest, now + duration);
        else sql.exec('UPDATE request_limits SET count = count + 1 WHERE key = ?', digest);
        return (row?.count || 0) + 1 <= max;
      });
    };
    const mailer = env.EMAIL && env.MAIL_FROM ? {
      configured: true,
      async verify() {},
      async send({ to, subject, text, html }) {
        await env.EMAIL.send({ to, from: { email: env.MAIL_FROM, name: '스페이스 커뮤니티' }, subject, text, ...(html ? { html } : {}) });
      },
    } : undefined;
    const adminEmails = (env.ADMIN_EMAILS || '').split(',');
    this.auth = auth.createAuthApi('/private', {
      siteUrl: env.SITE_URL,
      mailer,
      adminEmails,
      onAccountDeleted: userId => Promise.all([this.board.anonymizeUser(userId), this.community.anonymizeUser(userId),
        env.TALK ? env.TALK.get(env.TALK.idFromName('talk-v1')).fetch('https://internal.invalid/internal/user-deleted', { method: 'POST', body: JSON.stringify({ userId }) }) : null,
        env.CHAT ? env.CHAT.get(env.CHAT.idFromName('public-chat-v1')).fetch('https://internal.invalid/internal/user-deleted', { method: 'POST', body: JSON.stringify({ userId }) }) : null]),
      storage: new SqlStore(state, 'auth', ['users', 'sessions', 'mailTokens']),
      rateLimit,
      maxDerivations: 1,
    });
    const requireVerifiedEmail = Boolean(mailer);
    this.community = community.createCommunityApi('/private', {
      storage: new SqlStore(state, 'community', ['comments', 'subscribers']), rateLimit,
      authenticate: this.auth.authenticate, requireVerifiedEmail,
    });
    this.board = board.createBoardApi('/private', {
      storage: new SqlStore(state, 'board', ['posts', 'likes', 'reports']), rateLimit,
      authenticate: this.auth.authenticate, requireVerifiedEmail,
    });
    this.requireVerifiedEmail = requireVerifiedEmail;
    this.newsletter = newsletter.createNewsletterApi('/private', {
      storage: new SqlStore(state, 'newsletter', ['subscribers', 'campaigns', 'meta', 'drafts']), rateLimit,
      authenticate: this.auth.authenticate, mailer, siteUrl: env.SITE_URL,
      dailyLimit: Number(env.NEWSLETTER_DAILY_LIMIT) || 300,
      legacySubscribers: () => this.community.legacySubscribers(),
      clearLegacySubscribers: () => this.community.clearLegacySubscribers(),
      schedule: async delay => {
        const current = await state.storage.getAlarm();
        const at = Date.now() + delay;
        if (!current || current > at) await state.storage.setAlarm(at);
      },
      senderName: env.NEWSLETTER_SENDER || '(주)위드플러시아', contactEmail: env.CONTACT_EMAIL || '',
      adminEmails, ecosKey: env.ECOS_API_KEY || '', rebKey: env.REB_API_KEY || '', highlights: since => this.board.highlights(since),
    });
    this.portal = portal.createPortalApi({
      ecosKey: env.ECOS_API_KEY || '', rebKey: env.REB_API_KEY || '', molitKey: env.MOLIT_API_KEY || '', rateLimit,
      molitKeys: { apt: env.MOLIT_APT_KEY || '', nrg: env.MOLIT_BLDG_KEY || '', land: env.MOLIT_LAND_KEY || '' },
      cache: { get: key => state.storage.get(key), set: (key, value) => state.storage.put(key, value) },
      onlineCount: async () => {
        const response = await env.CHAT.get(env.CHAT.idFromName('public-chat-v1')).fetch('https://internal.invalid/status');
        return (await response.json()).online;
      },
    });
  }

  async alarm() {
    const result = await this.newsletter.processQueue();
    if (result.more) await this.state.storage.setAlarm(Date.now() + (result.delay || 60000));
  }

  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const headers = Object.fromEntries(request.headers);
    if (Number(request.headers.get('content-length') || 0) > 128 * 1024) return json({ error: '입력 내용이 너무 큽니다.' }, 413);
    const body = request.body ? Buffer.from(await request.arrayBuffer()) : null;
    if (body && body.length > 128 * 1024) return json({ error: '입력 내용이 너무 큽니다.' }, 413);
    const source = {
      method: request.method, headers, url: url.pathname + url.search,
      socket: { remoteAddress: request.headers.get('CF-Connecting-IP') || 'unknown' },
      async *[Symbol.asyncIterator]() {
        if (body) yield body;
      },
    };
    let status = 200;
    const responseHeaders = new Headers();
    let resolve;
    const completed = new Promise(done => { resolve = done; });
    const target = {
      destroyed: false,
      setHeader(name, value) { responseHeaders.set(name, String(value)); },
      writeHead(code, values) {
        status = code;
        for (const [name, value] of Object.entries(values)) responseHeaders.set(name, String(value));
      },
      end(body) { resolve(new Response(body, { status, headers: responseHeaders })); },
    };
    if (pathname === '/internal/newsletter-weekly') {
      const draft = await this.newsletter.generateWeekly({ source: 'auto' });
      return json({ id: draft.id });
    }
    if (pathname === '/internal/chat-identity') {
      const { user } = await this.auth.authenticate(source);
      const canSend = Boolean(user && (!this.requireVerifiedEmail || user.emailVerified));
      const csrfOk = headers['x-csrf-token'] ? !(await this.auth.authenticate(source, { csrf: true })).error : false;
      return json({ name: canSend ? user.nickname : null, signedIn: Boolean(user), csrfOk,
        user: user ? { id: user.id, nickname: user.nickname, verified: canSend, admin: Boolean(user.admin) } : null });
    }
    const handler = pathname.startsWith('/api/auth/') ? this.auth :
      pathname === '/api/board' || pathname.startsWith('/api/board/') ? this.board :
      pathname.startsWith('/api/newsletter') || pathname.startsWith('/api/admin/newsletter') || pathname.startsWith('/n/') ? this.newsletter :
      pathname === '/api/portal' ? this.portal : this.community;
    await handler(source, target, pathname);
    return completed;
  }
}

// 광장 채팅: 접속자에게 바로 전달하고, 최근 글은 SQLite 저장소에 45일간 보관해 나중에 들어온 사람도 볼 수 있다.
const SQUARE_RETENTION_MS = 45 * 24 * 60 * 60 * 1000;
const SQUARE_HISTORY = 200;
const squareKey = (at, rand) => `m:${String(at).padStart(15, '0')}:${rand}`;
const squareKeyOf = id => {
  const match = /^(\d{10,15})-([a-z0-9]{6,16})$/.exec(String(id || ''));
  return match ? squareKey(Number(match[1]), match[2]) : null;
};

export class ChatRoom extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/status') return json({ online: this.ctx.getWebSockets().length });
    if (url.pathname === '/internal/user-deleted' && request.method === 'POST') {
      const { userId } = await request.json().catch(() => ({}));
      if (userId) await this.removeUser(String(userId));
      return json({ ok: true });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket 연결이 필요합니다.' }, 426);
    if (request.headers.get('Origin') !== this.env.SITE_URL) return json({ error: '이 사이트에서만 채팅할 수 있습니다.' }, 403);
    if (this.ctx.getWebSockets().length >= 100) return json({ error: '채팅 접속자가 많습니다. 잠시 후 다시 시도해 주세요.' }, 503);
    let name = null;
    try { name = request.headers.get('X-Chat-Name') ? decodeURIComponent(request.headers.get('X-Chat-Name')) : null; } catch { name = null; }
    const signedIn = request.headers.get('X-Chat-Signed-In') === '1';
    const uid = request.headers.get('X-Chat-User-Id') || '';
    const admin = request.headers.get('X-Chat-Admin') === '1';
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ start: Date.now(), count: 0, name, uid, admin });
    pair[1].send(JSON.stringify({ type: 'hello', canSend: Boolean(name), signedIn, you: name || '', admin }));
    const history = await this.history(uid);
    pair[1].send(JSON.stringify({ type: 'history', messages: history, retentionDays: SQUARE_RETENTION_MS / 86400000 }));
    this.announcePresence();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // 지금 접속한 사람: 회원은 닉네임(중복 접속은 한 번만), 로그인하지 않았거나 인증 전인 방문자는 숫자만.
  presence(leaving) {
    const members = new Set();
    let guests = 0;
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === leaving) continue;
      const info = peer.deserializeAttachment() || {};
      if (info.name) members.add(info.name); else guests += 1;
    }
    return { type: 'presence', members: [...members].sort((a, b) => a.localeCompare(b, 'ko')), guests };
  }

  announcePresence(leaving) {
    const update = this.presence(leaving);
    this.broadcast(() => update, leaving);
  }

  async history(uid) {
    const since = squareKey(Date.now() - SQUARE_RETENTION_MS, '');
    const entries = await this.ctx.storage.list({ prefix: 'm:', start: since, reverse: true, limit: SQUARE_HISTORY });
    return [...entries.values()].reverse().map(message => this.publicMessage(message, uid));
  }

  publicMessage(message, uid) {
    return { type: 'message', id: message.id, name: message.name, text: message.text, at: message.at, own: Boolean(uid) && message.uid === uid };
  }

  broadcast(build, skip) {
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === skip) continue;
      try { peer.send(JSON.stringify(build(peer.deserializeAttachment() || {}))); } catch (failure) {
        console.error('Chat broadcast failed:', failure);
        peer.close(1011, 'Message delivery failed');
      }
    }
  }

  async webSocketMessage(socket, message) {
    const error = text => socket.send(JSON.stringify({ error: text }));
    if (typeof message !== 'string' || message.length > 8192) {
      error('채팅 내용이 너무 큽니다.');
      return;
    }
    let input;
    try { input = JSON.parse(message); } catch { error('올바른 채팅 요청이 아닙니다.'); return; }
    let window = socket.deserializeAttachment();
    if (!window.name) { error('로그인한 회원만 채팅을 보낼 수 있습니다.'); return; }
    if (input?.type === 'delete') {
      const key = squareKeyOf(input.id);
      const stored = key ? await this.ctx.storage.get(key) : null;
      if (!stored) { error('이미 삭제되었거나 없는 메시지입니다.'); return; }
      if (!(window.admin || (window.uid && stored.uid === window.uid))) { error('내가 보낸 메시지만 삭제할 수 있습니다.'); return; }
      await this.ctx.storage.delete(key);
      this.broadcast(() => ({ type: 'deleted', id: stored.id }));
      return;
    }
    const text = typeof input?.text === 'string' ? input.text.trim() : '';
    if (!text || text.length > 2000) { error('채팅은 1~2,000자로 입력해 주세요.'); return; }
    const now = Date.now();
    if (now - window.start >= 60000) window = { ...window, start: now, count: 0 };
    window.count += 1;
    socket.serializeAttachment(window);
    if (window.count > 30) { error('채팅 전송이 많습니다. 잠시 후 다시 시도해 주세요.'); return; }
    const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    const stored = { id: `${now}-${rand}`, uid: window.uid || '', name: window.name, text, at: now };
    await this.ctx.storage.put(squareKey(now, rand), stored);
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(now + 24 * 60 * 60 * 1000);
    this.broadcast(peer => this.publicMessage(stored, peer.uid));
  }

  // 하루에 한 번 보관 기간이 지난 글을 지운다.
  async alarm() {
    const end = squareKey(Date.now() - SQUARE_RETENTION_MS, '');
    for (;;) {
      const old = await this.ctx.storage.list({ prefix: 'm:', end, limit: 500 });
      if (!old.size) break;
      const keys = [...old.keys()];
      for (let index = 0; index < keys.length; index += 128) await this.ctx.storage.delete(keys.slice(index, index + 128));
    }
    const rest = await this.ctx.storage.list({ prefix: 'm:', limit: 1 });
    if (rest.size) await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
  }

  async removeUser(userId) {
    const all = await this.ctx.storage.list({ prefix: 'm:' });
    const keys = [...all].filter(([, value]) => value.uid === userId).map(([key]) => key);
    for (let index = 0; index < keys.length; index += 128) await this.ctx.storage.delete(keys.slice(index, index + 128));
    for (const key of keys) this.broadcast(() => ({ type: 'deleted', id: all.get(key).id }));
  }

  webSocketClose(socket, code, reason) {
    try { socket.close(code === 1005 || code === 1006 ? 1000 : code, reason); } catch { /* already closed */ }
    this.announcePresence(socket);
  }
  webSocketError(socket, error) {
    console.error('Chat WebSocket failed:', error);
    try { socket.close(1011, 'Connection failed'); } catch { /* already closed */ }
    this.announcePresence(socket);
  }
}

export default {
  async scheduled(event, env, ctx) {
    const stub = env.COMMUNITY.get(env.COMMUNITY.idFromName('community-v1'));
    ctx.waitUntil(stub.fetch('https://internal.invalid/internal/newsletter-weekly', { method: 'POST' })
      .catch(error => console.error('Weekly newsletter draft failed:', error)));
  },
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/auth/') || url.pathname === '/api/board' || url.pathname.startsWith('/api/board/') ||
          url.pathname.startsWith('/api/newsletter') || url.pathname.startsWith('/api/admin/newsletter') || url.pathname.startsWith('/n/') ||
          url.pathname === '/api/comments' || url.pathname === '/api/portal') {
        return await env.COMMUNITY.get(env.COMMUNITY.idFromName('community-v1')).fetch(request);
      }
      if (url.pathname === '/ws/talk' || url.pathname === '/api/chat' || url.pathname.startsWith('/api/chat/')) {
        const isSocket = url.pathname === '/ws/talk';
        const writes = !isSocket && request.method !== 'GET' && request.method !== 'HEAD';
        if ((isSocket || writes) && request.headers.get('Origin') !== env.SITE_URL) return json({ error: '이 사이트에서만 이용할 수 있습니다.' }, 403);
        const identityRequest = new Request(new URL('/internal/chat-identity', url), {
          headers: { cookie: request.headers.get('cookie') || '', host: url.host, origin: request.headers.get('Origin') || '',
            'x-csrf-token': writes ? request.headers.get('X-CSRF-Token') || '' : '', 'CF-Connecting-IP': request.headers.get('CF-Connecting-IP') || '' },
        });
        const identity = await (await env.COMMUNITY.get(env.COMMUNITY.idFromName('community-v1')).fetch(identityRequest)).json();
        if (writes && identity.user && !identity.csrfOk) return json({ error: '세션이 만료되었거나 요청을 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요.' }, 403);
        const target = new URL(isSocket ? '/ws' : url.pathname + url.search, url);
        const forwarded = new Request(target, request);
        forwarded.headers.delete('X-Talk-User');
        forwarded.headers.delete('X-Talk-Guest');
        forwarded.headers.set('X-Client-IP', request.headers.get('CF-Connecting-IP') || '');
        if (identity.user) forwarded.headers.set('X-Talk-User', encodeURIComponent(JSON.stringify(identity.user)));
        // 초대 링크로 들어온 손님 쿠키도 전달한다(인증한 회원이면 회원 정보가 우선).
        const guest = /(?:^|;\s*)space_talk_guest=([0-9a-f]{64})/.exec(request.headers.get('cookie') || '');
        if (guest) forwarded.headers.set('X-Talk-Guest', guest[1]);
        return await env.TALK.get(env.TALK.idFromName('talk-v1')).fetch(forwarded);
      }
      if (url.pathname.startsWith('/api/')) return json({ error: '요청한 기능이 없습니다.' }, 404);
      if (url.pathname === '/ws/chat') {
        const identityRequest = new Request(new URL('/internal/chat-identity', url), {
          headers: { cookie: request.headers.get('cookie') || '', host: url.host, 'CF-Connecting-IP': request.headers.get('CF-Connecting-IP') || '' },
        });
        const identity = await (await env.COMMUNITY.get(env.COMMUNITY.idFromName('community-v1')).fetch(identityRequest)).json();
        const forwarded = new Request(request);
        forwarded.headers.delete('X-Chat-Name');
        forwarded.headers.delete('X-Chat-User-Id');
        forwarded.headers.delete('X-Chat-Admin');
        forwarded.headers.set('X-Chat-Signed-In', identity.signedIn ? '1' : '0');
        if (identity.name) forwarded.headers.set('X-Chat-Name', encodeURIComponent(identity.name));
        if (identity.user?.id) forwarded.headers.set('X-Chat-User-Id', String(identity.user.id));
        forwarded.headers.set('X-Chat-Admin', identity.user?.admin ? '1' : '0');
        return await env.CHAT.get(env.CHAT.idFromName('public-chat-v1')).fetch(forwarded);
      }
      return await env.ASSETS.fetch(request);
    } catch (error) {
      console.error('Community Worker failed:', error);
      return json({ error: '서버에서 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 503);
    }
  },
};
