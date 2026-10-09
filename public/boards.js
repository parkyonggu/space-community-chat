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
    item.id = `post-${post.id}`;
    if (post.hidden) item.style.opacity = '0.6';
    const head = make('div');
    if (post.category && post.board !== 'policy') head.appendChild(make('strong', '', `[${post.category}] `));
    if (post.title) head.appendChild(make('strong', 'post-title', post.title));
    if (head.childNodes.length) item.appendChild(head);
    const body = make('p', '', post.text);
    body.style.whiteSpace = 'pre-wrap';
    item.appendChild(body);
    const meta = make('div', 'label');
    meta.style.display = 'flex';
    meta.style.flexWrap = 'wrap';
    meta.style.gap = '8px';
    meta.style.alignItems = 'center';
    meta.appendChild(make('span', '', `${post.authorName} · ${new Date(post.createdAt).toLocaleString('ko-KR')}${post.editedAt ? ` · 수정됨 ${new Date(post.editedAt).toLocaleString('ko-KR')}` : ''}`));
    // 공개 게시판 글은 고유 주소(withpluces.com/post/번호)로 바로 열고 공유할 수 있다.
    if (post.no && post.board !== 'research' && !post.hidden) {
      const permalink = make('a', 'like-btn', `🔗 글 주소 #${post.no}`);
      permalink.href = `/post/${post.no}`;
      permalink.title = '이 글만 따로 보기·공유하기';
      permalink.style.textDecoration = 'none';
      meta.appendChild(permalink);
    }
    if (post.mine && !post.hidden && canWrite()) {
      const edit = make('button', 'like-btn', '수정');
      edit.type = 'button';
      edit.addEventListener('click', () => openEditor(post, item));
      meta.appendChild(edit);
    }
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
          announce(post.board);
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
    if (state.user?.admin && post.history?.length) {
      const history = make('details', 'post-history');
      history.appendChild(make('summary', '', `수정 전 내용 ${post.history.length}건 (운영자만 보임)`));
      post.history.slice().reverse().forEach(entry => {
        const version = make('p', '', `${new Date(entry.savedAt).toLocaleString('ko-KR')} · ${entry.title ? `${entry.title} — ` : ''}${entry.text}`);
        version.style.whiteSpace = 'pre-wrap';
        history.appendChild(version);
      });
      item.appendChild(history);
    }
    return item;
  }

  // Inline editor for the author's own post (title / category / body, by board rules).
  function openEditor(post, item) {
    const form = make('form', 'post-editor');
    form.setAttribute('aria-label', '글 수정');
    let category = null;
    const optionsFrom = id => [...$(id).options].map(option => option.value).filter(value => value !== 'all');
    if (post.board === 'voice' || post.board === 'research') {
      category = make('select');
      category.setAttribute('aria-label', '분류');
      optionsFrom(post.board === 'voice' ? 'voiceCategory' : 'researchType').forEach(value => {
        const option = make('option', '', value);
        option.value = value;
        category.appendChild(option);
      });
      category.value = post.category;
      form.appendChild(category);
    }
    let title = null;
    if (post.board === 'research') {
      title = make('input');
      title.type = 'text';
      title.maxLength = 120;
      title.value = post.title || '';
      title.setAttribute('aria-label', '글 제목');
      form.appendChild(title);
    }
    const text = make('textarea');
    text.value = post.text;
    text.maxLength = post.board === 'research' ? 50000 : post.board === 'policy' ? 3000 : 5000;
    text.setAttribute('aria-label', '글 내용');
    const status = make('p', 'form-status');
    status.setAttribute('role', 'status');
    const actions = make('div', 'post-controls');
    const note = make('span', 'label', '수정하면 "수정됨"으로 표시됩니다. 이전 내용은 신고 검토를 위해 운영자에게만 보관됩니다.');
    const buttons = make('div');
    buttons.style.display = 'flex';
    buttons.style.gap = '8px';
    const cancel = make('button', 'btn btn-outline', '취소');
    cancel.type = 'button';
    const save = make('button', 'submitPolicy', '수정 저장');
    save.type = 'submit';
    buttons.append(cancel, save);
    actions.append(note, buttons);
    form.append(text, actions, status);
    const original = [...item.childNodes];
    item.replaceChildren(form);
    text.focus();
    cancel.addEventListener('click', () => item.replaceChildren(...original));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!text.value.trim() || (title && !title.value.trim())) {
        status.textContent = title ? '제목과 내용을 입력해 주세요.' : '내용을 입력해 주세요.';
        status.dataset.error = 'true';
        return;
      }
      save.disabled = true;
      try {
        const result = await api('/api/board/edit', { postId: post.id, text: text.value, ...(title ? { title: title.value } : {}), ...(category ? { category: category.value } : {}) });
        state.posts[post.board] = state.posts[post.board].map(entry => entry.id === post.id ? result.post : entry);
        render(post.board);
        announce(post.board);
        setStatus(post.board, result.message);
        $(`post-${post.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (error) {
        status.textContent = error.message;
        status.dataset.error = 'true';
        save.disabled = false;
      }
    });
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
      announce(board);
      return;
    }
    try {
      const { posts } = await api(`/api/board?board=${board}`);
      state.posts[board] = posts;
      render(board);
      announce(board);
    } catch (error) {
      setStatus(board, error.message, true);
      announce(board);
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
    // Writing boxes stay open even before login so people can type or paste first;
    // the login check happens when they press the register button and the text is kept.
    for (const [input, button, placeholder] of controls) {
      input.disabled = false;
      button.disabled = false;
      input.placeholder = allowed ? placeholder : `${placeholder} (${hint})`;
    }
    const member = Boolean(state.user);
    researchLock.hidden = member;
    researchComposer.hidden = !member;
  }

  async function submit(board, payload, clear) {
    if (!canWrite()) {
      setStatus(board, `${writeHint()} 적은 내용은 그대로 남아 있으니 로그인 후 다시 등록을 눌러 주세요.`, true);
      if (!state.user) window.spaceOpenAuth?.('login');
      return;
    }
    try {
      const { post, message } = await api('/api/board/posts', { board, ...payload });
      state.posts[board].unshift(post);
      clear();
      render(board);
      announce(board);
      setStatus(board, message);
    } catch (error) {
      setStatus(board, error.message, true);
    }
  }

  // "붙여넣기" buttons: one tap pastes copied text (e.g. from 카카오톡 or 스페이스 톡) into the box.
  for (const [inputId, board] of [['communityInput', 'community'], ['voiceInput', 'voice'], ['researchInput', 'research']]) {
    const input = $(inputId);
    const paste = make('button', 'like-btn paste-btn', '붙여넣기');
    paste.type = 'button';
    paste.title = '복사한 글을 이 칸에 붙여넣기';
    paste.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (!text) { setStatus(board, '복사한 글이 없습니다. 먼저 붙여넣을 글을 복사해 주세요.', true); return; }
        const start = input.selectionStart ?? input.value.length;
        input.value = input.value.slice(0, start) + text + input.value.slice(input.selectionEnd ?? start);
        input.focus();
        setStatus(board, '붙여넣었습니다. 내용을 확인하고 등록해 주세요.');
      } catch {
        input.focus();
        setStatus(board, '이 브라우저는 버튼 붙여넣기를 막고 있어요. 글쓰기 칸을 길게 누르거나(휴대폰) Ctrl+V(PC)로 붙여넣어 주세요.', true);
      }
    });
    input.after(paste);
  }

  // A draft carried over from 스페이스 톡 ("게시판에 옮겨 쓰기").
  try {
    const draft = JSON.parse(sessionStorage.getItem('space-draft') || 'null');
    sessionStorage.removeItem('space-draft');
    const target = draft && { community: 'communityInput', voice: 'voiceInput', research: 'researchInput' }[draft.board];
    if (target && typeof draft.text === 'string') {
      $(target).value = draft.text.slice(0, 50000);
      setTimeout(() => {
        window.spaceShowSection?.(sections[draft.board], false);
        $(target).scrollIntoView({ behavior: 'smooth', block: 'center' });
        setStatus(draft.board, '스페이스 톡에서 옮겨 온 내용입니다. 확인하고 등록해 주세요.');
      }, 300);
    }
  } catch { /* storage unavailable or malformed draft */ }

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
  // The portal front page (portal.js) reads the loaded posts through this read-only view.
  function announce(board) {
    window.dispatchEvent(new CustomEvent('space-boards', { detail: { board } }));
  }
  window.spaceBoards = {
    posts: board => [...(state.posts[board] || [])],
    user: () => state.user,
    reload: board => load(board),
  };

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

// 칼럼·학술 '대법원 판결문'을 고르면 제목·개인정보 안내를 바꿔 보여 준다.
(() => {
  const type = document.getElementById('researchType');
  const hint = document.getElementById('researchHint');
  const title = document.getElementById('researchTitle');
  if (!type || !hint || !title) return;
  const base = { hint: hint.textContent, title: title.placeholder };
  const update = () => {
    const judgment = type.value === '대법원 판결문';
    hint.textContent = judgment ? '당사자 이름·주소 등 개인정보는 가려 주세요 (판결문 원문은 저작권 보호 대상이 아니지만 개인정보 보호는 지켜야 합니다)' : base.hint;
    title.placeholder = judgment ? '예: 대법원 2024. 5. 30. 선고 2023다12345 판결 — 핵심 쟁점 한 줄' : base.title;
  };
  type.addEventListener('change', update);
  update();
})();
