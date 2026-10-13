const next = require('next');
const { createServer } = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const { createCommunityApi } = require('./community-api');
const { createAuthApi } = require('./auth-api');
const { createMailer } = require('./mailer');
const { createBoardApi } = require('./board-api');
const { createNewsletterApi } = require('./newsletter-api');
const { createPortalApi } = require('./portal-api');

require('@next/env').loadEnvConfig(__dirname, process.env.NODE_ENV !== 'production');

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = Number(process.env.PORT) || 3000;
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
const publicIndexPath = path.join(__dirname, 'public', 'index.html');
const originalHomePath = path.join(__dirname, 'public', 'article.html');
const originalFaviconPath = path.join(__dirname, 'public', 'favicon.svg');
const siteUrl = new URL(process.env.SITE_URL || 'https://withpluces.com').origin;
const dataDirectory = process.env.DATA_DIR || path.join(__dirname, 'data');
const mailer = createMailer();
if (!mailer.configured) console.warn('SMTP not configured: email verification and password recovery cannot send mail.');
const adminEmails = (process.env.ADMIN_EMAILS || '').split(',');
const authApi = createAuthApi(dataDirectory, {
  siteUrl, mailer, adminEmails,
  onAccountDeleted: userId => Promise.all([boardApi.anonymizeUser(userId), communityApi.anonymizeUser(userId)]),
});
const communityApi = createCommunityApi(dataDirectory, { authenticate: authApi.authenticate, requireVerifiedEmail: mailer.configured });
// 게시글 사진은 data/board-images 폴더에 파일로 보관한다.
const boardImageDirectory = path.join(dataDirectory, 'board-images');
const boardImages = {
  async put(image) {
    await fs.promises.mkdir(boardImageDirectory, { recursive: true, mode: 0o700 });
    await fs.promises.writeFile(path.join(boardImageDirectory, image.id), image.data, { mode: 0o600 });
    await fs.promises.writeFile(path.join(boardImageDirectory, `${image.id}.json`), JSON.stringify({ ...image, data: undefined }), { mode: 0o600 });
  },
  async get(id) {
    try {
      const meta = JSON.parse(await fs.promises.readFile(path.join(boardImageDirectory, `${id}.json`), 'utf8'));
      return { ...meta, data: await fs.promises.readFile(path.join(boardImageDirectory, id)) };
    } catch { return null; }
  },
  async attach(ids, postId) {
    for (const id of ids) {
      const image = await this.get(id);
      if (image) await fs.promises.writeFile(path.join(boardImageDirectory, `${id}.json`), JSON.stringify({ ...image, data: undefined, postId }), { mode: 0o600 });
    }
  },
  async remove(ids) { for (const id of ids) for (const name of [id, `${id}.json`]) await fs.promises.rm(path.join(boardImageDirectory, name), { force: true }); },
  async purgeUnattached(before) {
    let names = [];
    try { names = await fs.promises.readdir(boardImageDirectory); } catch { return; }
    for (const name of names.filter(entry => entry.endsWith('.json'))) {
      const meta = JSON.parse(await fs.promises.readFile(path.join(boardImageDirectory, name), 'utf8'));
      if (!meta.postId && meta.createdAt < before) await this.remove([meta.id]);
    }
  },
};
const boardApi = createBoardApi(dataDirectory, {
  authenticate: authApi.authenticate, requireVerifiedEmail: mailer.configured, images: boardImages, siteUrl,
  notify: async (userId, { subject, text }) => {
    const to = mailer.configured ? await authApi.emailOf(userId) : null;
    if (to) await mailer.send({ to, subject, text });
  },
});
let newsletterTimer;
const newsletterApi = createNewsletterApi(dataDirectory, {
  authenticate: authApi.authenticate, mailer, siteUrl,
  dailyLimit: Number(process.env.NEWSLETTER_DAILY_LIMIT) || 300,
  legacySubscribers: () => communityApi.legacySubscribers(),
  clearLegacySubscribers: () => communityApi.clearLegacySubscribers(),
  schedule: delay => scheduleNewsletter(delay),
  senderName: process.env.NEWSLETTER_SENDER || '(주)위드플러시아', contactEmail: process.env.CONTACT_EMAIL || '',
  adminEmails, ecosKey: process.env.ECOS_API_KEY || '', rebKey: process.env.REB_API_KEY || '', policyKey: process.env.POLICY_NEWS_KEY || '', highlights: since => boardApi.highlights(since),
});
let chatOnline = 0;
const portalApi = createPortalApi({ ecosKey: process.env.ECOS_API_KEY || '', rebKey: process.env.REB_API_KEY || '', molitKey: process.env.MOLIT_API_KEY || '', policyKey: process.env.POLICY_NEWS_KEY || '', benefitKey: process.env.GOV_BENEFIT_KEY || process.env.POLICY_NEWS_KEY || '', benefitUrl: process.env.GOV_BENEFIT_URL || '', weatherKey: process.env.WEATHER_API_KEY || process.env.POLICY_NEWS_KEY || '', pensionKey: process.env.PENSION_API_KEY || process.env.POLICY_NEWS_KEY || '', pensionUploadToken: process.env.PENSION_UPLOAD_TOKEN || '', pensionKeys: { recipt: process.env.PENSION_RECIPT_KEY || '', sbscrb: process.env.PENSION_SBSCRB_KEY || '' }, pensionUrls: { recipt: process.env.PENSION_RECIPT_URL || '', sbscrb: process.env.PENSION_SBSCRB_URL || '' }, farmKeys: { kamisKey: process.env.KAMIS_CERT_KEY || '', kamisId: process.env.KAMIS_CERT_ID || '', nongsaroKey: process.env.NONGSARO_API_KEY || '' }, molitKeys: { apt: process.env.MOLIT_APT_KEY || '', nrg: process.env.MOLIT_BLDG_KEY || '', land: process.env.MOLIT_LAND_KEY || '' }, onlineCount: async () => chatOnline });
let lastWeeklyDraft = '';
setInterval(() => {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const key = kst.toISOString().slice(0, 10);
  if (kst.getUTCDay() === 0 && kst.getUTCHours() === 18 && lastWeeklyDraft !== key) {
    lastWeeklyDraft = key;
    newsletterApi.generateWeekly({ source: 'auto' }).catch(error => console.error('Weekly newsletter draft failed:', error));
  }
}, 10 * 60 * 1000);
function scheduleNewsletter(delay) {
  clearTimeout(newsletterTimer);
  newsletterTimer = setTimeout(async () => {
    try {
      const result = await newsletterApi.processQueue();
      if (result.more) scheduleNewsletter(result.delay || 60000);
    } catch (error) {
      console.error('Newsletter queue failed:', error);
      scheduleNewsletter(60000);
    }
  }, delay);
}
scheduleNewsletter(5000);

app.prepare().then(() => {
  const httpServer = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/auth/')) {
      authApi(request, response, pathname);
      return;
    }
    if (pathname === '/api/board' || pathname.startsWith('/api/board/')) {
      boardApi(request, response, pathname);
      return;
    }
    if (pathname.startsWith('/api/newsletter') || pathname.startsWith('/api/admin/newsletter') || pathname.startsWith('/n/')) {
      newsletterApi(request, response, pathname);
      return;
    }
    if (['/newsletter', '/newsletter-admin'].includes(pathname)) {
      fs.readFile(path.join(__dirname, 'public', `${pathname.slice(1)}.html`), (error, html) => {
        if (error) {
          response.statusCode = 500;
          response.end('Internal Server Error');
          return;
        }
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(html);
      });
      return;
    }
    if (pathname === '/api/portal' || pathname.startsWith('/api/portal/')) {
      portalApi(request, response, pathname);
      return;
    }
    if (pathname === '/api/comments') {
      communityApi(request, response, pathname);
      return;
    }
    const isHome = pathname === '/' || pathname === '/index.html';

    const isArticle = pathname === '/article.html';

    if (isHome || pathname === '/community.html' || isArticle) {
      const filePath = isArticle ? originalHomePath : publicIndexPath;
      fs.readFile(filePath, 'utf8', (error, html) => {
        if (error) {
          console.error('HTML read failed:', filePath, error);
          response.statusCode = 500;
          response.end('Internal Server Error');
          return;
        }

        if (isArticle) {
          html = html.replace('</head>', '<link rel="stylesheet" href="/home-navigation.css"><script defer src="/home-navigation.js"></script></head>');
          html = html.replaceAll('https://space-editorial.com/articles/2025-frontend-architecture-design-system', `${siteUrl}/article.html`);
          html = html.replaceAll('https://space-editorial.com', siteUrl);
        } else {
          html = html.replaceAll('https://withpluces.com/', `${siteUrl}/`);
        }
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        response.setHeader('Cache-Control', 'no-store');
        response.end(html);
      });
      return;
    }

    if (pathname === '/privacy') {
      fs.readFile(path.join(__dirname, 'public', 'privacy.html'), (error, html) => {
        if (error) {
          response.statusCode = 500;
          response.end('Internal Server Error');
          return;
        }
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(html);
      });
      return;
    }

    if (pathname === '/favicon.svg') {
      fs.readFile(originalFaviconPath, (error, icon) => {
        if (error) {
          console.error('Favicon read failed:', error);
          response.statusCode = 500;
          response.end('Internal Server Error');
          return;
        }
        response.setHeader('Content-Type', 'image/svg+xml');
        response.end(icon);
      });
      return;
    }

    handle(request, response);
  });

  const io = new Server(httpServer);

  io.on('connection', (socket) => {
    console.log('사용자 접속');
    chatOnline = io.engine.clientsCount;

    socket.on('chat message', (message) => {
      if (typeof message === 'string' && message.trim()) {
        io.emit('chat message', message.trim());
      }
    });

    socket.on('disconnect', () => {
      console.log('사용자 연결 종료');
      chatOnline = io.engine.clientsCount;
    });
  });

  httpServer
    .once('error', (error) => {
      console.error(error);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`Next.js 서버 실행: http://${hostname}:${port}`);
    });
});