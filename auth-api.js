const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');

const deriveKey = promisify(scrypt);
const passwordParameters = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const day = 24 * 60 * 60 * 1000;
const hash = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('hex');

class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sameToken(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function publicUser(user) {
  return { id: user.id, email: user.email, nickname: user.nickname, emailVerified: Boolean(user.emailVerifiedAt) };
}

function createAuthApi(dataDirectory, { siteUrl = 'https://withpluces.com', now = Date.now, mailer, storage, rateLimit, maxDerivations = 4,
  adminEmails = [], onAccountDeleted } = {}) {
  const admins = new Set(adminEmails.map(email => email.trim().toLowerCase()).filter(Boolean));
  const isAdmin = user => Boolean(user.emailVerifiedAt) && admins.has(user.email);
  const userView = user => ({ ...publicUser(user), admin: isAdmin(user) });
  const filePath = path.join(dataDirectory, 'auth.json');
  const allowedOrigin = new URL(siteUrl).origin;
  let writes = Promise.resolve();
  let activeDerivations = 0;
  const windows = new Map();
  const dummySalt = randomBytes(16).toString('hex');

  async function readStore() {
    try {
      const store = storage ? await storage.read() : JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (!Array.isArray(store.users) || !Array.isArray(store.sessions)) throw new Error('Invalid authentication store');
      if (store.mailTokens === undefined) store.mailTokens = [];
      if (!Array.isArray(store.mailTokens)) throw new Error('Invalid mail token store');
      return store;
    } catch (error) {
      if (error.code === 'ENOENT') return { users: [], sessions: [], mailTokens: [] };
      throw error;
    }
  }

  function updateStore(update) {
    const operation = writes.then(async () => {
      const store = await readStore();
      store.sessions = store.sessions.filter(session => session.expiresAt > now());
      store.mailTokens = store.mailTokens.filter(entry => entry.expiresAt > now());
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
      if (!(error instanceof AuthError)) console.error('Authentication storage write failed:', error);
    });
    return operation;
  }

  function limit(key, max, duration) {
    if (rateLimit) {
      if (!rateLimit(key, max, duration, now())) throw new AuthError(429, '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    const timestamp = now();
    for (const [entry, window] of windows) {
      if (window.until <= timestamp) windows.delete(entry);
    }
    if (!windows.has(key) && windows.size >= 10000) throw new AuthError(429, '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
    const window = windows.get(key) || { count: 0, until: timestamp + duration };
    window.count += 1;
    windows.set(key, window);
    if (window.count > max) throw new AuthError(429, '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
  }

  async function passwordKey(password, salt) {
    if (activeDerivations >= maxDerivations) throw new AuthError(503, '로그인 요청이 많습니다. 잠시 후 다시 시도해 주세요.');
    activeDerivations += 1;
    try {
      return await deriveKey(password, salt, 64, passwordParameters);
    } finally {
      activeDerivations -= 1;
    }
  }

  function context(request) {
    const isLoopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress);
    const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(request.headers.host || '');
    const local = isLoopback && localHost;
    const origin = request.headers.origin;
    const validOrigin = origin === allowedOrigin || (local && origin === `http://${request.headers.host}`);
    const name = local ? 'space_session' : '__Host-space_session';
    const cookies = (request.headers.cookie || '').split(';').map(cookie => cookie.trim());
    const cookie = cookies.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
    return { local, validOrigin, name, sessionHash: cookie && /^[a-f0-9]{64}$/.test(cookie) ? hash(cookie) : null };
  }

  function setCookie(response, ctx, value, remember = false, clear = false) {
    const expiry = clear ? '; Max-Age=0' : remember ? '; Max-Age=2592000' : '';
    response.setHeader('Set-Cookie', `${ctx.name}=${value}; Path=/; HttpOnly; SameSite=Lax${ctx.local ? '' : '; Secure'}${expiry}`);
  }

  function send(response, status, body) {
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(JSON.stringify(body));
  }

  async function body(request) {
    if (!request.headers['content-type']?.startsWith('application/json')) throw new AuthError(415, 'JSON 형식으로 요청해 주세요.');
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 4096) throw new AuthError(413, '요청 내용이 너무 큽니다.');
      chunks.push(chunk);
    }
    try {
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid body');
      return result;
    } catch {
      throw new AuthError(400, '올바른 요청 내용을 입력해 주세요.');
    }
  }

  function newSession(userId, remember) {
    const value = token();
    return {
      value,
      session: {
        tokenHash: hash(value), csrfToken: token(), userId,
        expiresAt: now() + (userId ? remember ? 30 * day : day / 2 : 60 * 60 * 1000),
      },
    };
  }

  function replaceSession(store, oldHash, session) {
    store.sessions = store.sessions.filter(entry => entry.tokenHash !== oldHash);
    if (store.sessions.length >= 10000) throw new AuthError(503, '접속자가 많습니다. 잠시 후 다시 시도해 주세요.');
    store.sessions.push(session);
  }

  function requireMailer() {
    if (!mailer?.configured) throw new AuthError(503, '메일 발송 설정이 아직 완료되지 않았습니다. 잠시 후 다시 시도하거나 운영자에게 문의해 주세요.');
  }

  async function issueMail(user, purpose) {
    requireMailer();
    const value = token();
    const tokenHash = hash(value);
    const lifetime = purpose === 'verify' ? day : 30 * 60000;
    await updateStore(current => {
      if (purpose === 'reset' && current.users.find(entry => entry.id === user.id)?.password.hash !== user.password.hash) {
        throw new AuthError(409, '계정 정보가 변경되었습니다. 새 재설정 메일을 요청해 주세요.');
      }
      current.mailTokens.push({ tokenHash, purpose, userId: user.id,
        ...(purpose === 'reset' ? { passwordHash: user.password.hash } : {}), expiresAt: now() + lifetime });
    });
    const url = new URL('/community.html', allowedOrigin);
    url.hash = `${purpose === 'verify' ? 'verify' : 'reset'}=${value}`;
    try {
      await mailer.send({
        to: user.email,
        subject: purpose === 'verify' ? '[스페이스] 이메일 주소 인증' : '[스페이스] 비밀번호 재설정',
        text: `${purpose === 'verify' ? '이메일 주소를 인증하려면' : '비밀번호를 재설정하려면'} 다음 링크를 열어 주세요.\n\n${url.href}\n\n${purpose === 'verify' ? '24시간' : '30분'} 동안 한 번만 사용할 수 있습니다. 요청하지 않으셨다면 이 메일을 무시하세요.\n비밀번호나 인증 링크를 다른 사람에게 알려주지 마세요.`,
      });
    } catch (error) {
      console.error('Account mail delivery failed:', error.code || error.name || 'SMTP error');
      await updateStore(current => {
        current.mailTokens = current.mailTokens.filter(entry => entry.tokenHash !== tokenHash);
      });
      throw new AuthError(503, '메일 발송 서버에서 요청을 처리하지 못했습니다. 잠시 후 다시 시도하거나 운영자에게 문의해 주세요.');
    }
  }

  function findMailToken(store, value, purpose) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
      throw new AuthError(400, '유효하지 않거나 만료된 링크입니다. 새 메일을 요청해 주세요.');
    }
    const entry = store.mailTokens.find(item => item.tokenHash === hash(value) && item.purpose === purpose && item.expiresAt > now());
    const user = entry && store.users.find(item => item.id === entry.userId);
    if (!entry || !user || (purpose === 'reset' && entry.passwordHash !== user.password.hash)) {
      throw new AuthError(400, '유효하지 않거나 만료된 링크입니다. 새 메일을 요청해 주세요.');
    }
    return { entry, user };
  }

  async function authenticate(request, { csrf = false } = {}) {
    const ctx = context(request);
    if (csrf && !ctx.validOrigin) return { error: { status: 403, message: '이 사이트에서만 요청할 수 있습니다.' } };
    const store = await readStore();
    const session = ctx.sessionHash && store.sessions.find(entry => entry.tokenHash === ctx.sessionHash && entry.expiresAt > now());
    if (csrf && (!session || !sameToken(request.headers['x-csrf-token'], session.csrfToken))) {
      return { error: { status: 403, message: '세션이 만료되었거나 요청을 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요.' } };
    }
    const user = session?.userId ? store.users.find(entry => entry.id === session.userId) : null;
    return { user: user ? userView(user) : null };
  }

  async function handleAuthApi(request, response, pathname) {
    try {
      const ctx = context(request);
      const ip = request.socket.remoteAddress;
      limit(`requests:${ip}`, 120, 60000);
      if (request.headers.origin && !ctx.validOrigin) throw new AuthError(403, '이 사이트에서만 요청할 수 있습니다.');
      const isSession = pathname === '/api/auth/session';
      const isAction = ['/api/auth/register', '/api/auth/login', '/api/auth/logout',
        '/api/auth/verify/request', '/api/auth/verify/confirm', '/api/auth/password/request', '/api/auth/password/reset',
        '/api/auth/account/delete'].includes(pathname);
      if (!isSession && !isAction) throw new AuthError(404, '요청한 기능이 없습니다.');
      if ((isSession && request.method !== 'GET') || (isAction && request.method !== 'POST')) {
        response.setHeader('Allow', isSession ? 'GET' : 'POST');
        throw new AuthError(405, '지원하지 않는 요청 방식입니다.');
      }
      const store = await readStore();
      let session = store.sessions.find(entry => entry.tokenHash === ctx.sessionHash && entry.expiresAt > now());
      if (isSession) {
        const user = session?.userId ? store.users.find(entry => entry.id === session.userId) : null;
        if (!session || (session.userId && !user)) {
          const created = newSession(null, false);
          await updateStore(current => replaceSession(current, ctx.sessionHash, created.session));
          session = created.session;
          setCookie(response, ctx, created.value);
        }
        send(response, 200, { user: user ? userView(user) : null, csrfToken: session.csrfToken, expiresAt: session.expiresAt, mailConfigured: Boolean(mailer?.configured) });
        return;
      }
      if (!ctx.validOrigin) throw new AuthError(403, '요청 출처를 확인할 수 없습니다.');
      if (!session || !sameToken(request.headers['x-csrf-token'], session.csrfToken)) {
        throw new AuthError(403, '세션이 만료되었거나 요청을 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요.');
      }
      if (pathname === '/api/auth/logout') {
        await updateStore(current => {
          current.sessions = current.sessions.filter(entry => entry.tokenHash !== ctx.sessionHash);
        });
        setCookie(response, ctx, '', false, true);
        send(response, 200, { user: null, message: '로그아웃되었습니다.' });
        return;
      }
      const input = await body(request);
      if (pathname === '/api/auth/account/delete') {
        const user = session.userId ? store.users.find(entry => entry.id === session.userId) : null;
        if (!user) throw new AuthError(401, '로그인 후 탈퇴할 수 있습니다.');
        const password = typeof input.password === 'string' ? input.password : '';
        if (password.length < 5 || password.length > 128) throw new AuthError(400, '현재 비밀번호를 입력해 주세요.');
        limit(`credentials:${ip}`, 10, 15 * 60000);
        limit(`account:${hash(user.email)}`, 8, 15 * 60000);
        const key = await passwordKey(password, user.password.salt);
        if (!timingSafeEqual(key, Buffer.from(user.password.hash, 'hex'))) throw new AuthError(401, '비밀번호가 올바르지 않습니다.');
        await updateStore(current => {
          const target = current.users.find(entry => entry.id === user.id);
          if (!target || target.password.hash !== user.password.hash) {
            throw new AuthError(409, '계정 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.');
          }
          current.users = current.users.filter(entry => entry.id !== user.id);
          current.sessions = current.sessions.filter(entry => entry.userId !== user.id && entry.tokenHash !== ctx.sessionHash);
          current.mailTokens = current.mailTokens.filter(entry => entry.userId !== user.id);
        });
        if (onAccountDeleted) {
          try {
            await onAccountDeleted(user.id);
          } catch (error) {
            console.error('Account content anonymization failed:', error);
          }
        }
        setCookie(response, ctx, '', false, true);
        send(response, 200, { user: null, message: '회원 탈퇴가 완료되어 계정과 개인정보를 삭제했습니다.' });
        return;
      }
      if (pathname.startsWith('/api/auth/verify/') || pathname.startsWith('/api/auth/password/')) {
        limit(`mail-actions:${ip}`, 20, 15 * 60000);
        if (pathname === '/api/auth/verify/request') {
          const user = store.users.find(entry => entry.id === session.userId);
          if (!user) throw new AuthError(401, '로그인 후 인증 메일을 요청해 주세요.');
          if (user.emailVerifiedAt) {
            send(response, 200, { message: '이미 인증된 이메일입니다.' });
            return;
          }
          requireMailer();
          limit(`verify:${user.id}`, 3, 15 * 60000);
          await issueMail(user, 'verify');
          send(response, 200, { message: '인증 메일을 발송했습니다. 받은편지함과 스팸함을 확인해 주세요.' });
          return;
        }
        if (pathname === '/api/auth/password/request') {
          const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
          if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError(400, '유효한 이메일을 입력해 주세요.');
          requireMailer();
          limit(`reset:${hash(email)}`, 3, 15 * 60000);
          try {
            await mailer.verify();
          } catch (error) {
            console.error('SMTP readiness failed:', error.code || error.name);
            throw new AuthError(503, '메일 서버에 연결할 수 없습니다. 잠시 후 다시 시도하거나 운영자에게 문의해 주세요.');
          }
          const user = store.users.find(entry => entry.email === email);
          if (user) await issueMail(user, 'reset');
          send(response, 200, { message: '가입된 이메일이라면 비밀번호 재설정 메일을 발송했습니다. 받은편지함과 스팸함을 확인해 주세요.' });
          return;
        }
        if (pathname === '/api/auth/verify/confirm') {
          await updateStore(current => {
            const { user } = findMailToken(current, input.token, 'verify');
            user.emailVerifiedAt = new Date(now()).toISOString();
            current.mailTokens = current.mailTokens.filter(entry => !(entry.userId === user.id && entry.purpose === 'verify'));
          });
          send(response, 200, { message: '이메일 인증이 완료되었습니다.' });
          return;
        }
        const password = typeof input.password === 'string' ? input.password : '';
        if (password.length < 5 || password.length > 128) throw new AuthError(400, '비밀번호는 5~128자로 입력해 주세요.');
        findMailToken(store, input.token, 'reset');
        const salt = randomBytes(16).toString('hex');
        const key = await passwordKey(password, salt);
        await updateStore(current => {
          const { user } = findMailToken(current, input.token, 'reset');
          user.password = { algorithm: 'scrypt', N: passwordParameters.N, r: passwordParameters.r, p: passwordParameters.p, salt, hash: key.toString('hex') };
          current.sessions = current.sessions.filter(entry => entry.userId !== user.id);
          current.mailTokens = current.mailTokens.filter(entry => !(entry.userId === user.id && entry.purpose === 'reset'));
        });
        setCookie(response, ctx, '', false, true);
        send(response, 200, { message: '비밀번호를 변경하고 모든 기기의 기존 로그인을 해제했습니다. 새 비밀번호로 로그인해 주세요.' });
        return;
      }
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
      const password = typeof input.password === 'string' ? input.password : '';
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 5 || password.length > 128 ||
          (input.remember !== undefined && typeof input.remember !== 'boolean')) {
        throw new AuthError(400, '유효한 이메일과 5~128자 비밀번호를 입력해 주세요.');
      }
      limit(`credentials:${ip}`, 10, 15 * 60000);
      limit(`account:${hash(email)}`, 8, 15 * 60000);
      const remember = input.remember === true;
      let user;
      if (pathname === '/api/auth/register') {
        const nickname = typeof input.nickname === 'string' ? input.nickname.trim() : '';
        if (nickname.length < 2 || nickname.length > 25 || input.terms !== true || input.privacy !== true) {
          throw new AuthError(400, '닉네임 2~25자와 필수 동의 항목을 확인해 주세요.');
        }
        const salt = randomBytes(16).toString('hex');
        const key = await passwordKey(password, salt);
        user = {
          id: randomUUID(), email, nickname,
          password: { algorithm: 'scrypt', N: passwordParameters.N, r: passwordParameters.r, p: passwordParameters.p, salt, hash: key.toString('hex') },
          consentVersion: '2026-10-05', createdAt: new Date(now()).toISOString(),
        };
      } else {
        user = store.users.find(entry => entry.email === email);
        const key = await passwordKey(password, user?.password.salt || dummySalt);
        if (!user || !timingSafeEqual(key, Buffer.from(user.password.hash, 'hex'))) {
          throw new AuthError(401, '이메일 또는 비밀번호가 올바르지 않습니다.');
        }
      }
      const created = newSession(user.id, remember);
      await updateStore(current => {
        const activeSession = current.sessions.find(entry => entry.tokenHash === ctx.sessionHash);
        if (!activeSession || !sameToken(activeSession.csrfToken, session.csrfToken)) {
          throw new AuthError(403, '세션이 변경되었습니다. 새로고침 후 다시 시도해 주세요.');
        }
        if (pathname === '/api/auth/register') {
          if (current.users.some(entry => entry.email === email)) throw new AuthError(409, '가입할 수 없는 이메일입니다. 기존 계정으로 로그인해 주세요.');
          current.users.push(user);
        } else if (current.users.find(entry => entry.id === user.id)?.password.hash !== user.password.hash) {
          throw new AuthError(401, '비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.');
        }
        replaceSession(current, ctx.sessionHash, created.session);
      });
      setCookie(response, ctx, created.value, remember);
      let verificationError;
      if (pathname === '/api/auth/register') {
        try {
          await issueMail(user, 'verify');
        } catch (error) {
          if (!(error instanceof AuthError)) throw error;
          verificationError = error.message;
        }
      }
      send(response, pathname === '/api/auth/register' ? 201 : 200, {
        user: userView(user), csrfToken: created.session.csrfToken, expiresAt: created.session.expiresAt,
        message: pathname === '/api/auth/register' ? '회원가입과 로그인이 완료되었습니다.' : '로그인되었습니다.',
        mailConfigured: Boolean(mailer?.configured), verificationError,
      });
    } catch (error) {
      if (!(error instanceof AuthError)) console.error('Authentication API failed:', error);
      if (!response.destroyed) send(response, error instanceof AuthError ? error.status : 500, {
        error: error instanceof AuthError ? error.message : '계정 처리 중 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      });
    }
  }
  handleAuthApi.authenticate = authenticate;
  // 게시판 알림용: 이메일 인증을 마친 회원의 주소만 돌려준다.
  handleAuthApi.emailOf = async userId => {
    const user = (await readStore()).users.find(entry => entry.id === userId);
    return user?.emailVerifiedAt ? user.email : null;
  };
  return handleAuthApi;
}

module.exports = { createAuthApi };
