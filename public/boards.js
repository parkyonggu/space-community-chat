(() => {
  const categories = [{ title: '재정·경제산업부', depts: [{ id: 'economy', name: '기획재정부' }, { id: 'industry', name: '산업통상자원부' }, { id: 'finance', name: '금융위원회' }, { id: 'sme', name: '중소벤처기업부' }] },
    { title: '사회·교육·문화', depts: [{ id: 'education', name: '교육부' }, { id: 'culture', name: '문화체육관광부' }, { id: 'welfare', name: '보건복지부' }, { id: 'labor', name: '고용노동부' }, { id: 'gender', name: '여성가족부' }, { id: 'environment', name: '환경부' }] },
    { title: '외교·안보·통일', depts: [{ id: 'foreign', name: '외교부' }, { id: 'unification', name: '통일부' }, { id: 'defense', name: '국방부' }] },
    { title: '과학·인프라', depts: [{ id: 'science', name: '과학기술정보통신부' }, { id: 'landtransport', name: '국토교통부' }, { id: 'agriculture', name: '농림축산식품부' }, { id: 'ocean', name: '해양수산부' }] },
    { title: '일반행정·법무', depts: [{ id: 'safety', name: '행정안전부' }, { id: 'justice', name: '법무부' }, { id: 'personnel', name: '인사혁신처' }] }];
  const $ = id => document.getElementById(id);
  const state = { user: null, mailConfigured: false, ready: false, sort: 'latest', keyword: '', posts: { community: [], voice: [], policy: [], research: [] } };
  const sections = { community: 'community-section', voice: 'voice-section', policy: 'policy-section', research: 'research-section' };
  const statusOf = {};

  function make(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  async function api(url, body) {
    const response = await fetch(url, body ? {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.spaceAuth?.csrfToken || '' },
      body: JSON.stringify(body),
    } : { cache: 'no-store', credentials: 'same-origin' });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('게시판 서버가 응답하지 않습니다. 잠시 후 다시 시도해 주세요.');
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error || `게시판 오류 (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return result;
  }

  function setStatus(board, message, isError = false) {
    const element = statusOf[board];
    if (!element) return;
    element.textContent = message;
    element.dataset.error = String(isError);
  }

  function canWrite() {
    return Boolean(state.user && (state.user.emailVerified || !state.mailConfigured));
  }

  function writeHint() {
    if (!state.user) return '로그인한 회원만 글을 쓸 수 있습니다.';
    if (!canWrite()) return '이메일 인증을 완료하면 글을 쓸 수 있습니다. 상단의 "인증 메일 보내기"를 이용해 주세요.';
    return '';
  }

  // Policy department cards
  const categoryContainer = $('categoryContainer');
  categories.forEach(category => {
    const group = make('div', 'category-group');
    group.appendChild(make('h3', '', category.title));
    const grid = make('div', 'policy-grid');
    category.depts.forEach(dept => {
      const card = make('article', 'policy-category');
      card.appendChild(make('h4', '', dept.name));
      const textarea = make('textarea');
      textarea.dataset.placeholder = `${dept.name} 관련 의견을 작성하세요`;
      textarea.maxLength = 3000;
      const button = make('button', 'submitPolicy', '제안 등록');
      button.dataset.dept = dept.id;
      const output = make('div', 'policy-output');
      output.id = `output-${dept.id}`;
      card.append(textarea, button, output);
      grid.appendChild(card);
    });
    group.appendChild(grid);
    categoryContainer.appendChild(group);
  });

  // Status lines under each composer
  for (const [board, sectionId] of Object.entries(sections)) {
    const status = make('p', 'form-status');
    status.setAttribute('role', 'status');
    const anchor = board === 'policy' ? categoryContainer : $(sectionId).querySelector('.post-composer h3');
    anchor.after(status);
    statusOf[board] = status;
  }

  // Members-only notice for research
  const researchComposer = $('research-section').querySelector('.post-composer');
  const researchLock = make('div', 'notice');
  researchLock.hidden = true;
  researchLock.innerHTML = '<strong>회원 전용 게시판</strong><br>학술·논문·소고·이야기는 가입한 회원만 읽고 쓸 수 있습니다. ';
  const lockLogin = make('button', 'submitPolicy', '로그인');
  const lockSignup = make('button', 'submitPolicy', '회원가입');
  lockLogin.type = lockSignup.type = 'button';
  lockLogin.addEventListener('click', () => window.spaceOpenAuth?.('login'));
  lockSignup.addEventListener('click', () => window.spaceOpenAuth?.('signup'));
  researchLock.append(lockLogin, ' ', lockSignup);
  researchComposer.before(researchLock);

  function renderPost(post) {
    const item = make('article', 'post-item');
    if (post.hidden) item.style.opacity = '0.6';
    const head = make('div');
    if (post.category && post.board !== 'policy') head.appendChild(make('strong', '', `[${post.category}] `));
    if (post.title) head.appendChild(make('strong', '', post.title));
    if (head.childNodes.length) item.appendChild(head);
    const body = make('p', '', post.text);
    body.style.whiteSpace = 'pre-wrap';
    item.appendChild(body);
    const meta = make('div', 'label');
    meta.style.display = 'flex';
    meta.style.flexWrap = 'wrap';
    meta.style.gap = '8px';
    meta.style.alignItems = 'center';
    meta.appendChild(make('span', '', `${post.authorName} · ${new Date(post.createdAt).toLocaleString('ko-KR')}`));
    if (post.board === 'policy') {
      const like = make('button', 'like-btn', `추천 ${post.likes}`);
      like.type = 'button';
      like.setAttribute('aria-pressed', String(post.liked));
      like.disabled = !state.user || post.hidden;
      like.title = state.user ? '추천하기/취소' : '로그인 후 추천할 수 있습니다.';
      like.addEventListener('click', async () => {
        like.disabled = true;
        try {
          const result = await api('/api/board/like', { postId: post.id });
          post.likes = result.likes;
          post.liked = result.liked;
          render(post.board);
        } catch (error) {
          setStatus(post.board, error.message, true);
          like.disabled = false;
        }
      });
      meta.appendChild(like);
    }
    if (state.user && !post.mine) {
      const report = make('button', 'like-btn', post.reported ? '신고됨' : '신고');
      report.type = 'button';
      report.disabled = post.reported;
      report.addEventListener('click', async () => {
        const reason = window.prompt('신고 사유를 적어 주세요. (예: 욕설, 허위사실, 개인정보 노출, 광고)');
        if (reason === null) return;
        if (!reason.trim()) { setStatus(post.board, '신고 사유를 입력해 주세요.', true); return; }
        report.disabled = true;
        try {
          const result = await api('/api/board/report', { postId: post.id, reason: reason.trim().slice(0, 200) });
          post.reported = true;
          setStatus(post.board, result.message);
          if (result.hidden && !state.user?.admin) state.posts[post.board] = state.posts[post.board].filter(entry => entry.id !== post.id);
          render(post.board);
        } catch (error) {
          setStatus(post.board, error.message, true);
          report.disabled = false;
        }
      });
      meta.appendChild(report);
    }
    if (state.user?.admin) {
      if (post.reportCount) meta.appendChild(make('span', '', `신고 ${post.reportCount}건${post.hidden ? ' · 임시조치(숨김)' : ''}${post.reasons?.length ? ` · 사유: ${post.reasons.join(' / ')}` : ''}`));
      if (post.hidden || post.reportCount) {
        const restore = make('button', 'like-btn', '복구');
        restore.type = 'button';
        restore.addEventListener('click', () => moderate(post, 'restore'));
        meta.appendChild(restore);
      }
      const remove = make('button', 'like-btn', '삭제(운영자)');
      remove.type = 'button';
      remove.addEventListener('click', () => {
        if (window.confirm('이 글을 삭제할까요? 삭제하면 되돌릴 수 없습니다.')) moderate(post, 'delete');
      });
      meta.appendChild(remove);
    }
    item.appendChild(meta);
    return item;
  }

  async function moderate(post, action) {
    try {
      const result = await api('/api/board/moderate', { postId: post.id, action });
      setStatus(post.board, result.message);
      await load(post.board);
    } catch (error) {
      setStatus(post.board, error.message, true);
    }
  }

  function render(board) {
    const posts = state.posts[board];
    if (board === 'policy') {
      categories.flatMap(category => category.depts).forEach(dept => {
        const output = $(`output-${dept.id}`);
        let items = posts.filter(post => post.category === dept.id && (!state.keyword || post.text.includes(state.keyword)));
        items = items.sort((left, right) => state.sort === 'likes' ? right.likes - left.likes || right.createdAt.localeCompare(left.createdAt) : right.createdAt.localeCompare(left.createdAt));
        output.replaceChildren(...items.map(renderPost));
      });
      return;
    }
    let items = posts;
    if (board === 'research') {
      const filter = $('researchFilter').value;
      if (filter !== 'all') items = items.filter(post => post.category === filter);
    }
    const target = $(board === 'community' ? 'communityPosts' : board === 'voice' ? 'voicePosts' : 'researchPosts');
    target.replaceChildren(...items.map(renderPost));
    if (!items.length) target.appendChild(make('p', 'label', '아직 등록된 글이 없습니다.'));
  }

  async function load(board) {
    if (board === 'research' && !state.user) {
      state.posts.research = [];
      $('researchPosts').replaceChildren();
      return;
    }
    try {
      const { posts } = await api(`/api/board?board=${board}`);
      state.posts[board] = posts;
      render(board);
    } catch (error) {
      setStatus(board, error.message, true);
    }
  }

  function updateComposers() {
    const allowed = canWrite();
    const hint = writeHint();
    const controls = [
      [$('communityInput'), $('communitySubmit'), '안부, 일상, 취미, 고민을 자유롭게 적어주세요.'],
      [$('voiceInput'), $('voiceSubmit'), '언제, 어디서, 누가, 무엇을, 왜, 어떻게 겪었는지 사실에 기반해 작성해주세요.'],
      [$('researchInput'), $('researchSubmit'), '연구의 질문, 생각의 단상, 이야기의 첫 문장을 자유롭게 적어주세요.'],
      ...[...categoryContainer.querySelectorAll('.policy-category')].map(card => [card.querySelector('textarea'), card.querySelector('button'), card.querySelector('textarea').dataset.placeholder]),
    ];
    for (const [input, button, placeholder] of controls) {
      input.disabled = !allowed;
      button.disabled = !allowed;
      input.placeholder = allowed ? placeholder : hint;
    }
    $('researchTitle').disabled = !allowed;
    $('voiceCategory').disabled = !allowed;
    $('researchType').disabled = !allowed;
    const member = Boolean(state.user);
    researchLock.hidden = member;
    researchComposer.hidden = !member;
  }

  async function submit(board, payload, clear) {
    try {
      const { post, message } = await api('/api/board/posts', { board, ...payload });
      state.posts[board].unshift(post);
      clear();
      render(board);
      setStatus(board, message);
    } catch (error) {
      setStatus(board, error.message, true);
    }
  }

  $('communitySubmit').addEventListener('click', () => {
    const input = $('communityInput');
    if (!input.value.trim()) { setStatus('community', '내용을 입력해 주세요.', true); return; }
    submit('community', { text: input.value }, () => { input.value = ''; });
  });
  $('voiceSubmit').addEventListener('click', () => {
    const input = $('voiceInput');
    if (!input.value.trim()) { setStatus('voice', '내용을 입력해 주세요.', true); return; }
    submit('voice', { category: $('voiceCategory').value, text: input.value }, () => { input.value = ''; });
  });
  $('researchSubmit').addEventListener('click', () => {
    const title = $('researchTitle');
    const input = $('researchInput');
    if (!title.value.trim() || !input.value.trim()) { setStatus('research', '제목과 내용을 입력해 주세요.', true); return; }
    submit('research', { category: $('researchType').value, title: title.value, text: input.value }, () => { title.value = ''; input.value = ''; });
  });
  categoryContainer.addEventListener('click', event => {
    const button = event.target.closest('button.submitPolicy');
    if (!button) return;
    const textarea = button.previousElementSibling;
    if (!textarea.value.trim()) { setStatus('policy', '의견을 입력해 주세요.', true); return; }
    submit('policy', { category: button.dataset.dept, text: textarea.value }, () => { textarea.value = ''; });
  });
  $('researchFilter').addEventListener('change', () => render('research'));
  document.querySelectorAll('.sort-btn').forEach(button => button.addEventListener('click', () => {
    state.sort = button.dataset.sort;
    document.querySelectorAll('.sort-btn').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    render('policy');
  }));
  function runSearch() {
    state.keyword = $('searchInput').value.trim();
    render('policy');
    $('policy-section').scrollIntoView({ behavior: 'smooth' });
  }
  $('searchBtn').addEventListener('click', runSearch);
  $('searchInput').addEventListener('keydown', event => { if (event.key === 'Enter') runSearch(); });

  function applyAuth(detail) {
    const previous = state.ready ? `${state.user?.id || ''}:${state.user?.admin || false}` : null;
    state.user = detail?.user || null;
    state.mailConfigured = Boolean(detail?.mailConfigured);
    updateComposers();
    const current = `${state.user?.id || ''}:${state.user?.admin || false}`;
    if (previous !== current) {
      state.ready = true;
      Object.keys(sections).forEach(load);
    }
  }
  window.addEventListener('space-auth', event => applyAuth(event.detail));
  updateComposers();
  if (window.spaceAuth) applyAuth(window.spaceAuth);
  else ['community', 'voice', 'policy'].forEach(load);
})();
