const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function createCommunityApi(dataDirectory, { storage, rateLimit, authenticate, requireVerifiedEmail = false, onComment = () => {} } = {}) {
  const filePath = path.join(dataDirectory, 'community.json');
  let pendingWrite = Promise.resolve();
  const requestWindows = new Map();

  async function readStore() {
    try {
      return storage ? await storage.read() : JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return { comments: [], subscribers: [] };
      throw error;
    }
  }

  function updateStore(update) {
    const operation = pendingWrite.then(async () => {
      const store = await readStore();
      const result = update(store);
      if (storage) {
        await storage.write(store);
      } else {
        await fs.mkdir(dataDirectory, { recursive: true });
        const temporaryPath = `${filePath}.tmp`;
        await fs.writeFile(temporaryPath, JSON.stringify(store, null, 2), { mode: 0o600 });
        await fs.rename(temporaryPath, filePath);
      }
      return result;
    });
    pendingWrite = operation.catch(error => console.error('Community storage update failed:', error));
    return operation;
  }

  function sendJson(response, status, data) {
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(JSON.stringify(data));
  }

  async function readBody(request) {
    if (!request.headers['content-type']?.startsWith('application/json')) {
      throw new ApiError(415, 'JSON 형식으로 요청해 주세요.');
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 8192) throw new ApiError(413, '입력 내용이 너무 큽니다.');
      chunks.push(chunk);
    }
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
      return body;
    } catch {
      throw new ApiError(400, '올바른 요청 내용을 입력해 주세요.');
    }
  }

  async function handleCommunityApi(request, response, pathname) {
    try {
      if (pathname === '/api/comments' && request.method === 'GET') {
        const store = await readStore();
        sendJson(response, 200, { comments: store.comments.map(({ id, name, text, createdAt }) => ({ id, name, text, createdAt })) });
        return;
      }
      if (request.method !== 'POST') {
        response.setHeader('Allow', pathname === '/api/comments' ? 'GET, POST' : 'POST');
        throw new ApiError(405, '지원하지 않는 요청 방식입니다.');
      }
      if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}` &&
          request.headers.origin !== `https://${request.headers.host}`) {
        throw new ApiError(403, '이 사이트에서만 신청할 수 있습니다.');
      }
      const now = Date.now();
      for (const [key, window] of requestWindows) {
        if (now - window.started > 60000) requestWindows.delete(key);
      }
      const key = request.socket.remoteAddress;
      const window = requestWindows.get(key) || { started: now, count: 0 };
      window.count += 1;
      requestWindows.set(key, window);
      if (rateLimit ? !rateLimit(`community:${key}`, 30, 60000, now) : window.count > 30) {
        throw new ApiError(429, '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
      }
      const body = await readBody(request);
      if (pathname === '/api/comments') {
        let author = null;
        if (authenticate) {
          const auth = await authenticate(request, { csrf: true });
          if (auth.error) throw new ApiError(auth.error.status, auth.error.message);
          if (!auth.user) throw new ApiError(401, '로그인한 회원만 댓글을 쓸 수 있습니다.');
          if (requireVerifiedEmail && !auth.user.emailVerified) throw new ApiError(403, '이메일 인증을 완료한 회원만 댓글을 쓸 수 있습니다.');
          author = auth.user;
        }
        const name = author ? author.nickname : typeof body.name === 'string' ? body.name.trim() : '';
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!name || name.length > 40 || !text || text.length > 2000) {
          throw new ApiError(400, '닉네임 1~40자, 댓글 1~2,000자를 입력해 주세요.');
        }
        const comment = { id: randomUUID(), name, text, createdAt: new Date().toISOString(), ...(author ? { authorId: author.id } : {}) };
        await updateStore(store => {
          store.comments.unshift(comment);
        });
        try { onComment({ name, text }); } catch (error) { console.error('Comment notify failed:', error.message); }
        sendJson(response, 201, { comment: { id: comment.id, name, text, createdAt: comment.createdAt } });
      } else {
        throw new ApiError(404, '요청한 기능이 없습니다.');
      }
    } catch (error) {
      if (!(error instanceof ApiError)) console.error('Community API failed:', error);
      if (!response.destroyed) {
        sendJson(response, error instanceof ApiError ? error.status : 500, {
          error: error instanceof ApiError ? error.message : '서버 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.',
        });
      }
    }
  }
  handleCommunityApi.legacySubscribers = async () => (await readStore()).subscribers || [];
  handleCommunityApi.clearLegacySubscribers = () => updateStore(store => { store.subscribers = []; });
  handleCommunityApi.anonymizeUser = userId => updateStore(store => {
    for (const comment of store.comments) {
      if (comment.authorId === userId) {
        delete comment.authorId;
        comment.name = '탈퇴한 회원';
      }
    }
  });
  return handleCommunityApi;
}

module.exports = { createCommunityApi };
