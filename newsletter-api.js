const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');

const DAY = 24 * 60 * 60 * 1000;
const NOTICE_INTERVAL = 2 * 365 * DAY - 14 * DAY;
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN = /^[a-f0-9]{48}$/;
const newToken = () => randomBytes(24).toString('hex');

class NewsletterError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

const safeUrl = url => (/^https?:\/\/[^\s"'<>]+$/i.test(url) ? url : null);

// Lightweight markup: "# 제목", "## 소제목", "- 목록", "**굵게**", "[글자](https://주소)", "![설명](https://이미지)", "---", bare links.
function renderMarkup(markup, linkFor = (index, url) => url) {
  const links = [];
  const anchor = (url, label) => {
    const index = links.push(url) - 1;
    return `<a href="${escapeHtml(linkFor(index, url))}" style="color:#1958e8;text-decoration:underline">${label}</a>`;
  };
  const inline = text => {
    const pattern = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]{1,500})\*\*|(https?:\/\/[^\s<]+)/g;
    let output = '';
    let last = 0;
    let match;
    while ((match = pattern.exec(text))) {
      output += escapeHtml(text.slice(last, match.index));
      if (match[1] !== undefined) {
        output += safeUrl(match[2]) ? anchor(match[2], escapeHtml(match[1])) : escapeHtml(match[0]);
      } else if (match[3] !== undefined) {
        output += `<strong>${escapeHtml(match[3])}</strong>`;
      } else {
        const url = match[4].replace(/[.,!?)\]]+$/, '');
        output += (safeUrl(url) ? anchor(url, escapeHtml(url)) : escapeHtml(url)) + escapeHtml(match[4].slice(url.length));
      }
      last = pattern.lastIndex;
    }
    return output + escapeHtml(text.slice(last));
  };
  const blocks = String(markup).replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(block => block.trim()).filter(Boolean);
  const html = blocks.map(block => {
    const lines = block.split('\n');
    if (block === '---') return '<hr style="border:0;border-top:1px solid #d9e2f2;margin:24px 0">';
    if (/^## /.test(block)) return `<h2 style="font-size:19px;margin:24px 0 8px;color:#16233a">${lines.map(line => inline(line.replace(/^## /, ''))).join('<br>')}</h2>`;
    if (/^# /.test(block)) return `<h1 style="font-size:24px;margin:8px 0 12px;color:#16233a">${lines.map(line => inline(line.replace(/^# /, ''))).join('<br>')}</h1>`;
    const image = block.match(/^!\[([^\]\n]{0,200})\]\((https?:\/\/[^\s)]+)\)$/);
    if (image && safeUrl(image[2])) return `<p style="margin:16px 0"><img src="${escapeHtml(image[2])}" alt="${escapeHtml(image[1])}" style="max-width:100%;height:auto;border-radius:8px"></p>`;
    if (lines.every(line => /^- /.test(line))) return `<ul style="padding-left:20px;margin:12px 0">${lines.map(line => `<li style="margin:4px 0">${inline(line.slice(2))}</li>`).join('')}</ul>`;
    return `<p style="margin:12px 0;line-height:1.75">${lines.map(inline).join('<br>')}</p>`;
  }).join('\n');
  return { html, links };
}

function markupToText(markup) {
  return String(markup).replace(/\r\n?/g, '\n')
    .replace(/^#{1,2} /gm, '')
    .replace(/!\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/g, '[이미지: $1] $2')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .trim();
}

function emailHtml({ title, bodyHtml, footerHtml, pixelUrl, button }) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#eef2f8;font-family:'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif;color:#26324a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#1958e8;padding:18px 28px;color:#ffffff;font-size:15px;font-weight:700;letter-spacing:.5px">SPACE LETTER · 스페이스 커뮤니티</td></tr>
<tr><td style="padding:24px 28px;font-size:15px">${bodyHtml}${button ? `<p style="margin:28px 0 8px;text-align:center"><a href="${escapeHtml(button.url)}" style="display:inline-block;background:#1958e8;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:8px">${escapeHtml(button.label)}</a></p>` : ''}</td></tr>
<tr><td style="padding:18px 28px;background:#f5f7fb;color:#6b7891;font-size:12px;line-height:1.7">${footerHtml}</td></tr>
</table></td></tr></table>${pixelUrl ? `<img src="${escapeHtml(pixelUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">` : ''}
</body></html>`;
}

function createNewsletterApi(dataDirectory, {
  storage, rateLimit, authenticate, mailer, siteUrl = 'https://withpluces.com', now = Date.now,
  dailyLimit = 300, batchSize = 20, batchDelay = 60000, legacySubscribers, clearLegacySubscribers, schedule,
  senderName = '(주)위드플러시아', contactEmail = '',
} = {}) {
  if (typeof authenticate !== 'function') throw new Error('Newsletter API requires an authenticate function');
  const origin = new URL(siteUrl).origin;
  const filePath = path.join(dataDirectory, 'newsletter.json');
  let writes = Promise.resolve();
  let migrated = false;
  const windows = new Map();
  const iso = () => new Date(now()).toISOString();
  const mailReady = () => Boolean(mailer?.configured);

  async function readStore() {
    try {
      const store = storage ? await storage.read() : JSON.parse(await fs.readFile(filePath, 'utf8'));
      for (const key of ['subscribers', 'campaigns', 'meta']) if (!Array.isArray(store[key])) store[key] = [];
      return store;
    } catch (error) {
      if (error.code === 'ENOENT') return { subscribers: [], campaigns: [], meta: [] };
      throw error;
    }
  }

  function updateStore(update) {
    const operation = writes.then(async () => {
      const store = await readStore();
      const result = update(store);
      if (storage) {
        await storage.write(store);
      } else {
        await fs.mkdir(dataDirectory, { recursive: true, mode: 0o700 });
        const temporaryPath = `${filePath}.tmp`;
        await fs.writeFile(temporaryPath, JSON.stringify(store, null, 2), { mode: 0o600 });
        await fs.rename(temporaryPath, filePath);
      }
      return result;
    });
    writes = operation.catch(error => {
      if (!(error instanceof NewsletterError)) console.error('Newsletter storage write failed:', error);
    });
    return operation;
  }

  function stateOf(store) {
    let state = store.meta.find(entry => entry.id === 'state');
    if (!state) {
      state = { id: 'state', day: '', sentToday: 0, migrated: false };
      store.meta.push(state);
    }
    return state;
  }

  async function ensureMigrated() {
    if (migrated) return;
    const store = await readStore();
    if (stateOf(store).migrated) {
      migrated = true;
      return;
    }
    const legacy = legacySubscribers ? await legacySubscribers() : [];
    await updateStore(current => {
      for (const entry of legacy || []) {
        const email = typeof entry?.email === 'string' ? entry.email.trim().toLowerCase() : '';
        if (!EMAIL.test(email) || current.subscribers.some(subscriber => subscriber.email === email)) continue;
        current.subscribers.push({ id: randomUUID(), email, status: 'legacy', consentVersion: entry.consentVersion || 'legacy',
          requestedAt: entry.requestedAt || iso(), unsubToken: newToken(), confirmToken: newToken() });
      }
      stateOf(current).migrated = true;
    });
    if (clearLegacySubscribers && legacy?.length) await clearLegacySubscribers();
    migrated = true;
  }

  function limit(key, max, duration) {
    const timestamp = now();
    if (rateLimit) {
      if (!rateLimit(key, max, duration, timestamp)) throw new NewsletterError(429, '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    for (const [entry, window] of windows) if (window.until <= timestamp) windows.delete(entry);
    const window = windows.get(key) || { count: 0, until: timestamp + duration };
    window.count += 1;
    windows.set(key, window);
    if (window.count > max) throw new NewsletterError(429, '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
  }

  function sendJson(response, status, body) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(body));
  }

  async function readBody(request, maxBytes = 4096) {
    if (!request.headers['content-type']?.startsWith('application/json')) throw new NewsletterError(415, 'JSON 형식으로 요청해 주세요.');
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > maxBytes) throw new NewsletterError(413, '입력 내용이 너무 큽니다.');
      chunks.push(chunk);
    }
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
      return body;
    } catch {
      throw new NewsletterError(400, '올바른 요청 내용을 입력해 주세요.');
    }
  }

  function sameSite(request) {
    const requestOrigin = request.headers.origin;
    return !requestOrigin || requestOrigin === origin || requestOrigin === `http://${request.headers.host}` || requestOrigin === `https://${request.headers.host}`;
  }

  async function requireAdmin(request, csrf) {
    const auth = await authenticate(request, { csrf });
    if (auth.error) throw new NewsletterError(auth.error.status, auth.error.message);
    if (!auth.user) throw new NewsletterError(401, '로그인해 주세요.');
    if (!auth.user.admin) throw new NewsletterError(403, '운영자만 이용할 수 있습니다.');
    return auth.user;
  }

  function compose(input) {
    const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
    const body = typeof input.body === 'string' ? input.body.trim() : '';
    if (!subject || subject.length > 150) throw new NewsletterError(400, '제목을 1~150자로 입력해 주세요.');
    if (!body || body.length > 50000) throw new NewsletterError(400, '본문을 1~50,000자로 입력해 주세요.');
    return { subject, body, ad: input.ad === true };
  }

  const kst = timestamp => new Date(timestamp + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

  function footer({ subscriber, ad, kind }) {
    const unsubscribeUrl = `${origin}/newsletter?unsubscribe=${subscriber?.unsubToken || 'preview'}`;
    const consent = subscriber?.consentAt ? kst(Date.parse(subscriber.consentAt)) : null;
    const lines = [
      kind === 'confirm' ? '이 메일은 스페이스 커뮤니티 뉴스레터 구독 신청을 확인하기 위해 보내드립니다. 신청하지 않으셨다면 무시하셔도 되며, 확인하지 않으면 구독되지 않습니다.'
        : '이 메일은 스페이스 커뮤니티 뉴스레터 수신에 동의하신 분께 보내드립니다.' + (ad && consent ? ` (수신동의일: ${consent})` : ''),
      `발신: ${escapeHtml(senderName)}${contactEmail ? ` · 문의: <a href="mailto:${escapeHtml(contactEmail)}" style="color:#6b7891">${escapeHtml(contactEmail)}</a>` : ''} · <a href="${origin}" style="color:#6b7891">withpluces.com</a>`,
    ];
    if (kind !== 'confirm') lines.push(`더 이상 받고 싶지 않으시면 <a href="${escapeHtml(unsubscribeUrl)}" style="color:#1958e8">수신거부</a>를 눌러 주세요. 즉시 처리되며 이메일 주소는 삭제됩니다.`);
    const text = lines.map(line => line.replace(/<[^>]+>/g, '')).join('\n') + (kind !== 'confirm' ? `\n수신거부: ${unsubscribeUrl}` : '');
    return { html: lines.join('<br>'), text };
  }

  function buildEmail({ kind = 'newsletter', campaign = null, subscriber = null, subject, body, ad }) {
    if (kind === 'confirm') {
      const url = `${origin}/newsletter?confirm=${subscriber?.confirmToken || 'preview'}`;
      const intro = '<h1 style="font-size:22px;margin:8px 0 12px;color:#16233a">뉴스레터 구독을 확인해 주세요</h1><p style="line-height:1.75">스페이스 커뮤니티 뉴스레터(스페이스 레터) 구독을 신청해 주셔서 감사합니다. 아래 버튼을 눌러 이메일 주소를 확인하시면 구독이 완료됩니다.</p>';
      const foot = footer({ subscriber, kind });
      return {
        subject: '[스페이스 레터] 구독 확인을 부탁드립니다',
        html: emailHtml({ title: '구독 확인', bodyHtml: intro, footerHtml: foot.html, button: { url, label: '구독 확인하기' } }),
        text: `스페이스 커뮤니티 뉴스레터 구독을 신청하셨습니다. 아래 링크를 열어 구독을 확인해 주세요.\n\n${url}\n\n${foot.text}`,
      };
    }
    if (kind === 'notice') {
      const consent = subscriber?.consentAt ? kst(Date.parse(subscriber.consentAt)) : '알 수 없음';
      const foot = footer({ subscriber, ad: true, kind });
      const bodyHtml = `<h1 style="font-size:22px;margin:8px 0 12px;color:#16233a">뉴스레터 수신동의 안내</h1><p style="line-height:1.75">「정보통신망 이용촉진 및 정보보호 등에 관한 법률」에 따라 수신동의 사실을 안내해 드립니다.</p><ul style="padding-left:20px"><li>수신동의일: ${escapeHtml(consent)}</li><li>수신 매체: 이메일 (${escapeHtml(subscriber?.email || '')})</li><li>발신자: ${escapeHtml(senderName)}</li></ul><p style="line-height:1.75">계속 받으시려면 아무 조치도 필요 없습니다. 받지 않으시려면 아래 수신거부를 눌러 주세요.</p>`;
      return {
        subject: '[스페이스 레터] 뉴스레터 수신동의 안내',
        html: emailHtml({ title: '수신동의 안내', bodyHtml, footerHtml: foot.html }),
        text: `뉴스레터 수신동의 안내\n수신동의일: ${consent}\n발신자: ${senderName}\n계속 받으시려면 조치가 필요 없습니다.\n\n${foot.text}`,
      };
    }
    const tracked = campaign && subscriber;
    const { html: bodyHtml } = renderMarkup(body, (index, url) => tracked ? `${origin}/n/c/${campaign.id}/${subscriber.id}/${index}` : url);
    const finalSubject = `${ad ? '(광고) ' : ''}${subject}`;
    const foot = footer({ subscriber, ad, kind });
    return {
      subject: finalSubject,
      html: emailHtml({ title: finalSubject, bodyHtml, footerHtml: foot.html, pixelUrl: tracked ? `${origin}/n/o/${campaign.id}/${subscriber.id}.gif` : null }),
      text: `${markupToText(body)}\n\n---\n${foot.text}`,
    };
  }

  async function deliver(to, email) {
    await mailer.send({ to, subject: email.subject, text: email.text, html: email.html });
  }

  function summary(store) {
    const subscribers = store.subscribers;
    const noticeDue = subscribers.filter(entry => entry.status === 'confirmed' &&
      now() - Date.parse(entry.lastNoticeAt || entry.consentAt || entry.confirmedAt || iso()) >= NOTICE_INTERVAL).length;
    const state = stateOf(store);
    return {
      mailConfigured: mailReady(), dailyLimit, sentToday: state.day === kst(now()) ? state.sentToday : 0,
      subscribers: {
        confirmed: subscribers.filter(entry => entry.status === 'confirmed').length,
        pending: subscribers.filter(entry => entry.status === 'pending').length,
        legacy: subscribers.filter(entry => entry.status === 'legacy').length,
        noticeDue,
      },
      campaigns: [...store.campaigns].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 50).map(campaign => ({
        id: campaign.id, kind: campaign.kind, subject: campaign.subject, ad: campaign.ad, status: campaign.status,
        createdAt: campaign.createdAt, finishedAt: campaign.finishedAt || null, createdBy: campaign.createdBy,
        total: campaign.recipients.length, sent: campaign.sent, failed: campaign.failed, skipped: campaign.skipped,
        remaining: campaign.queue.length, opens: campaign.opens.length, clicks: campaign.clicks.length,
        unsubscribes: campaign.unsubscribes, errors: campaign.errors.slice(-5),
      })),
    };
  }

  async function createCampaign(kind, user, content = {}) {
    if (!mailReady()) throw new NewsletterError(503, '메일 발송이 설정되지 않았습니다.');
    const campaign = await updateStore(store => {
      if (store.campaigns.some(entry => entry.status === 'sending')) throw new NewsletterError(409, '발송 중인 작업이 있습니다. 끝난 뒤 다시 시도하거나 취소해 주세요.');
      let recipients;
      if (kind === 'newsletter') recipients = store.subscribers.filter(entry => entry.status === 'confirmed');
      else if (kind === 'confirm') recipients = store.subscribers.filter(entry => entry.status !== 'confirmed');
      else recipients = store.subscribers.filter(entry => entry.status === 'confirmed' &&
        now() - Date.parse(entry.lastNoticeAt || entry.consentAt || entry.confirmedAt || iso()) >= NOTICE_INTERVAL);
      if (!recipients.length) throw new NewsletterError(400, kind === 'newsletter' ? '구독을 확인한 구독자가 없습니다.' : '보낼 대상이 없습니다.');
      if (kind === 'confirm') recipients.forEach(entry => { entry.confirmToken = entry.confirmToken || newToken(); });
      const ids = recipients.map(entry => entry.id);
      const entry = {
        id: randomUUID(), kind, subject: kind === 'newsletter' ? content.subject : kind === 'confirm' ? '구독 확인 요청' : '수신동의 안내',
        body: content.body || '', ad: Boolean(content.ad), links: kind === 'newsletter' ? renderMarkup(content.body).links : [],
        status: 'sending', createdAt: iso(), createdBy: user.nickname, recipients: ids, queue: [...ids],
        sent: 0, failed: 0, skipped: 0, opens: [], clicks: [], unsubscribes: 0, errors: [],
      };
      store.campaigns.push(entry);
      return entry;
    });
    if (schedule) await schedule(500);
    return campaign;
  }

  async function processQueue() {
    await ensureMigrated();
    if (!mailReady()) return { more: false };
    const batch = await updateStore(store => {
      const state = stateOf(store);
      const day = kst(now());
      if (state.day !== day) {
        state.day = day;
        state.sentToday = 0;
      }
      const campaign = store.campaigns.find(entry => entry.status === 'sending');
      if (!campaign) return null;
      const room = Math.min(batchSize, dailyLimit - state.sentToday);
      if (room <= 0) return { wait: true };
      const ids = campaign.queue.splice(0, room);
      const items = [];
      for (const id of ids) {
        const subscriber = store.subscribers.find(entry => entry.id === id);
        const eligible = subscriber && (campaign.kind === 'confirm' ? subscriber.status !== 'confirmed' && subscriber.confirmToken : subscriber.status === 'confirmed');
        if (eligible) items.push({ ...subscriber });
        else campaign.skipped += 1;
      }
      state.sentToday += items.length;
      return { campaign: { id: campaign.id, kind: campaign.kind, subject: campaign.subject, body: campaign.body, ad: campaign.ad }, items };
    });
    if (!batch) return { more: false };
    if (batch.wait) {
      const nextDay = Date.parse(`${kst(now() + DAY)}T00:00:00+09:00`);
      return { more: true, delay: Math.max(60000, nextDay - now() + 60000) };
    }
    const outcomes = [];
    for (const subscriber of batch.items) {
      try {
        await deliver(subscriber.email, buildEmail({ kind: batch.campaign.kind, campaign: batch.campaign, subscriber,
          subject: batch.campaign.subject, body: batch.campaign.body, ad: batch.campaign.ad }));
        outcomes.push({ id: subscriber.id, ok: true });
      } catch (error) {
        console.error('Newsletter delivery failed:', error.code || error.name || 'error');
        outcomes.push({ id: subscriber.id, ok: false, code: String(error.code || error.name || 'error').slice(0, 60) });
      }
    }
    const more = await updateStore(store => {
      const campaign = store.campaigns.find(entry => entry.id === batch.campaign.id);
      if (campaign) {
        for (const outcome of outcomes) {
          if (outcome.ok) campaign.sent += 1;
          else {
            campaign.failed += 1;
            campaign.errors.push(outcome.code);
            if (campaign.errors.length > 20) campaign.errors.splice(0, campaign.errors.length - 20);
          }
          if (outcome.ok && campaign.kind === 'notice') {
            const subscriber = store.subscribers.find(entry => entry.id === outcome.id);
            if (subscriber) subscriber.lastNoticeAt = iso();
          }
        }
        if (campaign.status === 'sending' && campaign.queue.length === 0) {
          campaign.status = 'done';
          campaign.finishedAt = iso();
        }
      }
      return store.campaigns.some(entry => entry.status === 'sending');
    });
    return { more, delay: batchDelay };
  }

  async function handleNewsletterApi(request, response, pathname) {
    try {
      const ip = request.socket.remoteAddress;
      await ensureMigrated();

      const track = pathname.match(/^\/n\/(o|c)\/([0-9a-f-]{36})\/([0-9a-f-]{36})(?:\.gif|\/(\d{1,4}))?$/);
      if (pathname.startsWith('/n/')) {
        let location = origin;
        if (track && request.method === 'GET') {
          const [, type, campaignId, subscriberId, index] = track;
          try {
            await updateStore(store => {
              const campaign = store.campaigns.find(entry => entry.id === campaignId);
              if (!campaign || !campaign.recipients.includes(subscriberId)) return;
              if (type === 'c' && index !== undefined && campaign.links[Number(index)]) location = campaign.links[Number(index)];
              const list = type === 'o' ? campaign.opens : campaign.clicks;
              if (!list.includes(subscriberId)) list.push(subscriberId);
              if (type === 'c' && !campaign.opens.includes(subscriberId)) campaign.opens.push(subscriberId);
            });
          } catch (error) {
            console.error('Newsletter tracking failed:', error);
          }
          if (type === 'o') {
            response.writeHead(200, { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, private', 'Content-Length': PIXEL.length });
            response.end(PIXEL);
            return;
          }
        }
        response.writeHead(302, { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        response.end();
        return;
      }

      if (pathname === '/api/admin/newsletter' || pathname === '/api/admin/newsletter/subscribers') {
        if (request.method !== 'GET') {
          response.setHeader('Allow', 'GET');
          throw new NewsletterError(405, '지원하지 않는 요청 방식입니다.');
        }
        await requireAdmin(request, false);
        const store = await readStore();
        if (pathname === '/api/admin/newsletter') sendJson(response, 200, summary(store));
        else sendJson(response, 200, { subscribers: store.subscribers.map(entry => ({ email: entry.email, status: entry.status,
          requestedAt: entry.requestedAt, consentAt: entry.consentAt || null, lastNoticeAt: entry.lastNoticeAt || null })) });
        return;
      }

      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        throw new NewsletterError(405, '지원하지 않는 요청 방식입니다.');
      }

      if (pathname.startsWith('/api/admin/newsletter/')) {
        const user = await requireAdmin(request, true);
        const action = pathname.slice('/api/admin/newsletter/'.length);
        const input = await readBody(request, 160 * 1024);
        if (action === 'preview') {
          const content = compose(input);
          const email = buildEmail({ ...content });
          sendJson(response, 200, { subject: email.subject, html: email.html, text: email.text });
          return;
        }
        if (action === 'test') {
          const content = compose(input);
          if (!mailReady()) throw new NewsletterError(503, '메일 발송이 설정되지 않았습니다.');
          limit(`nl-test:${user.id}`, 10, 60 * 60000);
          const email = buildEmail({ ...content });
          await deliver(user.email, { ...email, subject: `[시험 발송] ${email.subject}` });
          sendJson(response, 200, { message: `${user.email}(으)로 시험 메일을 보냈습니다.` });
          return;
        }
        if (action === 'send') {
          const content = compose(input);
          const campaign = await createCampaign('newsletter', user, content);
          sendJson(response, 201, { message: `구독자 ${campaign.recipients.length}명에게 발송을 시작했습니다. 하루 ${dailyLimit}통 이내로 나누어 보냅니다.` });
          return;
        }
        if (action === 'reconfirm' || action === 'notice') {
          const campaign = await createCampaign(action === 'reconfirm' ? 'confirm' : 'notice', user);
          sendJson(response, 201, { message: `${campaign.recipients.length}명에게 ${action === 'reconfirm' ? '구독 확인 메일' : '수신동의 안내'} 발송을 시작했습니다.` });
          return;
        }
        if (action === 'cancel') {
          await updateStore(store => {
            const campaign = store.campaigns.find(entry => entry.id === input.id);
            if (!campaign || campaign.status !== 'sending') throw new NewsletterError(404, '취소할 발송이 없습니다.');
            campaign.skipped += campaign.queue.length;
            campaign.queue = [];
            campaign.status = 'cancelled';
            campaign.finishedAt = iso();
          });
          sendJson(response, 200, { message: '남은 발송을 취소했습니다.' });
          return;
        }
        throw new NewsletterError(404, '요청한 기능이 없습니다.');
      }

      if (!sameSite(request)) throw new NewsletterError(403, '이 사이트에서만 신청할 수 있습니다.');
      limit(`newsletter:${ip}`, 20, 10 * 60000);
      const input = await readBody(request);

      if (pathname === '/api/newsletter') {
        const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
        if (email.length > 254 || !EMAIL.test(email) || input.consent !== true) {
          throw new NewsletterError(400, '유효한 이메일과 개인정보 수집·이용 동의가 필요합니다.');
        }
        const pending = await updateStore(store => {
          let subscriber = store.subscribers.find(entry => entry.email === email);
          if (subscriber?.status === 'confirmed') return null;
          if (!subscriber) {
            if (store.subscribers.length >= 100000) throw new NewsletterError(503, '지금은 신청을 받을 수 없습니다.');
            subscriber = { id: randomUUID(), email, status: 'pending', consentVersion: '2026-10-06', requestedAt: iso(), unsubToken: newToken() };
            store.subscribers.push(subscriber);
          }
          subscriber.confirmToken = subscriber.confirmToken || newToken();
          return { ...subscriber };
        });
        if (pending && mailReady()) {
          try {
            limit(`newsletter-mail:${email}`, 3, 60 * 60000);
            await deliver(email, buildEmail({ kind: 'confirm', subscriber: pending }));
          } catch (error) {
            if (error instanceof NewsletterError) throw error;
            console.error('Newsletter confirmation mail failed:', error.code || error.name || 'error');
            throw new NewsletterError(503, '확인 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
          }
        }
        sendJson(response, 200, { message: mailReady()
          ? '확인 메일을 보냈습니다. 메일의 "구독 확인하기" 버튼을 눌러야 구독이 완료됩니다. (이미 구독 중이라면 추가 메일은 가지 않습니다.)'
          : '구독 신청이 접수되었습니다. 확인 메일 발송이 준비되면 구독 확인을 요청드립니다.' });
        return;
      }

      if (pathname === '/api/newsletter/confirm') {
        if (typeof input.token !== 'string' || !TOKEN.test(input.token)) throw new NewsletterError(400, '유효하지 않은 확인 링크입니다.');
        await updateStore(store => {
          const subscriber = store.subscribers.find(entry => entry.confirmToken === input.token);
          if (!subscriber) throw new NewsletterError(400, '유효하지 않거나 이미 사용한 확인 링크입니다. 이미 확인하셨다면 구독이 완료된 상태입니다.');
          subscriber.status = 'confirmed';
          subscriber.confirmedAt = iso();
          subscriber.consentAt = iso();
          delete subscriber.confirmToken;
        });
        sendJson(response, 200, { message: '구독이 확인되었습니다. 스페이스 레터를 보내드릴게요. 메일 하단의 수신거부로 언제든 해지할 수 있습니다.' });
        return;
      }

      if (pathname === '/api/newsletter/unsubscribe') {
        const byToken = typeof input.token === 'string' && TOKEN.test(input.token);
        const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
        if (!byToken && (email.length > 254 || !EMAIL.test(email))) throw new NewsletterError(400, '유효한 이메일을 입력해 주세요.');
        await updateStore(store => {
          const subscriber = store.subscribers.find(entry => byToken ? entry.unsubToken === input.token : entry.email === email);
          if (!subscriber) return;
          store.subscribers = store.subscribers.filter(entry => entry.id !== subscriber.id);
          const latest = [...store.campaigns].reverse().find(entry => entry.kind === 'newsletter' && entry.recipients.includes(subscriber.id));
          if (byToken && latest) latest.unsubscribes += 1;
        });
        sendJson(response, 200, { message: '해당 이메일의 구독이 있었다면 해지하고 즉시 삭제했습니다.' });
        return;
      }
      throw new NewsletterError(404, '요청한 기능이 없습니다.');
    } catch (error) {
      if (!(error instanceof NewsletterError)) console.error('Newsletter API failed:', error);
      if (!response.destroyed) {
        sendJson(response, error instanceof NewsletterError ? error.status : 500, {
          error: error instanceof NewsletterError ? error.message : '뉴스레터 처리 중 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
        });
      }
    }
  }

  handleNewsletterApi.processQueue = processQueue;
  return handleNewsletterApi;
}

module.exports = { createNewsletterApi, renderMarkup };
