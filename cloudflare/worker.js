import { DurableObject } from 'cloudflare:workers';
import { createHash, timingSafeEqual } from 'node:crypto';
import auth from '../auth-api.js';
import community from '../community-api.js';
import board from '../board-api.js';
import announcement from '../announcement.js';
import newsletter from '../newsletter-api.js';
import portal from '../portal-api.js';
import policyNews from '../policy-news.js';
import postPage from '../post-page.js';
import androidApp from '../android-app.js';
import slackNotify from '../slack-notify.js';
import audit from '../audit-api.js';
import guard from '../content-guard.js';
import briefingMcp from '../briefing-mcp.js';
import briefingPages from '../briefing-pages.js';
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
    // 운영자 슬랙 알림(SLACK_WEBHOOK_URL이 있을 때만). 응답을 늦추지 않도록 뒤에서 보낸다.
    this.slack = slackNotify.createSlackNotifier({ webhookUrl: env.SLACK_WEBHOOK_URL || '', siteUrl: env.SITE_URL || 'https://withpluces.com' });
    this.later = task => {
      if (!this.slack.ready) return;
      const job = Promise.resolve().then(task).catch(error => console.error('Slack notify failed:', error.message));
      if (typeof state.waitUntil === 'function') state.waitUntil(job);
    };
    // 자동 차단한 글(게시판·댓글·닉네임)을 운영자 슬랙으로 알린다.
    const onBlocked = entry => this.later(() => this.slack.blocked(entry));
    this.rateLimit = rateLimit;
    // 양산 주민감사청구 제보: 제보 원문은 운영자만 본다. 공개 현황에는 운영자가 다듬은 제목·요약만 나간다.
    sql.exec('CREATE TABLE IF NOT EXISTS audit_tips (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)');
    this.sql = sql;
    this.auth = auth.createAuthApi('/private', {
      siteUrl: env.SITE_URL,
      mailer,
      adminEmails,
      onAccountDeleted: userId => Promise.all([this.board.anonymizeUser(userId), this.community.anonymizeUser(userId),
        env.TALK ? env.TALK.get(env.TALK.idFromName('talk-v1')).fetch('https://internal.invalid/internal/user-deleted', { method: 'POST', body: JSON.stringify({ userId }) }) : null,
        env.CHAT ? env.CHAT.get(env.CHAT.idFromName('public-chat-v1')).fetch('https://internal.invalid/internal/user-deleted', { method: 'POST', body: JSON.stringify({ userId }) }) : null]),
      onNicknameChanged: (userId, nickname) => Promise.all([this.board.renameUser(userId, nickname), this.community.renameUser(userId, nickname)]),
      storage: new SqlStore(state, 'auth', ['users', 'sessions', 'mailTokens']),
      rateLimit,
      maxDerivations: 1,
      onBlocked, onRegistered: user => this.later(() => this.slack.signup(user)),
    });
    const requireVerifiedEmail = Boolean(mailer);
    this.community = community.createCommunityApi('/private', {
      storage: new SqlStore(state, 'community', ['comments', 'subscribers']), rateLimit,
      authenticate: this.auth.authenticate, requireVerifiedEmail,
      onComment: comment => this.later(() => this.slack.comment(comment)), onBlocked,
    });
    // 게시글 사진: 글 데이터와 따로 SQLite에 보관한다(사진 한 장당 1.5MB 이하).
    sql.exec('CREATE TABLE IF NOT EXISTS board_images (id TEXT PRIMARY KEY, type TEXT NOT NULL, data BLOB NOT NULL, user_id TEXT, post_id TEXT, created_at INTEGER NOT NULL)');
    const boardImages = {
      async put(image) { sql.exec('INSERT INTO board_images VALUES (?, ?, ?, ?, ?, ?)', image.id, image.type, image.data, image.userId, image.postId, image.createdAt); },
      async get(id) {
        const row = [...sql.exec('SELECT * FROM board_images WHERE id = ?', id)][0];
        return row ? { id: row.id, type: row.type, data: Buffer.from(row.data), userId: row.user_id, postId: row.post_id, createdAt: row.created_at } : null;
      },
      async attach(ids, postId) { for (const id of ids) sql.exec('UPDATE board_images SET post_id = ? WHERE id = ?', postId, id); },
      async remove(ids) { for (const id of ids) sql.exec('DELETE FROM board_images WHERE id = ?', id); },
      async purgeUnattached(before) { sql.exec('DELETE FROM board_images WHERE post_id IS NULL AND created_at < ?', before); },
    };
    this.board = board.createBoardApi('/private', {
      storage: new SqlStore(state, 'board', ['posts', 'likes', 'reports']), rateLimit,
      authenticate: this.auth.authenticate, requireVerifiedEmail, images: boardImages, siteUrl: env.SITE_URL || 'https://withpluces.com',
      onPost: post => this.later(() => this.slack.post(post)), onBlocked,
      onSlack: this.slack.ready ? post => this.slack.postFull(post) : undefined,
      notify: async (userId, { subject, text }) => {
        const to = mailer ? await this.auth.emailOf(userId) : null;
        if (to) await mailer.send({ to, subject, text });
      },
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
      adminEmails, ecosKey: env.ECOS_API_KEY || '', rebKey: env.REB_API_KEY || '', policyKey: env.POLICY_NEWS_KEY || '', highlights: since => this.board.highlights(since),
    });
    // Claude 예약 작업의 시장동향 브리핑 → 스페이스 레터. 받는 사람은 SPACELETTER_AUTO_AUDIENCE(operator|subscribers)로만 정한다.
    const autoAudience = env.SPACELETTER_AUTO_AUDIENCE === 'subscribers' ? 'subscribers' : 'operator';
    // 브리핑 전문 페이지(withpluces.com/briefing/weekly/…, /briefing/monthly/…)
    this.briefings = briefingPages.createBriefingStore(sql);
    this.briefing = briefingMcp.createBriefingMcp({
      status: () => this.newsletter.autoStatus(autoAudience),
      send: input => this.newsletter.autoBriefing({ ...input, audience: autoAudience }),
      publish: async input => {
        const saved = this.briefings.upsert(input);
        return { updated: saved.updated, url: `${env.SITE_URL || 'https://withpluces.com'}${saved.path}` };
      },
    });
    this.portal = portal.createPortalApi({
      ecosKey: env.ECOS_API_KEY || '', rebKey: env.REB_API_KEY || '', molitKey: env.MOLIT_API_KEY || '', policyKey: env.POLICY_NEWS_KEY || '', rateLimit,
      // 공공데이터포털 일반 인증키는 계정마다 하나라서, 따로 넣지 않았으면 정책브리핑 키를 함께 쓴다.
      benefitKey: env.GOV_BENEFIT_KEY || env.POLICY_NEWS_KEY || '', benefitUrl: env.GOV_BENEFIT_URL || '', authenticate: this.auth.authenticate,
      weatherKey: env.WEATHER_API_KEY || env.POLICY_NEWS_KEY || '',
      pensionKey: env.PENSION_API_KEY || env.POLICY_NEWS_KEY || '', pensionUploadToken: env.PENSION_UPLOAD_TOKEN || '', pensionKeys: { recipt: env.PENSION_RECIPT_KEY || '', sbscrb: env.PENSION_SBSCRB_KEY || '' }, pensionUrls: { recipt: env.PENSION_RECIPT_URL || '', sbscrb: env.PENSION_SBSCRB_URL || '' },
      financeKey: env.FINLIFE_API_KEY || '', pensionSavingsKey: env.FSS_PENSION_KEY || '', farmKeys: { kamisKey: env.KAMIS_CERT_KEY || '', kamisId: env.KAMIS_CERT_ID || '', nongsaroKey: env.NONGSARO_API_KEY || '' },
      lawOc: env.LAW_OC || '',
      molitKeys: { apt: env.MOLIT_APT_KEY || '', nrg: env.MOLIT_BLDG_KEY || '', land: env.MOLIT_LAND_KEY || '' },
      cache: { get: key => state.storage.get(key), set: (key, value) => state.storage.put(key, value) },
      onlineCount: async () => {
        const response = await env.CHAT.get(env.CHAT.idFromName('public-chat-v1')).fetch('https://internal.invalid/status');
        return (await response.json()).online;
      },
    });
  }

  // ---------- 양산 주민감사청구 (지방자치법 제21조) ----------
  auditTips(where = '', ...args) {
    return [...this.sql.exec(`SELECT * FROM audit_tips ${where} ORDER BY created_at DESC LIMIT 300`, ...args)]
      .map(row => ({ ...JSON.parse(row.data), id: row.id, userId: row.user_id, createdAt: row.created_at, updatedAt: row.updated_at }));
  }
  async auditApi(request, source, body, pathname) {
    try {
      const method = request.method;
      // 누구나: 운영자가 공개한 진행 현황
      if (pathname === '/api/audit/cases' && method === 'GET') {
        return json({ cases: this.auditTips().filter(tip => tip.published).map(audit.publicCase), statuses: audit.STATUSES });
      }
      const write = method !== 'GET';
      const { user, error } = await this.auth.authenticate(source, { csrf: write });
      if (error) return json({ error: error.message }, error.status);
      if (!user) return json({ error: '로그인한 회원만 이용할 수 있습니다.' }, 401);
      if (pathname === '/api/audit/mine' && method === 'GET') return json({ tips: this.auditTips('WHERE user_id = ?', user.id).map(audit.ownTip) });
      if (pathname === '/api/audit/tips' && method === 'POST') {
        if (this.requireVerifiedEmail && !user.emailVerified) return json({ error: '이메일 인증을 마친 회원만 제보할 수 있습니다.' }, 403);
        const allowed = await this.rateLimit(`audit-tip:${user.id}`, 3, 24 * 60 * 60 * 1000, Date.now());
        if (!allowed) return json({ error: '제보는 하루 3건까지 보낼 수 있습니다. 내일 다시 보내 주세요.' }, 429);
        let input = {};
        try { input = JSON.parse(body ? body.toString('utf8') : '{}'); } catch { return json({ error: '요청 내용을 확인해 주세요.' }, 400); }
        const blocked = !user.admin && guard.check(...Object.values(input || {}).filter(value => typeof value === 'string'));
        if (blocked) {
          this.later(() => this.slack.blocked({ where: '주민감사청구 제보', category: blocked.category, reason: blocked.reason, nickname: user.nickname, text: String(input.title || '') }));
          return json({ error: guard.MESSAGE(blocked) }, 400);
        }
        const tip = { ...audit.normalizeTip(input), authorName: user.nickname, status: audit.STATUSES[0], memo: '', published: false, publicTitle: '', publicSummary: '' };
        const now = Date.now();
        const id = `${now}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
        this.sql.exec('INSERT INTO audit_tips VALUES (?, ?, ?, ?, ?)', id, user.id, JSON.stringify(tip), now, now);
        this.later(() => this.slack.auditTip(tip));
        return json({ ok: true, id }, 201);
      }
      if (!user.admin) return json({ error: '운영자만 볼 수 있습니다.' }, 403);
      if (pathname === '/api/audit/tips' && method === 'GET') {
        // 보관 기간: '종결'된 제보는 마지막 처리 후 3년이 지나면 지운다(제보 양식에 알린 대로).
        this.sql.exec('DELETE FROM audit_tips WHERE updated_at < ? AND json_extract(data, \'$.status\') = ?', Date.now() - 3 * 365 * 24 * 60 * 60 * 1000, '종결');
        return json({ tips: this.auditTips(), statuses: audit.STATUSES });
      }
      const match = /^\/api\/audit\/tips\/(\d{10,15}-[0-9a-f]{10})$/.exec(pathname);
      if (match && method === 'POST') {
        const row = [...this.sql.exec('SELECT data FROM audit_tips WHERE id = ?', match[1])][0];
        if (!row) return json({ error: '없는 제보입니다.' }, 404);
        let input = {};
        try { input = JSON.parse(body ? body.toString('utf8') : '{}'); } catch { return json({ error: '요청 내용을 확인해 주세요.' }, 400); }
        const tip = { ...JSON.parse(row.data), ...audit.normalizeReview(input) };
        this.sql.exec('UPDATE audit_tips SET data = ?, updated_at = ? WHERE id = ?', JSON.stringify(tip), Date.now(), match[1]);
        return json({ ok: true });
      }
      return json({ error: '요청한 기능이 없습니다.' }, 404);
    } catch (failure) {
      if (failure instanceof audit.AuditError) return json({ error: failure.message }, failure.status);
      console.error('Audit API failed:', failure);
      return json({ error: '처리 중 오류가 났습니다. 잠시 후 다시 시도해 주세요.' }, 500);
    }
  }

  async alarm() {
    const result = await this.newsletter.processQueue();
    if (result.more) await this.state.storage.setAlarm(Date.now() + (result.delay || 60000));
  }

  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const headers = Object.fromEntries(request.headers);
    // 사진 올리기만 1.6MB까지, 나머지 요청은 320KB까지 받는다.
    const maxBody = pathname === '/api/board/image' ? 1600 * 1024 : 320 * 1024;
    if (Number(request.headers.get('content-length') || 0) > maxBody) return json({ error: pathname === '/api/board/image' ? '사진이 너무 큽니다.' : '입력 내용이 너무 큽니다.' }, 413);
    const body = request.body ? Buffer.from(await request.arrayBuffer()) : null;
    if (body && body.length > maxBody) return json({ error: '입력 내용이 너무 큽니다.' }, 413);
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
    // 브리핑 커넥터(MCP): 바깥 /api/mcp/<비밀값> 에서 비밀값을 확인한 요청만 여기로 넘어온다.
    if (pathname === '/internal/briefing-mcp') {
      const allowed = await this.rateLimit('briefing-mcp', 60, 60 * 60 * 1000, Date.now());
      if (!allowed) return json({ error: '요청이 많습니다. 잠시 후 다시 시도해 주세요.' }, 429);
      let input = null;
      try { input = JSON.parse(body ? body.toString('utf8') : ''); } catch { input = null; }
      const output = await this.briefing(request.method, input);
      return output.body === undefined ? new Response(null, { status: output.status }) : json(output.body, output.status);
    }
    if (pathname === '/internal/briefing') {
      const kind = url.searchParams.get('kind') || '';
      const slug = url.searchParams.get('slug') || '';
      if (!briefingPages.KINDS[kind]) return json({ report: null, others: [] });
      return json({ report: slug ? this.briefings.get(kind, slug) : null, others: this.briefings.list(kind) });
    }
    if (pathname === '/internal/public-post') {
      return json(await this.board.publicPost(url.searchParams.get('no')));
    }
    // 스페이스 톡 '회원 불러오기'용(TALK 대화방 서버만 부른다: /internal/ 경로는 바깥에서 들어올 수 없음)
    if (pathname === '/internal/member-search') {
      const ids = url.searchParams.get('ids');
      return json({ members: await this.auth.findMembers(ids !== null ? { ids: ids.split(',').filter(Boolean).slice(0, 50) } : { q: url.searchParams.get('q') || '' }) });
    }
    if (pathname === '/internal/public-posts') {
      return json({ posts: await this.board.publicPosts() });
    }
    if (pathname === '/internal/letters') {
      return json({ letters: await this.newsletter.publicLetters() });
    }
    if (pathname === '/internal/chat-identity') {
      const { user } = await this.auth.authenticate(source);
      const canSend = Boolean(user && (!this.requireVerifiedEmail || user.emailVerified));
      const csrfOk = headers['x-csrf-token'] ? !(await this.auth.authenticate(source, { csrf: true })).error : false;
      return json({ name: canSend ? user.nickname : null, signedIn: Boolean(user), csrfOk,
        user: user ? { id: user.id, nickname: user.nickname, verified: canSend, admin: Boolean(user.admin) } : null });
    }
    // 카카오톡 공유를 눌렀다는 신호: 운영자 슬랙에만 알린다(한 주소에서 1시간 20번까지)
    if (pathname === '/api/notify/share') {
      if (request.method !== 'POST') return json({ error: '지원하지 않는 요청 방식입니다.' }, 405);
      // configured: 슬랙 주소가 제대로 들어 있는지(주소 자체는 알려 주지 않는다)
      if (!this.slack.ready) return json({ ok: true, configured: false });
      const allowed = await this.rateLimit(`share-notify:${source.socket.remoteAddress}`, 20, 60 * 60 * 1000, Date.now());
      if (!allowed) return json({ ok: true });
      let input = {};
      try { input = JSON.parse(body ? body.toString('utf8') : '{}'); } catch { input = {}; }
      this.later(() => this.slack.share({ title: String(input.title || '').slice(0, 200), url: String(input.url || '').slice(0, 500) }));
      return json({ ok: true, configured: true });
    }
    if (pathname === '/api/audit' || pathname.startsWith('/api/audit/')) return this.auditApi(request, source, body, pathname);
    const handler = pathname.startsWith('/api/auth/') ? this.auth :
      pathname === '/api/board' || pathname.startsWith('/api/board/') ? this.board :
      pathname.startsWith('/api/newsletter') || pathname.startsWith('/api/admin/newsletter') || pathname.startsWith('/n/') ? this.newsletter :
      pathname === '/api/portal' || pathname.startsWith('/api/portal/') ? this.portal : this.community;
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
    // 스페이스톡이 '광장에서 바로 1:1'을 열기 전에, 두 사람이 지금 광장에 접속해 있는지 확인하는 용도(회원 번호만)
    if (url.pathname === '/internal/present') {
      const ids = new Set();
      for (const peer of this.ctx.getWebSockets()) { const info = peer.deserializeAttachment() || {}; if (info.uid && info.name) ids.add(info.uid); }
      return json({ ids: [...ids] });
    }
    // 공유 주소(/e/글번호) 화면에 쓰는 모임안내·초청장 원문
    if (url.pathname === '/internal/announcement') {
      const id = url.searchParams.get('id') || '';
      const record = announcement.ID.test(id) ? await this.ctx.storage.get(`a:${id}`) : null;
      return json(record ? { record } : { error: 'not found' }, record ? 200 : 404);
    }
    // 스페이스톡에서 운영자가 모임안내를 고치면: 공유 주소 원문(a:)과 광장채팅 메시지(m:)도 같은 내용으로 바꾼다.
    if (url.pathname === '/internal/announcement-edit' && request.method === 'POST') {
      const { id, text } = await request.json().catch(() => ({}));
      const body = typeof text === 'string' ? text.trim() : '';
      if (!announcement.ID.test(String(id || '')) || !announcement.kindOf(body) || body.length > 20000) return json({ error: 'invalid' }, 400);
      const record = await this.ctx.storage.get(`a:${id}`);
      if (record) await this.ctx.storage.put(`a:${id}`, { ...record, text: body, editedAt: Date.now() });
      const key = squareKeyOf(id);
      const stored = key ? await this.ctx.storage.get(key) : null;
      if (stored) {
        await this.ctx.storage.put(key, { ...stored, text: body, edited: true });
        this.broadcast(() => ({ type: 'edited', id, text: body }));
      }
      return json({ ok: true, record: Boolean(record), square: Boolean(stored) });
    }
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
    const people = new Map(); // 회원 번호 → 닉네임: '지금 함께 있는 회원과 스페이스톡'에서 고를 수 있게
    let guests = 0;
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === leaving) continue;
      const info = peer.deserializeAttachment() || {};
      if (info.name) { members.add(info.name); if (info.uid) people.set(info.uid, info.name); } else guests += 1;
    }
    return { type: 'presence', members: [...members].sort((a, b) => a.localeCompare(b, 'ko')), guests,
      people: [...people].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ko')) };
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
    return { type: 'message', id: message.id, name: message.name, text: message.text, ...(message.image ? { image: message.image } : {}), at: message.at, own: Boolean(uid) && message.uid === uid };
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
    // 광장에서 스페이스톡 대화방을 만든 회원이, 지금 광장을 보고 있는 초대 대상에게만 '초대 알림'을 띄운다(광장 글로 남지 않음).
    if (input?.type === 'talk-invite') {
      const roomId = String(input.roomId || '');
      const ids = Array.isArray(input.userIds) ? input.userIds.map(String).slice(0, 50) : [];
      if (!window.uid || !/^[0-9a-f-]{36}$/.test(roomId) || !ids.length) { error('초대 알림을 보낼 수 없습니다.'); return; }
      const now = Date.now();
      if (now - window.start >= 60000) window = { ...window, start: now, count: 0 };
      window.count += 3;
      socket.serializeAttachment(window);
      if (window.count > 30) { error('요청이 많습니다. 잠시 후 다시 시도해 주세요.'); return; }
      const wanted = new Set(ids);
      const roomName = typeof input.roomName === 'string' ? input.roomName.trim().slice(0, 40) : '';
      let delivered = 0;
      for (const peer of this.ctx.getWebSockets()) {
        const info = peer.deserializeAttachment() || {};
        if (!info.uid || info.uid === window.uid || !wanted.has(info.uid)) continue;
        try { peer.send(JSON.stringify({ type: 'talk-invite', from: window.name, roomId, roomName, dm: input.dm === true })); delivered += 1; } catch { /* 연결 끊김 */ }
      }
      socket.send(JSON.stringify({ type: 'talk-invite-sent', delivered }));
      return;
    }
    if (input?.type === 'delete') {
      const key = squareKeyOf(input.id);
      const stored = key ? await this.ctx.storage.get(key) : null;
      if (!stored) { error('이미 삭제되었거나 없는 메시지입니다.'); return; }
      if (!(window.admin || (window.uid && stored.uid === window.uid))) { error('내가 보낸 메시지만 삭제할 수 있습니다.'); return; }
      await this.ctx.storage.delete([key, `a:${stored.id}`]);
      this.broadcast(() => ({ type: 'deleted', id: stored.id }));
      return;
    }
    const text = typeof input?.text === 'string' ? input.text.trim() : '';
    // 사진: 먼저 /api/board/image?purpose=chat 으로 올린 사진 번호만 받는다(사진만 보내도 된다).
    const image = typeof input?.image === 'string' && /^[0-9a-f]{32}$/.test(input.image) ? input.image : '';
    if ((!text && !image) || text.length > 2000) { error('채팅은 1~2,000자로 입력해 주세요.'); return; }
    // 불법 도박·음란·불법 금융 광고 등은 광장에 올리지 않는다(운영자 글은 제외).
    const blocked = !window.admin && guard.check(text);
    if (blocked) {
      if (this.env.SLACK_WEBHOOK_URL) {
        const slack = slackNotify.createSlackNotifier({ webhookUrl: this.env.SLACK_WEBHOOK_URL, siteUrl: this.env.SITE_URL || 'https://withpluces.com' });
        this.ctx.waitUntil(slack.blocked({ where: '광장 채팅', category: blocked.category, reason: blocked.reason, nickname: window.name, text }).catch(() => {}));
      }
      error(guard.MESSAGE(blocked));
      return;
    }
    const now = Date.now();
    if (now - window.start >= 60000) window = { ...window, start: now, count: 0 };
    window.count += 1;
    socket.serializeAttachment(window);
    if (window.count > 30) { error('채팅 전송이 많습니다. 잠시 후 다시 시도해 주세요.'); return; }
    const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    const stored = { id: `${now}-${rand}`, uid: window.uid || '', name: window.name, text, ...(image ? { image } : {}), at: now };
    await this.ctx.storage.put(squareKey(now, rand), stored);
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(now + 24 * 60 * 60 * 1000);
    this.broadcast(peer => this.publicMessage(stored, peer.uid));
    // 운영자가 [모임안내]·[초청장]으로 시작한 글: 공유 주소용으로 따로 보관하고 스페이스톡 '📣 모임안내' 채널로 보낸다.
    if (window.admin && announcement.kindOf(text)) {
      await this.ctx.storage.put(`a:${stored.id}`, { id: stored.id, text, at: now, ...(image ? { image } : {}) });
      try {
        if (!this.env.TALK) throw new Error('스페이스톡이 연결되어 있지 않습니다.');
        const site = this.env.SITE_URL || 'https://withpluces.com';
        const link = `${site}/e/${stored.id}`;
        // 안내장 사진(포스터)이 있으면 스페이스톡 카드에도 보이도록 사진 주소 줄을 붙인다.
        const poster = image ? `\n\n안내장 사진: ${site}/api/board/image?id=${image}` : '';
        const response = await this.env.TALK.get(this.env.TALK.idFromName('talk-v1')).fetch('https://internal.invalid/internal/event-announcement', {
          method: 'POST', body: JSON.stringify({ sourceId: stored.id, text: `${text}${poster}\n\n자세히 보기·카카오톡 공유: ${link}`, sender: window.uid ? { id: window.uid, nickname: window.name } : null }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        socket.send(JSON.stringify({ type: 'forwarded', id: stored.id, subscribers: result.subscribers || 0, channel: result.channel || '📣 모임안내' }));
      } catch (failure) {
        console.error('Announcement forward failed:', failure);
        socket.send(JSON.stringify({ type: 'forward-error', error: `스페이스톡 안내 채널로 보내지 못했습니다: ${failure.message}` }));
      }
    } else if (window.admin && input?.forward === 'general') {
      // 운영자가 '💬 보통메시지'로 고른 글: 스페이스톡 '💬 보통메시지' 채널로 글자 그대로 보낸다(그림 카드 없이, 사진은 주소 한 줄).
      try {
        if (!this.env.TALK) throw new Error('스페이스톡이 연결되어 있지 않습니다.');
        const site = this.env.SITE_URL || 'https://withpluces.com';
        const photo = image ? `\n\n사진 보기: ${site}/api/board/image?id=${image}` : '';
        // 카카오톡 공유 카드가 열 주소(/e/번호)를 모임안내처럼 만들어 둔다.
        await this.ctx.storage.put(`a:${stored.id}`, { id: stored.id, text: `${announcement.GENERAL.tag}\n${text || '사진'}`, at: now, ...(image ? { image } : {}) });
        const link = `${site}/e/${stored.id}`;
        const response = await this.env.TALK.get(this.env.TALK.idFromName('talk-v1')).fetch('https://internal.invalid/internal/general-message', {
          method: 'POST', body: JSON.stringify({ sourceId: stored.id, text: `${text || '(사진)'}${photo}\n\n자세히 보기·카카오톡 공유: ${link}`, sender: window.uid ? { id: window.uid, nickname: window.name } : null }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        socket.send(JSON.stringify({ type: 'forwarded', id: stored.id, subscribers: result.subscribers || 0, channel: result.channel || '💬 보통메시지', general: true }));
      } catch (failure) {
        console.error('General message forward failed:', failure);
        socket.send(JSON.stringify({ type: 'forward-error', error: `스페이스톡 보통메시지 채널로 보내지 못했습니다: ${failure.message}` }));
      }
    }
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

// 매일 아침 7시 30분(KST) 스페이스 톡 '📰 오늘의 정책브리핑' 채널에 전날 정책뉴스 가운데 한 테마를 골라 올린다.
// (UTC 22:30 = 다음 날 KST 07:30, wrangler.jsonc triggers.crons 와 같아야 한다)
const DAILY_BRIEFING_CRON = '30 22 * * *';
async function postDailyBriefing(env) {
  if (!env.POLICY_NEWS_KEY || !env.TALK) return;
  const now = Date.now();
  const items = await policyNews.recentPolicyNews(fetch, env.POLICY_NEWS_KEY, now);
  const text = policyNews.dailyBriefingText(items, now, env.SITE_URL || 'https://withpluces.com');
  if (!text) return;
  const day = new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await env.TALK.get(env.TALK.idFromName('talk-v1')).fetch('https://internal.invalid/internal/channel-post', { method: 'POST', body: JSON.stringify({ text, day }) });
  // 운영자 슬랙에도 같은 브리핑을 보낸다(웹훅이 없으면 건너뜀). 실패해도 스페이스톡 게시에는 영향 없음.
  try {
    await slackNotify.createSlackNotifier({ webhookUrl: env.SLACK_WEBHOOK_URL || '', siteUrl: env.SITE_URL || 'https://withpluces.com' }).dailyBriefing(text);
  } catch (error) { console.error('Daily briefing Slack failed:', error.message); }
}

const communityStub = env => env.COMMUNITY.get(env.COMMUNITY.idFromName('community-v1'));
// 비밀값 비교(길이·내용이 달라도 걸리는 시간이 같도록 해시끼리 비교)
const sameSecret = (given, expected) => Boolean(expected) && String(expected).length >= 24 &&
  timingSafeEqual(createHash('sha256').update(String(given)).digest(), createHash('sha256').update(String(expected)).digest());
const publicPosts = async env => (await (await communityStub(env).fetch('https://internal.invalid/internal/public-posts')).json()).posts;
const publicLetters = async env => (await (await communityStub(env).fetch('https://internal.invalid/internal/letters')).json()).letters;
const htmlPage = (request, html, status = 200, maxAge = 300) => new Response(request.method === 'HEAD' ? null : html, { status,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': `public, max-age=${maxAge}`, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' } });

export default {
  async scheduled(event, env, ctx) {
    if (event.cron === DAILY_BRIEFING_CRON) {
      ctx.waitUntil(postDailyBriefing(env).catch(error => console.error('Daily policy briefing failed:', error)));
      return;
    }
    const stub = env.COMMUNITY.get(env.COMMUNITY.idFromName('community-v1'));
    ctx.waitUntil(stub.fetch('https://internal.invalid/internal/newsletter-weekly', { method: 'POST' })
      .catch(error => console.error('Weekly newsletter draft failed:', error)));
  },
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      // 브리핑 커넥터(MCP): claude.ai 사용자 지정 커넥터 주소 https://withpluces.com/api/mcp/<BRIEFING_MCP_SECRET>
      const mcpMatch = /^\/api\/mcp\/([A-Za-z0-9_-]{24,128})\/?$/.exec(url.pathname);
      if (mcpMatch || url.pathname === '/api/mcp' || url.pathname.startsWith('/api/mcp/')) {
        if (!mcpMatch || !sameSecret(mcpMatch[1], env.BRIEFING_MCP_SECRET)) return new Response(null, { status: 404 });
        if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
        return await communityStub(env).fetch('https://internal.invalid/internal/briefing-mcp', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await request.text(),
        });
      }
      if (url.pathname.startsWith('/api/auth/') || url.pathname === '/api/board' || url.pathname.startsWith('/api/board/') ||
          url.pathname.startsWith('/api/newsletter') || url.pathname.startsWith('/api/admin/newsletter') || url.pathname.startsWith('/n/') ||
          url.pathname === '/api/comments' || url.pathname === '/api/portal' || url.pathname.startsWith('/api/portal/') || url.pathname === '/api/notify/share' ||
          url.pathname.startsWith('/api/audit/')) {
        if (url.pathname === '/api/notify/share' && request.headers.get('Origin') !== env.SITE_URL) return json({ ok: true });
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
      // 모임안내·초청장 공유 주소: 카카오톡 등에 보내면 로고·제목이 담긴 미리보기 카드로 보인다.
      const eventMatch = /^\/e\/(\d{10,15}-[a-z0-9]{6,16})\/?$/.exec(url.pathname);
      if (eventMatch && (request.method === 'GET' || request.method === 'HEAD')) {
        const response = await env.CHAT.get(env.CHAT.idFromName('public-chat-v1')).fetch(`https://internal.invalid/internal/announcement?id=${eventMatch[1]}`);
        const { record } = await response.json().catch(() => ({}));
        const html = record ? announcement.renderAnnouncementPage(record, env.SITE_URL || url.origin) : null;
        if (!html) return new Response('<!doctype html><meta charset="utf-8"><title>안내를 찾을 수 없습니다</title><p style="font-family:sans-serif;padding:24px">삭제되었거나 없는 안내입니다. <a href="/">스페이스 커뮤니티 홈</a>', { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        return new Response(request.method === 'HEAD' ? null : html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' } });
      }
      // 게시글 개별 페이지와 검색엔진 지도(글이 올라오면 자동으로 늘어난다)
      const postMatch = /^\/post\/(\d{1,9})\/?$/.exec(url.pathname);
      if (postMatch && (request.method === 'GET' || request.method === 'HEAD')) {
        const siteUrl = env.SITE_URL || url.origin;
        const result = await (await env.COMMUNITY.get(env.COMMUNITY.idFromName('community-v1')).fetch(`https://internal.invalid/internal/public-post?no=${postMatch[1]}`)).json();
        const html = result.status === 200 ? postPage.renderPostPage(result, siteUrl) : postPage.renderMissingPage(result.status, siteUrl);
        return new Response(request.method === 'HEAD' ? null : html, { status: result.status === 200 ? 200 : result.status === 403 ? 403 : 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' } });
      }
      // Google Play 앱(TWA)과 사이트를 잇는 확인 파일
      if (url.pathname === '/.well-known/assetlinks.json') {
        return new Response(JSON.stringify(androidApp.assetLinks(env)), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' } });
      }
      if (url.pathname === '/sitemap.xml') {
        const [posts, letters] = await Promise.all([publicPosts(env), publicLetters(env)]);
        return new Response(postPage.renderSitemap(posts, env.SITE_URL || url.origin, undefined, { letters }), { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
      }
      const readable = request.method === 'GET' || request.method === 'HEAD';
      // 게시판 목록(한 페이지 5개, ?page=N)
      const boardMatch = /^\/board\/([a-z]+)\/?$/.exec(url.pathname);
      if (boardMatch && readable) {
        const siteUrl = env.SITE_URL || url.origin;
        const pageParam = url.searchParams.get('page');
        const page = pageParam === null ? 1 : /^[1-9]\d{0,4}$/.test(pageParam) ? Number(pageParam) : 0;
        const html = postPage.LIST_BOARDS.includes(boardMatch[1]) && page
          ? postPage.renderBoardPage({ board: boardMatch[1], posts: await publicPosts(env), page }, siteUrl) : null;
        return html ? htmlPage(request, html) : htmlPage(request, postPage.renderMissingPage(404, siteUrl, '게시판이나 페이지를 찾을 수 없습니다. 커뮤니티 홈에서 찾아 주세요.'), 404);
      }
      // 홈 화면 '주간·월간 시장동향 브리핑' 단추용: 가장 최근 브리핑의 제목·기간만 알려 준다.
      if (url.pathname === '/api/briefing/latest' && request.method === 'GET') {
        const pick = async kind => {
          const { others } = await (await communityStub(env).fetch(`https://internal.invalid/internal/briefing?${new URLSearchParams({ kind, slug: '' })}`)).json();
          const top = (others || [])[0];
          return top ? { title: top.title, slug: top.slug, publishedAt: top.publishedAt, path: `/briefing/${kind}/${top.slug}` } : null;
        };
        const [weekly, monthly] = await Promise.all([pick('weekly'), pick('monthly')]);
        return Response.json({ weekly, monthly }, { headers: { 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' } });
      }
      // 시장동향 브리핑 전문: 주간 /briefing/weekly(/2026-10-30), 월간 /briefing/monthly(/2026-10)
      const briefingMatch = /^\/briefing\/(weekly|monthly)(?:\/(\d{4}-\d{2}(?:-\d{2})?))?\/?$/.exec(url.pathname);
      if ((briefingMatch || url.pathname === '/briefing' || url.pathname === '/briefing/') && readable) {
        const siteUrl = env.SITE_URL || url.origin;
        if (!briefingMatch) return Response.redirect(`${siteUrl}/briefing/weekly`, 302);
        const [, kind, slug] = briefingMatch;
        const query = new URLSearchParams({ kind, slug: slug || '' });
        const { report, others } = await (await communityStub(env).fetch(`https://internal.invalid/internal/briefing?${query}`)).json();
        if (!slug) return htmlPage(request, briefingPages.renderBriefingList(kind, others, siteUrl));
        if (!report) return htmlPage(request, postPage.renderMissingPage(404, siteUrl, '브리핑을 찾을 수 없습니다. 목록에서 찾아 주세요.'), 404);
        return htmlPage(request, briefingPages.renderBriefingPage({ report, others }, siteUrl));
      }
      // 지난 스페이스 레터: 목록 /letter, 한 호 /letter/발행일. 예전 주소 /letter?id=…는 새 주소로 옮긴다.
      const letterMatch = /^\/letter(?:\/([0-9]{4}-[0-9]{2}-[0-9]{2}(?:-[0-9]{1,2})?)?)?\/?$/.exec(url.pathname);
      if (letterMatch && readable) {
        const siteUrl = env.SITE_URL || url.origin;
        const letters = await publicLetters(env);
        const legacyId = url.searchParams.get('id');
        const letter = letterMatch[1] ? letters.find(entry => entry.slug === letterMatch[1]) : legacyId ? letters.find(entry => entry.id === legacyId) : null;
        if (!letterMatch[1] && legacyId && letter) return Response.redirect(`${siteUrl}/letter/${letter.slug}`, 301);
        if (!letterMatch[1] && !legacyId) return htmlPage(request, postPage.renderLetterList(letters, siteUrl));
        if (!letter) return htmlPage(request, postPage.renderMissingPage(404, siteUrl, '레터를 찾을 수 없습니다. 지난 레터 목록에서 찾아 주세요.'), 404);
        return htmlPage(request, postPage.renderLetterPage({ letter, letters }, siteUrl), 200, 3600);
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
      // 첫 화면: 최신 공개 글 5개(?page=N이면 N쪽)와 페이지 번호를 처음 받는 HTML에 링크로 넣어 둔다(검색엔진용). 불러오지 못하면 원래 화면 그대로.
      if ((url.pathname === '/' || url.pathname === '/index.html') && request.method === 'GET') {
        const response = await env.ASSETS.fetch(request);
        if (response.status !== 200 || !(response.headers.get('Content-Type') || '').includes('text/html')) return response;
        const html = await response.text();
        const posts = await publicPosts(env).catch(error => { console.error('Home latest posts failed:', error); return []; });
        const headers = new Headers(response.headers);
        headers.delete('Content-Length');
        headers.delete('ETag');
        const page = /^[1-9]\d{0,4}$/.test(url.searchParams.get('page') || '') ? Number(url.searchParams.get('page')) : 1;
        return new Response(postPage.injectLatestPosts(html, posts, page), { status: 200, headers });
      }
      return await env.ASSETS.fetch(request);
    } catch (error) {
      console.error('Community Worker failed:', error);
      return json({ error: '서버에서 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 503);
    }
  },
};
