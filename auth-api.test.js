const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer, request: httpRequest } = require('node:http');
const { createHash } = require('node:crypto');
const { createAuthApi } = require('./auth-api');

const credentials = {
  email: 'reader@example.com', nickname: '가'.repeat(25),
  password: 'TestOnlyPassword123!', terms: true, privacy: true, remember: true,
};

async function fixture(t, { useMailer = false, adminEmails = [] } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'space-auth-test-'));
  let timestamp = Date.now();
  const messages = [];
  const mailer = {
    configured: true,
    fail: false,
    async verify() { if (this.fail) throw new Error('Test SMTP unavailable'); },
    async send(message) { if (this.fail) throw new Error('Test SMTP unavailable'); messages.push(message); },
  };
  const options = { now: () => timestamp, adminEmails, ...(useMailer ? { mailer } : {}) };
  let handler = createAuthApi(directory, options);
  const server = createServer((request, response) => handler(request, response, request.url));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  function client() {
    return {
      cookie: '', csrf: '',
      async request(action, input, override = {}) {
        const headers = { Cookie: this.cookie, Origin: origin, ...override };
        if (input !== undefined) {
          headers['Content-Type'] = 'application/json';
          headers['X-CSRF-Token'] = override['X-CSRF-Token'] ?? this.csrf;
        }
        const { response, data } = await new Promise((resolve, reject) => {
          const request = httpRequest(`${origin}/api/auth/${action}`, {
            method: input === undefined ? 'GET' : 'POST', headers,
          }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => {
              try {
                resolve({
                  response: { status: response.statusCode, headers: new Headers(response.headers) },
                  data: JSON.parse(Buffer.concat(chunks).toString('utf8')),
                });
              } catch (error) { reject(error); }
            });
            response.on('error', reject);
          });
          request.on('error', reject);
          request.end(input === undefined ? undefined : JSON.stringify(input));
        });
        const cookie = response.headers.get('set-cookie');
        if (cookie) this.cookie = cookie.split(';')[0];
        if (data.csrfToken) this.csrf = data.csrfToken;
        return { response, data, cookie };
      },
    };
  }
  return {
    directory, client, messages, mailer,
    advance(milliseconds) { timestamp += milliseconds; },
    restart() { handler = createAuthApi(directory, options); },
    readStore() { return fs.readFile(path.join(directory, 'auth.json'), 'utf8').then(JSON.parse); },
  };
}

test('registration hashes passwords, rotates sessions, persists login and revokes logout', async t => {
  const f = await fixture(t);
  const browser = f.client();
  const guest = await browser.request('session');
  assert.equal(guest.data.user, null);
  assert.ok(guest.cookie.includes('HttpOnly'));
  assert.ok(guest.cookie.includes('SameSite=Lax'));
  const oldCookie = browser.cookie;
  const registered = await browser.request('register', credentials);
  assert.equal(registered.response.status, 201);
  assert.equal(registered.data.user.nickname.length, 25);
  assert.equal(registered.data.user.emailVerified, false);
  assert.equal(registered.data.user.password, undefined);
  assert.ok(registered.cookie.includes('Max-Age=2592000'));
  assert.notEqual(browser.cookie, oldCookie);
  const savedCookie = browser.cookie;
  const savedCsrf = browser.csrf;
  const store = await f.readStore();
  assert.equal(store.users.length, 1);
  assert.equal(store.users[0].password.algorithm, 'scrypt');
  assert.equal(store.users[0].password.N, 32768);
  assert.equal(store.users[0].password.p, 3);
  assert.equal(store.users[0].password.hash.length, 128);
  assert.ok(!JSON.stringify(store).includes(credentials.password));
  assert.ok(!JSON.stringify(store).includes(savedCookie.split('=')[1]));
  const replay = f.client();
  replay.cookie = oldCookie;
  assert.equal((await replay.request('session')).data.user, null);
  f.restart();
  assert.equal((await browser.request('session')).data.user.email, credentials.email);
  assert.equal((await browser.request('logout', {})).response.status, 200);
  assert.ok((await f.readStore()).sessions.every(session =>
    session.tokenHash !== createHash('sha256').update(savedCookie.split('=')[1]).digest('hex')));
  const stolen = f.client();
  stolen.cookie = savedCookie;
  stolen.csrf = savedCsrf;
  assert.equal((await stolen.request('logout', {})).response.status, 403);
  assert.equal((await stolen.request('session')).data.user, null);
  await browser.request('session');
  assert.equal((await browser.request('login', { ...credentials, password: 'WrongPassword123!' })).response.status, 401);
  const loggedIn = await browser.request('login', { ...credentials, email: 'READER@EXAMPLE.COM', remember: false });
  assert.equal(loggedIn.response.status, 200);
  assert.ok(!loggedIn.cookie.includes('Max-Age='));
  f.advance(12 * 60 * 60 * 1000 + 1);
  assert.equal((await browser.request('session')).data.user, null);
});

test('remembered login expires after exactly 30 days and unverified users are not treated as verified', async t => {
  const f = await fixture(t);
  const browser = f.client();
  await browser.request('session');
  await browser.request('register', credentials);
  f.advance(30 * 24 * 60 * 60 * 1000 - 1);
  assert.equal((await browser.request('session')).data.user.emailVerified, false);
  f.advance(2);
  assert.equal((await browser.request('session')).data.user, null);
});

test('validation, duplicate registration, CSRF and origin protections are enforced', async t => {
  const f = await fixture(t);
  const browser = f.client();
  await browser.request('session');
  assert.equal((await browser.request('register', credentials, { 'X-CSRF-Token': '' })).response.status, 403);
  assert.equal((await browser.request('register', credentials, { 'X-CSRF-Token': 'é'.repeat(64) })).response.status, 403);
  assert.equal((await browser.request('register', credentials, { Origin: 'https://evil.example' })).response.status, 403);
  assert.equal((await browser.request('register', credentials, { Origin: '' })).response.status, 403);
  assert.equal((await browser.request('register', { ...credentials, nickname: '나'.repeat(26) })).response.status, 400);
  assert.equal((await browser.request('register', { ...credentials, privacy: false })).response.status, 400);
  assert.equal((await browser.request('register', { ...credentials, password: '1234' })).response.status, 400, 'under 5 characters');
  assert.equal((await browser.request('register', credentials)).response.status, 201);
  const digits = f.client();
  await digits.request('session');
  assert.equal((await digits.request('register', { ...credentials, email: 'five@example.com', password: '12345' })).response.status, 201, '5-digit passwords are allowed');
  const other = f.client();
  await other.request('session');
  assert.equal((await other.request('register', credentials)).response.status, 409);
  assert.equal((await f.readStore()).users.length, 2);
  const otherLogin = await other.request('login', { ...credentials, password: 'WrongPassword123!' });
  const missingLogin = await other.request('login', { ...credentials, email: 'absent@example.com' });
  assert.equal(otherLogin.response.status, missingLogin.response.status);
  assert.equal(otherLogin.data.error, missingLogin.data.error);
});

test('remote domain cookie is Secure and login throttling blocks repeated guessing', async t => {
  const f = await fixture(t);
  const remote = f.client();
  const response = await remote.request('session', undefined, { Host: 'withpluces.com', Origin: 'https://withpluces.com' });
  assert.ok(response.cookie.startsWith('__Host-space_session='));
  assert.ok(response.cookie.includes('; Secure'));
  assert.ok(response.cookie.includes('; Path=/'));
  assert.equal(response.response.headers.get('cache-control'), 'no-store');
  const browser = f.client();
  await browser.request('session');
  for (let attempt = 0; attempt < 8; attempt += 1) {
    assert.equal((await browser.request('login', credentials)).response.status, 401);
  }
  assert.equal((await browser.request('login', credentials)).response.status, 429);
  f.advance(15 * 60 * 1000 + 1);
  assert.equal((await browser.request('login', credentials)).response.status, 401);
});

test('concurrent registrations cannot duplicate an email', async t => {
  const f = await fixture(t);
  const first = f.client();
  const second = f.client();
  await first.request('session');
  await second.request('session');
  const results = await Promise.all([
    first.request('register', credentials),
    second.request('register', credentials),
  ]);
  assert.deepEqual(results.map(result => result.response.status).sort(), [201, 409]);
  assert.equal((await f.readStore()).users.length, 1);
});

function mailToken(message, key) {
  const match = message.text.match(new RegExp(`#${key}=([a-f0-9]{64})`));
  assert.ok(match, `Expected ${key} link`);
  assert.ok(message.text.includes('https://withpluces.com/community.html#'));
  return match[1];
}

test('email verification is persisted, purpose-bound and one-time even for simultaneous clicks', async t => {
  const f = await fixture(t, { useMailer: true });
  const browser = f.client();
  await browser.request('session');
  const registered = await browser.request('register', credentials);
  assert.equal(registered.data.verificationError, undefined);
  assert.equal(f.messages.length, 1);
  const value = mailToken(f.messages[0], 'verify');
  assert.ok(!JSON.stringify(await f.readStore()).includes(value));
  f.restart();
  assert.equal((await browser.request('password/reset', { token: value, password: 'NewPassword123!' })).response.status, 400);
  const results = await Promise.all([
    browser.request('verify/confirm', { token: value }),
    browser.request('verify/confirm', { token: value }),
  ]);
  assert.deepEqual(results.map(result => result.response.status).sort(), [200, 400]);
  assert.equal((await browser.request('session')).data.user.emailVerified, true);
  assert.equal((await browser.request('verify/request', {})).data.message, '이미 인증된 이메일입니다.');
});

test('password reset revokes all sessions and all reset links, old password no longer logs in', async t => {
  const f = await fixture(t, { useMailer: true });
  const first = f.client();
  await first.request('session');
  await first.request('register', credentials);
  const second = f.client();
  await second.request('session');
  await second.request('login', credentials);
  const recover = f.client();
  await recover.request('session');
  const known = await recover.request('password/request', { email: credentials.email });
  const unknown = await recover.request('password/request', { email: 'absent@example.com' });
  assert.equal(known.response.status, 200);
  assert.deepEqual(known.data, unknown.data);
  assert.equal(f.messages.length, 2);
  const value = mailToken(f.messages[1], 'reset');
  assert.equal(known.data.token, undefined);
  assert.equal((await recover.request('verify/confirm', { token: value })).response.status, 400);
  f.restart();
  const password = 'UpdatedPassword123!';
  assert.equal((await recover.request('password/reset', { token: value, password: '1234' })).response.status, 400);
  const results = await Promise.all([
    recover.request('password/reset', { token: value, password }),
    recover.request('password/reset', { token: value, password }),
  ]);
  assert.deepEqual(results.map(result => result.response.status).sort(), [200, 400]);
  assert.equal((await first.request('session')).data.user, null);
  assert.equal((await second.request('session')).data.user, null);
  assert.equal((await first.request('login', credentials)).response.status, 401);
  assert.equal((await first.request('login', { ...credentials, password })).response.status, 200);
  assert.equal((await f.readStore()).mailTokens.filter(entry => entry.purpose === 'reset').length, 0);
});

test('verification expires at 24 hours, reset expires at 30 minutes, mail failures are explicit', async t => {
  const f = await fixture(t, { useMailer: true });
  const browser = f.client();
  await browser.request('session');
  await browser.request('register', credentials);
  const verify = mailToken(f.messages[0], 'verify');
  await browser.request('password/request', { email: credentials.email });
  const reset = mailToken(f.messages[1], 'reset');
  f.advance(30 * 60000);
  assert.equal((await browser.request('password/reset', { token: reset, password: 'NewPassword123!' })).response.status, 400);
  f.advance(24 * 60 * 60 * 1000 - 30 * 60000);
  assert.equal((await browser.request('verify/confirm', { token: verify })).response.status, 400);
  f.mailer.fail = true;
  const requestsBefore = (await f.readStore()).mailTokens.length;
  assert.equal((await browser.request('verify/request', {})).response.status, 503);
  assert.equal((await f.readStore()).mailTokens.length, 0);
  assert.ok(requestsBefore > 0);
  assert.equal((await browser.request('password/request', { email: credentials.email })).response.status, 503);
  assert.equal((await browser.request('password/request', { email: 'absent@example.com' })).response.status, 503);
});

test('missing SMTP never pretends that verification or recovery mail was sent', async t => {
  const f = await fixture(t);
  const browser = f.client();
  await browser.request('session');
  const registration = await browser.request('register', credentials);
  assert.equal(registration.response.status, 201);
  assert.ok(registration.data.verificationError.includes('메일 발송 설정'));
  assert.equal((await browser.request('verify/request', {})).response.status, 503);
  assert.equal((await browser.request('password/request', { email: credentials.email })).response.status, 503);
});

test('account deletion requires the current password and removes the user, sessions and mail links', async t => {
  const f = await fixture(t, { useMailer: true });
  const browser = f.client();
  await browser.request('session');
  await browser.request('register', credentials);
  const other = f.client();
  await other.request('session');
  await other.request('login', credentials);
  const guest = f.client();
  await guest.request('session');
  assert.equal((await guest.request('account/delete', { password: credentials.password })).response.status, 401);
  assert.equal((await browser.request('account/delete', { password: credentials.password }, { 'X-CSRF-Token': 'bad' })).response.status, 403);
  assert.equal((await browser.request('account/delete', { password: 'WrongPassword123!' })).response.status, 401);
  assert.equal((await browser.request('account/delete', { password: credentials.password }, { Origin: 'https://invalid.example' })).response.status, 403);
  assert.equal((await f.readStore()).users.length, 1);
  const deleted = await browser.request('account/delete', { password: credentials.password });
  assert.equal(deleted.response.status, 200);
  assert.ok(deleted.cookie.includes('Max-Age=0'));
  const store = await f.readStore();
  assert.equal(store.users.length, 0);
  assert.ok(!JSON.stringify(store).includes(credentials.email));
  assert.equal(store.mailTokens.length, 0);
  assert.equal((await other.request('session')).data.user, null);
  await browser.request('session');
  assert.equal((await browser.request('login', credentials)).response.status, 401);
  assert.equal((await browser.request('register', credentials)).response.status, 201);
});

test('authenticate exposes the signed-in user, admin flag and CSRF protection for other APIs', async t => {
  const f = await fixture(t);
  const browser = f.client();
  await browser.request('session');
  await browser.request('register', credentials);
  const { createAuthApi: create } = require('./auth-api');
  const api = create(f.directory, { adminEmails: [credentials.email] });
  const cookieValue = browser.cookie;
  const request = (headers = {}) => ({ headers: { host: 'example.com', cookie: cookieValue, ...headers }, socket: { remoteAddress: '203.0.113.5' } });
  // Local cookie name differs, so a remote-looking request without the remote cookie is a guest
  assert.equal((await api.authenticate(request())).user, null);
  const local = (headers = {}) => ({ headers: { host: '127.0.0.1', cookie: cookieValue, ...headers }, socket: { remoteAddress: '127.0.0.1' } });
  const result = await api.authenticate(local());
  assert.equal(result.user.email, credentials.email);
  assert.equal(result.user.admin, false, 'unverified email is never admin');
  assert.equal((await api.authenticate(local(), { csrf: true })).error.status, 403);
  assert.equal((await api.authenticate(local({ origin: 'http://127.0.0.1', 'x-csrf-token': browser.csrf }), { csrf: true })).user.email, credentials.email);
});

test('닉네임으로 가린 이메일 찾기, 운영자 재설정 링크(24시간)와 메일 발송 기록', async t => {
  const f = await fixture(t, { useMailer: true, adminEmails: ['admin@example.com'] });
  const admin = f.client();
  await admin.request('session');
  await admin.request('register', { ...credentials, email: 'admin@example.com', nickname: '운영자' });
  const verifyToken = new URL(f.messages.at(-1).text.match(/https?:\/\/\S+/)[0]).hash.split('=')[1];
  const confirmed = await admin.request('verify/confirm', { token: verifyToken });
  assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.data));
  const member = f.client();
  await member.request('session');
  await member.request('register', { ...credentials, email: 'mjin8722@naver.com', nickname: '민진' });

  // 닉네임 찾기: 가린 주소만
  const guest = f.client();
  await guest.request('session');
  const found = await guest.request('account/find', { nickname: ' 민진 ' });
  assert.equal(found.response.status, 200);
  assert.deepEqual(found.data.accounts, [{ email: 'mj*****@naver.com' }]);
  assert.equal((await guest.request('account/find', { nickname: '없는사람' })).data.accounts.length, 0);

  // 운영자 아닌 회원은 막힌다
  assert.equal((await member.request('admin/members', { q: '민진' })).response.status, 403);

  // 발송 실패 기록
  const realSend = f.mailer.send;
  f.mailer.send = async () => { throw Object.assign(new Error('suppressed'), { code: 'E_RECIPIENT_SUPPRESSED' }); };
  assert.equal((await guest.request('password/request', { email: 'mjin8722@naver.com' })).response.status, 503);
  f.mailer.send = realSend;
  const list = await admin.request('admin/members', { q: '민진' });
  assert.equal(list.response.status, 200, JSON.stringify(list.data));
  assert.equal(list.data.members.length, 1);
  assert.equal(list.data.members[0].email, 'mjin8722@naver.com');
  assert.equal(list.data.members[0].lastAuthMail.ok, false);
  assert.equal(list.data.members[0].lastAuthMail.purpose, 'reset');
  assert.equal(list.data.members[0].lastAuthMail.error, 'E_RECIPIENT_SUPPRESSED');

  // 운영자 링크: 24시간 유효, 인증도 함께
  const made = await admin.request('admin/reset-link', { userId: list.data.members[0].id, verify: true });
  assert.equal(made.response.status, 200);
  const resetToken = new URL(made.data.link).hash.split('=')[1];
  f.advance(23 * 60 * 60 * 1000);
  await guest.request('session');
  const reset = await guest.request('password/reset', { token: resetToken, password: 'new12' });
  assert.equal(reset.response.status, 200);
  await guest.request('session');
  const login = await guest.request('login', { email: 'mjin8722@naver.com', password: 'new12' });
  assert.equal(login.response.status, 200);
  assert.equal(login.data.user.emailVerified, true);
});
