const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const POLICY_DEPARTMENTS = ['economy', 'industry', 'finance', 'sme', 'education', 'culture', 'welfare', 'labor', 'gender',
  'environment', 'foreign', 'unification', 'defense', 'science', 'landtransport', 'agriculture', 'ocean', 'safety', 'justice', 'personnel'];
const BOARDS = {
  // 소통·나눔: 분류는 고르지 않아도 되고(일반 이야기), 시는 '시'로 따로 모은다.
  community: { publicRead: true, categories: ['시'], optionalCategory: true, title: false, max: 5000 },
  voice: { publicRead: true, categories: ['민원이 불편했어요', '우리 동네 고쳐 주세요', '이 정책, 이상해요', '우리 의원님, 이러셔도 될까요'], title: false, max: 5000 },
  policy: { publicRead: true, categories: POLICY_DEPARTMENTS, title: false, max: 3000, likes: true },
  // 오늘의 이슈 평론: 회원·관리자가 그날 이슈(분야)마다 평론을 쓴다. 글마다 어떤 기사에 대한 평론인지 함께 저장한다.
  issue: { publicRead: true, categories: ['정치', '경제', '국방', '국제', '사회', '문화'], title: false, max: 10000, issue: true, likes: true },
  research: { publicRead: false, categories: ['칼럼', '서평', '소고', '짧은 이야기', '학술', '논문', '학술지', '대법원 전원합의체 판결'], title: true, max: 50000 },
};
const REPORT_HIDE_THRESHOLD = 3;
// 시민의 소리 '처리 경과': 글쓴이(또는 운영자)가 공식 민원 창구에 접수한 뒤 진행 상황을 적는다.
const PROGRESS_STATUS = ['접수함', '처리 중', '답변 받음', '해결됨', '반려됨'];
const PROGRESS_CHANNELS = ['국민신문고', '안전신문고', '시·군청 누리집', '읍·면·동 방문/전화', '기타'];

class BoardError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// 글에 붙이는 사진: 화면에서 줄이고(긴 변 1600px) 다시 저장해 위치정보(EXIF)를 지운 JPEG을 받는다.
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 1500 * 1024;
const IMAGE_TYPES = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46] };
const IMAGE_ID = /^[0-9a-f]{32}$/;

// 기본 사진 보관소(메모리). Cloudflare에서는 Durable Object SQLite, 내 컴퓨터 서버에서는 파일로 바꿔 끼운다.
function createMemoryImageStore() {
  const images = new Map();
  return {
    async put(image) { images.set(image.id, { ...image }); },
    async get(id) { return images.get(id) || null; },
    async attach(ids, postId) { for (const id of ids) { const image = images.get(id); if (image) image.postId = postId; } },
    async remove(ids) { for (const id of ids) images.delete(id); },
    async purgeUnattached(before) { for (const [id, image] of images) if (!image.postId && image.createdAt < before) images.delete(id); },
  };
}

function createBoardApi(dataDirectory, { storage, rateLimit, authenticate, requireVerifiedEmail = false, now = Date.now, listLimit = 200, images = createMemoryImageStore() } = {}) {
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
      id: post.id, no: post.no || null, board: post.board, category: post.category, title: post.title, text: post.text, ...(post.issue ? { issue: post.issue } : {}), images: post.images || [], ...(post.progress ? { progress: post.progress } : {}),
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
  // 글에 붙일 사진: 내가 올렸고 아직 다른 글에 붙지 않은 사진만(수정할 때는 이 글에 이미 붙은 사진도) 받는다.
  async function imageIds(input, user, existing = []) {
    if (input === undefined) return null;
    if (!Array.isArray(input)) throw new BoardError(400, '사진 목록을 확인해 주세요.');
    const ids = [...new Set(input)];
    if (ids.length > MAX_IMAGES) throw new BoardError(400, `사진은 글 하나에 ${MAX_IMAGES}장까지 붙일 수 있습니다.`);
    for (const id of ids) {
      if (typeof id !== 'string' || !IMAGE_ID.test(id)) throw new BoardError(400, '사진을 다시 올려 주세요.');
      if (existing.includes(id)) continue;
      const image = await images.get(id);
      if (!image || image.userId !== user.id || image.postId) throw new BoardError(400, '사진을 다시 올려 주세요.');
    }
    return ids;
  }
  async function readImage(request) {
    const type = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES[type]) throw new BoardError(415, 'JPG·PNG·WEBP 사진만 올릴 수 있습니다.');
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_IMAGE_BYTES) throw new BoardError(413, '사진이 너무 큽니다. 1.5MB 이하로 줄여 주세요.');
      chunks.push(Buffer.from(chunk));
    }
    const data = Buffer.concat(chunks);
    if (data.length < 100 || !IMAGE_TYPES[type].every((byte, index) => data[index] === byte)) throw new BoardError(400, '사진 파일을 읽을 수 없습니다.');
    return { type, data };
  }

  // 평론 대상 이슈: 화면이 보낸 값을 그대로 믿지 않고 모양만 확인해 짧게 저장한다.
  function issueRef(input) {
    const ref = input && typeof input === 'object' ? input : {};
    const id = text(ref.id);
    const date = text(ref.date);
    const title = text(ref.title).replace(/\s+/g, ' ');
    const link = text(ref.link);
    if (!/^[a-z]{1,3}-[0-9a-z]{1,20}$/.test(id) || !/^\d{8}$/.test(date) || !title || title.length > 200 || !/^https:\/\/[^\s<>"']{4,500}$/.test(link)) {
      throw new BoardError(400, '평론할 이슈를 다시 골라 주세요.');
    }
    return { id, date, title, link, source: text(ref.source).slice(0, 30) };
  }

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
    no: post.no, board: post.board, category: post.category || '', title: post.title || '', text: post.text, ...(post.issue ? { issue: post.issue } : {}), images: post.images || [], ...(post.progress ? { progress: post.progress } : {}),
    authorName: post.authorName, createdAt: post.createdAt, editedAt: post.editedAt || null,
    likes: store.likes.filter(entry => entry.postId === post.id).length,
  });
  const isPublic = post => BOARDS[post.board]?.publicRead && !post.hiddenAt;

  async function handleBoardApi(request, response, pathname) {
    try {
      const ip = request.socket.remoteAddress;
      if (pathname === '/api/board/image' && request.method === 'GET') {
        const id = new URL(request.url, 'http://localhost').searchParams.get('id') || '';
        if (!IMAGE_ID.test(id)) throw new BoardError(404, '사진을 찾을 수 없습니다.');
        limit(`board-image:${ip}`, 600, 60000);
        const image = await images.get(id);
        if (!image) throw new BoardError(404, '사진을 찾을 수 없습니다.');
        const { user } = await authenticate(request);
        let open = Boolean(user && (user.admin || user.id === image.userId));
        if (!open && image.postId) {
          const post = (await readStore()).posts.find(entry => entry.id === image.postId);
          open = Boolean(post && !post.hiddenAt && (BOARDS[post.board]?.publicRead || user));
        }
        if (!open) throw new BoardError(404, '사진을 찾을 수 없습니다.');
        response.writeHead(200, { 'Content-Type': image.type, 'Content-Length': String(image.data.length), 'Cache-Control': image.postId ? 'public, max-age=86400' : 'private, max-age=600',
          'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
        response.end(image.data);
        return;
      }
      if (pathname === '/api/board/image') {
        if (request.method !== 'POST') { response.setHeader('Allow', 'GET, POST'); throw new BoardError(405, '지원하지 않는 요청 방식입니다.'); }
        const auth = await authenticate(request, { csrf: true });
        if (auth.error) throw new BoardError(auth.error.status, auth.error.message);
        if (!auth.user) throw new BoardError(401, '로그인한 회원만 사진을 올릴 수 있습니다.');
        if (requireVerifiedEmail && !auth.user.emailVerified) throw new BoardError(403, '이메일 인증을 완료한 회원만 사진을 올릴 수 있습니다.');
        limit(`board-image-up:${auth.user.id}`, 30, 60 * 60000);
        const { type, data } = await readImage(request);
        const id = randomUUID().replace(/-/g, '');
        // 글에 붙이지 않고 하루가 지난 사진은 지운다.
        await images.purgeUnattached(now() - 24 * 60 * 60 * 1000);
        await images.put({ id, type, data, userId: auth.user.id, postId: null, createdAt: now() });
        send(response, 201, { id, url: `/api/board/image?id=${id}` });
        return;
      }
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
      const actions = ['/api/board/posts', '/api/board/edit', '/api/board/like', '/api/board/report', '/api/board/moderate', '/api/board/progress'];
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
      const input = await readBody(request, pathname === '/api/board/posts' || pathname === '/api/board/edit' ? 256 * 1024 : 4096);

      if (pathname === '/api/board/posts') {
        if (requireVerifiedEmail && !user.emailVerified) throw new BoardError(403, '이메일 인증을 완료한 회원만 글을 쓸 수 있습니다. 상단의 인증 메일 보내기를 이용해 주세요.');
        const board = Object.hasOwn(BOARDS, input.board || '') ? input.board : null;
        if (!board) throw new BoardError(400, '게시판을 확인해 주세요.');
        const rules = BOARDS[board];
        const category = rules.categories ? (rules.categories.includes(input.category) ? input.category : rules.optionalCategory && !input.category ? '' : null) : '';
        if (category === null) throw new BoardError(400, '분류를 선택해 주세요.');
        // 제목: 칼럼·학술은 꼭 써야 하고, 다른 게시판은 쓰고 싶을 때만(선택).
        const title = text(input.title);
        if (rules.title && !title) throw new BoardError(400, '제목을 1~120자로 입력해 주세요.');
        if (title.length > 120) throw new BoardError(400, '제목은 120자 이내로 입력해 주세요.');
        const body = text(input.text);
        if (!body || body.length > rules.max) throw new BoardError(400, `내용을 1~${rules.max.toLocaleString('ko-KR')}자로 입력해 주세요.`);
        limit(`board-post:${user.id}`, 10, 10 * 60000);
        const attached = (await imageIds(input.images, user)) || [];
        const post = { id: randomUUID(), board, category, title, text: body, authorId: user.id, authorName: user.nickname,
          createdAt: new Date(now()).toISOString(), ...(rules.issue ? { issue: issueRef(input.issue) } : {}), ...(attached.length ? { images: attached } : {}) };
        await updateStore(store => {
          numberPosts(store);
          post.no = store.posts.reduce((max, entry) => Math.max(max, entry.no || 0), 0) + 1;
          store.posts.push(post);
        });
        if (attached.length) await images.attach(attached, post.id);
        send(response, 201, { post: view(post, { likes: [], reports: [] }, user), message: '글이 등록되었습니다.' });
        return;
      }

      if (pathname === '/api/board/edit') {
        if (requireVerifiedEmail && !user.emailVerified) throw new BoardError(403, '이메일 인증을 완료한 회원만 글을 수정할 수 있습니다.');
        limit(`board-edit:${user.id}`, 20, 10 * 60000);
        const before = (await readStore()).posts.find(entry => entry.id === input.postId);
        const nextImages = before && before.authorId === user.id ? await imageIds(input.images, user, before.images || []) : null;
        let dropped = [];
        const post = await updateStore(store => {
          const target = findPost(store, input.postId);
          if (target.authorId !== user.id) throw new BoardError(403, '내가 쓴 글만 수정할 수 있습니다.');
          if (target.hiddenAt) throw new BoardError(409, '신고로 숨김 처리된 글은 운영자 검토가 끝날 때까지 수정할 수 없습니다.');
          const rules = BOARDS[target.board];
          let category = target.category;
          if (rules.categories && target.board !== 'policy' && !rules.issue && input.category !== undefined) {
            if (!rules.categories.includes(input.category) && !(rules.optionalCategory && !input.category)) throw new BoardError(400, '분류를 선택해 주세요.');
            category = input.category;
          }
          // 제목을 보내지 않은 예전 화면에서 고치면 원래 제목을 그대로 둔다.
          const title = input.title === undefined ? (target.title || '') : text(input.title);
          if (rules.title && !title) throw new BoardError(400, '제목을 1~120자로 입력해 주세요.');
          if (title.length > 120) throw new BoardError(400, '제목은 120자 이내로 입력해 주세요.');
          const body = text(input.text);
          if (!body || body.length > rules.max) throw new BoardError(400, `내용을 1~${rules.max.toLocaleString('ko-KR')}자로 입력해 주세요.`);
          const sameImages = !nextImages || nextImages.join() === (target.images || []).join();
          if (body === target.text && title === (target.title || '') && category === target.category && sameImages) throw new BoardError(400, '바뀐 내용이 없습니다.');
          if (nextImages) {
            dropped = (target.images || []).filter(id => !nextImages.includes(id));
            if (nextImages.length) target.images = nextImages; else delete target.images;
          }
          // Keep the previous versions so moderators can see what a reported post said before it was edited.
          target.history = [...(target.history || []), { category: target.category, title: target.title, text: target.text, savedAt: target.editedAt || target.createdAt }].slice(-5);
          Object.assign(target, { category, title, text: body, editedAt: new Date(now()).toISOString() });
          return view(target, store, user);
        });
        if (nextImages) { await images.attach(nextImages, post.id); if (dropped.length) await images.remove(dropped); }
        send(response, 200, { post, message: '글을 수정했습니다.' });
        return;
      }

      if (pathname === '/api/board/like') {
        limit(`board-like:${user.id}`, 60, 60000);
        const result = await updateStore(store => {
          const post = findPost(store, input.postId);
          if (!BOARDS[post.board]?.likes || post.hiddenAt) throw new BoardError(400, '추천할 수 없는 글입니다.');
          const index = store.likes.findIndex(entry => entry.postId === post.id && entry.userId === user.id);
          if (index >= 0) store.likes.splice(index, 1);
          else store.likes.push({ id: `${post.id}:${user.id}`, postId: post.id, userId: user.id });
          return { likes: store.likes.filter(entry => entry.postId === post.id).length, liked: index < 0 };
        });
        send(response, 200, result);
        return;
      }

      if (pathname === '/api/board/progress') {
        limit(`board-progress:${user.id}`, 20, 10 * 60000);
        const status = text(input.status);
        const channel = text(input.channel);
        const receipt = text(input.receipt);
        const answer = text(input.answer).replace(/\r/g, '');
        if (input.clear !== true) {
          if (!PROGRESS_STATUS.includes(status)) throw new BoardError(400, '진행 상황을 골라 주세요.');
          if (!PROGRESS_CHANNELS.includes(channel)) throw new BoardError(400, '접수한 곳을 골라 주세요.');
          if (!/^[0-9A-Za-z가-힣\- ]{0,40}$/.test(receipt)) throw new BoardError(400, '접수번호는 40자 이내의 숫자·글자로 적어 주세요.');
          if (answer.length > 800) throw new BoardError(400, '답변 요지는 800자 이내로 적어 주세요.');
        }
        const post = await updateStore(store => {
          const target = findPost(store, input.postId);
          if (target.board !== 'voice') throw new BoardError(400, '시민의 소리 글에만 처리 경과를 적을 수 있습니다.');
          if (target.authorId !== user.id && !user.admin) throw new BoardError(403, '글쓴이만 처리 경과를 적을 수 있습니다.');
          if (input.clear === true) delete target.progress;
          else target.progress = { status, channel, receipt, answer, updatedAt: new Date(now()).toISOString(), by: user.admin && target.authorId !== user.id ? '운영자' : '글쓴이' };
          return view(target, store, user);
        });
        send(response, 200, { post, message: input.clear === true ? '처리 경과를 지웠습니다.' : '처리 경과를 저장했습니다.' });
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
      let removedImages = [];
      await updateStore(store => {
        const post = findPost(store, input.postId);
        if (input.action === 'delete') {
          removedImages = post.images || [];
          store.posts = store.posts.filter(entry => entry.id !== post.id);
          store.likes = store.likes.filter(entry => entry.postId !== post.id);
        } else {
          post.hiddenAt = null;
        }
        store.reports = store.reports.filter(entry => entry.postId !== post.id);
      });
      if (removedImages.length) await images.remove(removedImages);
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

module.exports = { createBoardApi, createMemoryImageStore, BOARDS, REPORT_HIDE_THRESHOLD, MAX_IMAGES, PROGRESS_STATUS, PROGRESS_CHANNELS };
