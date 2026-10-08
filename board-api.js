const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const POLICY_DEPARTMENTS = ['economy', 'industry', 'finance', 'sme', 'education', 'culture', 'welfare', 'labor', 'gender',
  'environment', 'foreign', 'unification', 'defense', 'science', 'landtransport', 'agriculture', 'ocean', 'safety', 'justice', 'personnel'];
const BOARDS = {
  community: { publicRead: true, categories: null, title: false, max: 5000 },
  voice: { publicRead: true, categories: ['민원이 불편했어요', '이 정책, 이상해요', '우리 의원님, 이러셔도 될까요'], title: false, max: 5000 },
  policy: { publicRead: true, categories: POLICY_DEPARTMENTS, title: false, max: 3000 },
  research: { publicRead: false, categories: ['칼럼', '서평', '소고', '짧은 이야기', '학술', '논문', '학술지'], title: true, max: 20000 },
};
const REPORT_HIDE_THRESHOLD = 3;

class BoardError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function createBoardApi(dataDirectory, { storage, rateLimit, authenticate, requireVerifiedEmail = false, now = Date.now, listLimit = 200 } = {}) {
  if (typeof authenticate !== 'function') throw new Error('Board API requires an authenticate function');
  const filePath = path.join(dataDirectory, 'board.json');
  let writes = Promise.resolve();
  const windows = new Map();

  async function readStore() {
    try {
      const store = storage ? await storage.read() : JSON.parse(await fs.readFile(filePath, 'utf8'));
      for (const key of ['posts', 'likes', 'reports']) if (!Array.isArray(store[key])) store[key] = [];
      return store;
    } catch (error) {
      if (error.code === 'ENOENT') return { posts: [], likes: [], reports: [] };
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
      if (!(error instanceof BoardError)) console.error('Board storage write failed:', error);
    });
    return operation;
  }

  function limit(key, max, duration) {
    const timestamp = now();
    if (rateLimit) {
      if (!rateLimit(key, max, duration, timestamp)) throw new BoardError(429, '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    for (const [entry, window] of windows) if (window.until <= timestamp) windows.delete(entry);
    const window = windows.get(key) || { count: 0, until: timestamp + duration };
    window.count += 1;
    windows.set(key, window);
    if (window.count > max) throw new BoardError(429, '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
  }

  function send(response, status, body) {
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(JSON.stringify(body));
  }

  async function readBody(request, maxBytes) {
    if (!request.headers['content-type']?.startsWith('application/json')) throw new BoardError(415, 'JSON 형식으로 요청해 주세요.');
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > maxBytes) throw new BoardError(413, '입력 내용이 너무 큽니다.');
      chunks.push(chunk);
    }
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
      return body;
    } catch {
      throw new BoardError(400, '올바른 요청 내용을 입력해 주세요.');
    }
  }

  function view(post, store, user) {
    const likes = store.likes.filter(entry => entry.postId === post.id);
    const reports = store.reports.filter(entry => entry.postId === post.id);
    return {
      id: post.id, no: post.no || null, board: post.board, category: post.category, title: post.title, text: post.text,
      authorName: post.authorName, createdAt: post.createdAt, editedAt: post.editedAt || null, likes: likes.length,
      liked: Boolean(user && likes.some(entry => entry.userId === user.id)),
      reported: Boolean(user && reports.some(entry => entry.userId === user.id)),
      mine: Boolean(user && post.authorId === user.id),
      ...(user?.admin ? { hidden: Boolean(post.hiddenAt), reportCount: reports.length, reasons: reports.slice(-10).map(entry => entry.reason), history: (post.history || []).slice(-5) } : {}),
    };
  }

  function findPost(store, id) {
    const post = typeof id === 'string' ? store.posts.find(entry => entry.id === id) : null;
    if (!post) throw new BoardError(404, '글을 찾을 수 없습니다. 새로고침해 주세요.');
    return post;
  }

  const text = (value, max) => typeof value === 'string' ? value.trim() : '';

  // 글마다 고유 번호(withpluces.com/post/번호). 번호가 없는 예전 글은 올린 순서대로 매긴다.
  function numberPosts(store) {
    let max = store.posts.reduce((value, entry) => Math.max(value, entry.no || 0), 0);
    const missing = store.posts.filter(entry => !entry.no).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    for (const post of missing) post.no = ++max;
    return missing.length;
  }
  async function numberedStore() {
    let store = await readStore();
    if (store.posts.some(entry => !entry.no)) {
      await updateStore(current => { numberPosts(current); });
      store = await readStore();
    }
    return store;
  }
  const publicView = (post, store) => ({
    no: post.no, board: post.board, category: post.category || '', title: post.title || '', text: post.text,
    authorName: post.authorName, createdAt: post.createdAt, editedAt: post.editedAt || null,
    likes: store.likes.filter(entry => entry.postId === post.id).length,
  });
  const isPublic = post => BOARDS[post.board]?.publicRead && !post.hiddenAt;

  async function handleBoardApi(request, response, pathname) {
    try {
      const ip = request.socket.remoteAddress;
      if (pathname === '/api/board') {
        if (request.method !== 'GET') {
          response.setHeader('Allow', 'GET');
          throw new BoardError(405, '지원하지 않는 요청 방식입니다.');
        }
        const board = new URL(request.url, 'http://localhost').searchParams.get('board');
        if (!Object.hasOwn(BOARDS, board || '')) throw new BoardError(400, '게시판을 확인해 주세요.');
        limit(`board-read:${ip}`, 240, 60000);
        const { user } = await authenticate(request);
        if (!BOARDS[board].publicRead && !user) throw new BoardError(401, '가입 회원만 볼 수 있는 게시판입니다. 로그인해 주세요.');
        const store = await readStore();
        const posts = store.posts
          .filter(post => post.board === board && (user?.admin || !post.hiddenAt))
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .slice(0, listLimit);
        send(response, 200, { posts: posts.map(post => view(post, store, user)) });
        return;
      }
      const actions = ['/api/board/posts', '/api/board/edit', '/api/board/like', '/api/board/report', '/api/board/moderate'];
      if (!actions.includes(pathname)) throw new BoardError(404, '요청한 기능이 없습니다.');
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        throw new BoardError(405, '지원하지 않는 요청 방식입니다.');
      }
      limit(`board-write:${ip}`, 60, 60000);
      const auth = await authenticate(request, { csrf: true });
      if (auth.error) throw new BoardError(auth.error.status, auth.error.message);
      const user = auth.user;
      if (!user) throw new BoardError(401, '로그인한 회원만 이용할 수 있습니다.');
      const input = await readBody(request, pathname === '/api/board/posts' || pathname === '/api/board/edit' ? 96 * 1024 : 4096);

      if (pathname === '/api/board/posts') {
        if (requireVerifiedEmail && !user.emailVerified) throw new BoardError(403, '이메일 인증을 완료한 회원만 글을 쓸 수 있습니다. 상단의 인증 메일 보내기를 이용해 주세요.');
        const board = Object.hasOwn(BOARDS, input.board || '') ? input.board : null;
        if (!board) throw new BoardError(400, '게시판을 확인해 주세요.');
        const rules = BOARDS[board];
        const category = rules.categories ? (rules.categories.includes(input.category) ? input.category : null) : '';
        if (category === null) throw new BoardError(400, '분류를 선택해 주세요.');
        const title = rules.title ? text(input.title) : '';
        if (rules.title && (!title || title.length > 120)) throw new BoardError(400, '제목을 1~120자로 입력해 주세요.');
        const body = text(input.text);
        if (!body || body.length > rules.max) throw new BoardError(400, `내용을 1~${rules.max.toLocaleString('ko-KR')}자로 입력해 주세요.`);
        limit(`board-post:${user.id}`, 10, 10 * 60000);
        const post = { id: randomUUID(), board, category, title, text: body, authorId: user.id, authorName: user.nickname,
          createdAt: new Date(now()).toISOString() };
        await updateStore(store => {
          numberPosts(store);
          post.no = store.posts.reduce((max, entry) => Math.max(max, entry.no || 0), 0) + 1;
          store.posts.push(post);
        });
        send(response, 201, { post: view(post, { likes: [], reports: [] }, user), message: '글이 등록되었습니다.' });
        return;
      }

      if (pathname === '/api/board/edit') {
        if (requireVerifiedEmail && !user.emailVerified) throw new BoardError(403, '이메일 인증을 완료한 회원만 글을 수정할 수 있습니다.');
        limit(`board-edit:${user.id}`, 20, 10 * 60000);
        const post = await updateStore(store => {
          const target = findPost(store, input.postId);
          if (target.authorId !== user.id) throw new BoardError(403, '내가 쓴 글만 수정할 수 있습니다.');
          if (target.hiddenAt) throw new BoardError(409, '신고로 숨김 처리된 글은 운영자 검토가 끝날 때까지 수정할 수 없습니다.');
          const rules = BOARDS[target.board];
          let category = target.category;
          if (rules.categories && target.board !== 'policy' && input.category !== undefined) {
            if (!rules.categories.includes(input.category)) throw new BoardError(400, '분류를 선택해 주세요.');
            category = input.category;
          }
          const title = rules.title ? text(input.title) : '';
          if (rules.title && (!title || title.length > 120)) throw new BoardError(400, '제목을 1~120자로 입력해 주세요.');
          const body = text(input.text);
          if (!body || body.length > rules.max) throw new BoardError(400, `내용을 1~${rules.max.toLocaleString('ko-KR')}자로 입력해 주세요.`);
          if (body === target.text && title === (target.title || '') && category === target.category) throw new BoardError(400, '바뀐 내용이 없습니다.');
          // Keep the previous versions so moderators can see what a reported post said before it was edited.
          target.history = [...(target.history || []), { category: target.category, title: target.title, text: target.text, savedAt: target.editedAt || target.createdAt }].slice(-5);
          Object.assign(target, { category, title, text: body, editedAt: new Date(now()).toISOString() });
          return view(target, store, user);
        });
        send(response, 200, { post, message: '글을 수정했습니다.' });
        return;
      }

      if (pathname === '/api/board/like') {
        limit(`board-like:${user.id}`, 60, 60000);
        const result = await updateStore(store => {
          const post = findPost(store, input.postId);
          if (post.board !== 'policy' || post.hiddenAt) throw new BoardError(400, '추천할 수 없는 글입니다.');
          const index = store.likes.findIndex(entry => entry.postId === post.id && entry.userId === user.id);
          if (index >= 0) store.likes.splice(index, 1);
          else store.likes.push({ id: `${post.id}:${user.id}`, postId: post.id, userId: user.id });
          return { likes: store.likes.filter(entry => entry.postId === post.id).length, liked: index < 0 };
        });
        send(response, 200, result);
        return;
      }

      if (pathname === '/api/board/report') {
        const reason = text(input.reason);
        if (!reason || reason.length > 200) throw new BoardError(400, '신고 사유를 1~200자로 입력해 주세요.');
        limit(`board-report:${user.id}`, 20, 60 * 60000);
        const hidden = await updateStore(store => {
          const post = findPost(store, input.postId);
          if (store.reports.some(entry => entry.postId === post.id && entry.userId === user.id)) throw new BoardError(409, '이미 신고한 글입니다.');
          store.reports.push({ id: `${post.id}:${user.id}`, postId: post.id, userId: user.id, reason, createdAt: new Date(now()).toISOString() });
          if (!post.hiddenAt && store.reports.filter(entry => entry.postId === post.id).length >= REPORT_HIDE_THRESHOLD) {
            post.hiddenAt = new Date(now()).toISOString();
          }
          return Boolean(post.hiddenAt);
        });
        send(response, 200, { hidden, message: hidden ? '신고가 접수되었습니다. 신고가 누적되어 운영자 검토 전까지 임시로 숨김 처리됩니다.' : '신고가 접수되었습니다. 운영자가 검토합니다.' });
        return;
      }

      if (!user.admin) throw new BoardError(403, '운영자만 처리할 수 있습니다.');
      if (!['delete', 'restore'].includes(input.action)) throw new BoardError(400, '처리 방법을 확인해 주세요.');
      await updateStore(store => {
        const post = findPost(store, input.postId);
        if (input.action === 'delete') {
          store.posts = store.posts.filter(entry => entry.id !== post.id);
          store.likes = store.likes.filter(entry => entry.postId !== post.id);
        } else {
          post.hiddenAt = null;
        }
        store.reports = store.reports.filter(entry => entry.postId !== post.id);
      });
      send(response, 200, { message: input.action === 'delete' ? '글을 삭제했습니다.' : '글을 다시 공개했습니다.' });
    } catch (error) {
      if (!(error instanceof BoardError)) console.error('Board API failed:', error);
      if (!response.destroyed) {
        send(response, error instanceof BoardError ? error.status : 500, {
          error: error instanceof BoardError ? error.message : '게시판 처리 중 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
        });
      }
    }
  }

  handleBoardApi.highlights = async since => {
    const store = await readStore();
    const recent = store.posts.filter(post => !post.hiddenAt && post.createdAt >= since);
    const likes = id => store.likes.filter(entry => entry.postId === id).length;
    const newest = (board, count) => recent.filter(post => post.board === board)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, count)
      .map(post => ({ category: post.category, text: post.text }));
    return {
      policy: recent.filter(post => post.board === 'policy').map(post => ({ category: post.category, text: post.text, likes: likes(post.id), createdAt: post.createdAt }))
        .sort((left, right) => right.likes - left.likes || right.createdAt.localeCompare(left.createdAt)).slice(0, 3),
      voice: newest('voice', 3),
      community: newest('community', 2),
      researchCount: recent.filter(post => post.board === 'research').length,
    };
  };
  // 검색엔진에 보여 줄 공개 글(회원 전용 게시판·숨김 글 제외)
  handleBoardApi.publicPost = async no => {
    const store = await numberedStore();
    const post = store.posts.find(entry => entry.no === Number(no));
    if (!post) return { status: 404 };
    if (!BOARDS[post.board]?.publicRead) return { status: 403 };
    if (post.hiddenAt) return { status: 410 };
    const related = store.posts.filter(entry => entry.board === post.board && entry.no !== post.no && isPublic(entry))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 8).map(entry => publicView(entry, store));
    return { status: 200, post: publicView(post, store), related };
  };
  handleBoardApi.publicPosts = async () => {
    const store = await numberedStore();
    return store.posts.filter(isPublic).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map(entry => publicView(entry, store));
  };
  handleBoardApi.anonymizeUser = userId => updateStore(store => {
    for (const post of store.posts) {
      if (post.authorId === userId) {
        post.authorId = null;
        post.authorName = '탈퇴한 회원';
      }
    }
    store.likes = store.likes.filter(entry => entry.userId !== userId);
    store.reports = store.reports.filter(entry => entry.userId !== userId);
  });
  return handleBoardApi;
}

module.exports = { createBoardApi, BOARDS, REPORT_HIDE_THRESHOLD };
