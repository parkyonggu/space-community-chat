import { DurableObject } from 'cloudflare:workers';
import { createHash } from 'node:crypto';
import auth from '../auth-api.js';
import community from '../community-api.js';
import board from '../board-api.js';

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
      async send({ to, subject, text }) {
        await env.EMAIL.send({ to, from: { email: env.MAIL_FROM, name: '스페이스 커뮤니티' }, subject, text });
      },
    } : undefined;
    const adminEmails = (env.ADMIN_EMAILS || '').split(',');
    this.auth = auth.createAuthApi('/private', {
      siteUrl: env.SITE_URL,
      mailer,
      adminEmails,
      onAccountDeleted: userId => Promise.all([this.board.anonymizeUser(userId), this.community.anonymizeUser(userId)]),
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
    if (pathname === '/internal/chat-identity') {
      const { user } = await this.auth.authenticate(source);
      const canSend = Boolean(user && (!this.requireVerifiedEmail || user.emailVerified));
      return json({ name: canSend ? user.nickname : null, signedIn: Boolean(user) });
    }
    const handler = pathname.startsWith('/api/auth/') ? this.auth :
      pathname === '/api/board' || pathname.startsWith('/api/board/') ? this.board : this.community;
    await handler(source, target, pathname);
    return completed;
  }
}

export class ChatRoom extends DurableObject {
  async fetch(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket 연결이 필요합니다.' }, 426);
    if (request.headers.get('Origin') !== this.env.SITE_URL) return json({ error: '이 사이트에서만 채팅할 수 있습니다.' }, 403);
    if (this.ctx.getWebSockets().length >= 100) return json({ error: '채팅 접속자가 많습니다. 잠시 후 다시 시도해 주세요.' }, 503);
    let name = null;
    try { name = request.headers.get('X-Chat-Name') ? decodeURIComponent(request.headers.get('X-Chat-Name')) : null; } catch { name = null; }
    const signedIn = request.headers.get('X-Chat-Signed-In') === '1';
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ start: Date.now(), count: 0, name });
    pair[1].send(JSON.stringify({ type: 'hello', canSend: Boolean(name), signedIn }));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(socket, message) {
    const error = text => socket.send(JSON.stringify({ error: text }));
    if (typeof message !== 'string' || message.length > 8192) {
      error('채팅 내용이 너무 큽니다.');
      return;
    }
    let input;
    try { input = JSON.parse(message); } catch { error('올바른 채팅 요청이 아닙니다.'); return; }
    const text = typeof input?.text === 'string' ? input.text.trim() : '';
    if (!text || text.length > 2000) { error('채팅은 1~2,000자로 입력해 주세요.'); return; }
    const now = Date.now();
    let window = socket.deserializeAttachment();
    if (!window.name) { error('로그인한 회원만 채팅을 보낼 수 있습니다.'); return; }
    if (now - window.start >= 60000) window = { start: now, count: 0, name: window.name };
    window.count += 1;
    socket.serializeAttachment(window);
    if (window.count > 30) { error('채팅 전송이 많습니다. 잠시 후 다시 시도해 주세요.'); return; }
    const output = JSON.stringify({ name: window.name, text });
    for (const peer of this.ctx.getWebSockets()) {
      try { peer.send(output); } catch (failure) {
        console.error('Chat broadcast failed:', failure);
        peer.close(1011, 'Message delivery failed');
      }
    }
  }

  webSocketClose(socket, code, reason) { socket.close(code, reason); }
  webSocketError(socket, error) {
    console.error('Chat WebSocket failed:', error);
    socket.close(1011, 'Connection failed');
  }
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/auth/') || url.pathname === '/api/board' || url.pathname.startsWith('/api/board/') ||
          ['/api/comments', '/api/newsletter', '/api/newsletter/unsubscribe'].includes(url.pathname)) {
        return await env.COMMUNITY.get(env.COMMUNITY.idFromName('community-v1')).fetch(request);
      }
      if (url.pathname.startsWith('/api/')) return json({ error: '요청한 기능이 없습니다.' }, 404);
      if (url.pathname === '/ws/chat') {
        const identityRequest = new Request(new URL('/internal/chat-identity', url), {
          headers: { cookie: request.headers.get('cookie') || '', host: url.host, 'CF-Connecting-IP': request.headers.get('CF-Connecting-IP') || '' },
        });
        const identity = await (await env.COMMUNITY.get(env.COMMUNITY.idFromName('community-v1')).fetch(identityRequest)).json();
        const forwarded = new Request(request);
        forwarded.headers.delete('X-Chat-Name');
        forwarded.headers.set('X-Chat-Signed-In', identity.signedIn ? '1' : '0');
        if (identity.name) forwarded.headers.set('X-Chat-Name', encodeURIComponent(identity.name));
        return await env.CHAT.get(env.CHAT.idFromName('public-chat-v1')).fetch(forwarded);
      }
      return await env.ASSETS.fetch(request);
    } catch (error) {
      console.error('Community Worker failed:', error);
      return json({ error: '서버에서 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 503);
    }
  },
};
