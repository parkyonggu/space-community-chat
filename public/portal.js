// 스페이스 커뮤니티 첫 화면(포털) 위젯: 최신 글·인기 제안·검색·공지·경제 지표·부동산·채팅 미리보기·레터·광고
(() => {
  // AdSense 광고 단위 번호 (애드센스 > 광고 > 광고 단위에서 만든 뒤 data-ad-slot 숫자를 넣으면 그 자리에 광고가 나옵니다.
  // 비워 두면 자리를 숨깁니다. 자동 광고를 켜면 번호 없이도 Google이 알맞은 위치에 광고를 넣습니다.)
  const AD_CLIENT = 'ca-pub-3255503954415485';
  const AD_SLOTS = { feed: '', side: '', bottom: '' };

  const DEPTS = { economy: '기획재정부', industry: '산업통상자원부', finance: '금융위원회', sme: '중소벤처기업부', education: '교육부',
    culture: '문화체육관광부', welfare: '보건복지부', labor: '고용노동부', gender: '여성가족부', environment: '환경부', foreign: '외교부',
    unification: '통일부', defense: '국방부', science: '과학기술정보통신부', landtransport: '국토교통부', agriculture: '농림축산식품부',
    ocean: '해양수산부', safety: '행정안전부', justice: '법무부', personnel: '인사혁신처' };
  const BOARD_LABEL = { community: '소통·나눔', voice: '시민의 소리', policy: '정책 제안', research: '칼럼·학술' };
  const BOARD_SECTION = { community: 'community-section', voice: 'voice-section', policy: 'policy-section', research: 'research-section' };
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  const $ = id => document.getElementById(id);
  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = text;
    return element;
  };
  const state = { feed: 'all', search: '', user: null, online: null };

  // ---------- helpers ----------
  function timeAgo(iso) {
    const diff = Date.now() - Date.parse(iso);
    if (!Number.isFinite(diff)) return '';
    if (diff < 60 * 1000) return '방금';
    if (diff < HOUR) return `${Math.floor(diff / 60000)}분 전`;
    if (diff < DAY) return `${Math.floor(diff / HOUR)}시간 전`;
    if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}일 전`;
    const date = new Date(iso);
    return `${date.getMonth() + 1}.${date.getDate()}`;
  }
  const clip = (text, max = 64) => {
    const line = String(text || '').replace(/\s+/g, ' ').trim();
    return line.length > max ? `${line.slice(0, max)}…` : line;
  };
  function titleOf(post) {
    if (post.title) return post.title;
    return clip(post.text);
  }
  function posts(board) {
    return window.spaceBoards ? window.spaceBoards.posts(board) : [];
  }
  function allPosts() {
    return ['community', 'voice', 'policy', 'research'].flatMap(board => posts(board).map(post => ({ ...post, board })))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
  function kstMidnight() {
    const kst = new Date(Date.now() + 9 * HOUR);
    return Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * HOUR;
  }
  const number = (value, digits) => Number(value).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

  // ---------- navigation to a post ----------
  function openPost(post) {
    const sectionId = BOARD_SECTION[post.board];
    if (post.board === 'research' && $('researchFilter')) {
      $('researchFilter').value = 'all';
      $('researchFilter').dispatchEvent(new Event('change'));
    }
    history.replaceState(null, '', `#${sectionId}`);
    if (window.spaceShowSection) window.spaceShowSection(sectionId, false);
    requestAnimationFrame(() => {
      const element = $(`post-${post.id}`);
      const target = element || $(sectionId);
      target.scrollIntoView({ behavior: 'smooth', block: element ? 'center' : 'start' });
      if (element) {
        element.classList.add('highlight');
        setTimeout(() => element.classList.remove('highlight'), 2600);
      }
    });
  }
  function goBoard(board) {
    const sectionId = BOARD_SECTION[board] || 'community-section';
    if (window.location.hash === `#${sectionId}`) window.spaceShowSection?.(sectionId);
    else window.location.hash = sectionId;
  }
  function requireLogin(action) {
    if (window.spaceAuth?.user) { action(); return; }
    window.spaceOpenAuth?.('login');
  }

  // ---------- latest-posts feed ----------
  const feedList = $('feed-list');
  function feedItems() {
    let items = allPosts();
    if (state.search) {
      const keyword = state.search.toLowerCase();
      items = items.filter(post => [post.title, post.text, post.category && DEPTS[post.category], post.category, post.authorName]
        .some(value => value && String(value).toLowerCase().includes(keyword)));
    } else if (state.feed !== 'all') {
      items = items.filter(post => post.board === state.feed);
    }
    return items.slice(0, state.search ? 20 : 8);
  }
  function renderFeed() {
    const ready = Boolean(window.spaceBoards);
    if (!ready) return;
    if (!state.search && state.feed === 'research' && !window.spaceAuth?.user) {
      const empty = make('li', 'feed-empty');
      empty.append('학술·논문·소고·이야기는 회원만 읽을 수 있습니다. ');
      const login = make('button', 'more-link', '로그인하고 보기 ›');
      login.type = 'button';
      login.addEventListener('click', () => window.spaceOpenAuth?.('login'));
      empty.appendChild(login);
      feedList.replaceChildren(empty);
      return;
    }
    const items = feedItems();
    if (!items.length) {
      feedList.replaceChildren(make('li', 'feed-empty', state.search ? `‘${state.search}’에 맞는 글이 없습니다.` : '아직 올라온 글이 없습니다. 첫 이야기를 남겨 주세요!'));
      return;
    }
    feedList.replaceChildren(...items.map(post => {
      const item = make('li', 'feed-item');
      const button = make('button', 'feed-link');
      button.type = 'button';
      button.appendChild(make('span', `badge ${post.board}`, BOARD_LABEL[post.board]));
      const title = make('span', 'feed-title', post.board === 'policy' && DEPTS[post.category] ? `[${DEPTS[post.category]}] ${titleOf(post)}` :
        post.board === 'voice' && post.category ? `[${post.category}] ${titleOf(post)}` : titleOf(post));
      button.appendChild(title);
      if (Date.now() - Date.parse(post.createdAt) < 6 * HOUR) button.appendChild(make('span', 'feed-new', 'N'));
      const meta = make('span', 'feed-meta');
      if (post.board === 'policy') meta.appendChild(make('span', 'likes', `♥ ${post.likes}`));
      meta.appendChild(make('span', 'author', clip(post.authorName, 10)));
      meta.appendChild(make('span', 'when', timeAgo(post.createdAt)));
      button.appendChild(meta);
      button.setAttribute('aria-label', `${BOARD_LABEL[post.board]}: ${title.textContent}, ${post.authorName}, ${timeAgo(post.createdAt)}`);
      button.addEventListener('click', () => openPost(post));
      item.appendChild(button);
      return item;
    }));
  }
  document.querySelectorAll('[data-feed]').forEach(chip => chip.addEventListener('click', () => {
    state.feed = chip.dataset.feed;
    clearSearch(false);
    document.querySelectorAll('[data-feed]').forEach(other => other.setAttribute('aria-selected', String(other === chip)));
    $('feed-more').textContent = state.feed === 'all' ? '게시판으로 가기 ›' : `${BOARD_LABEL[state.feed]} 게시판으로 가기 ›`;
    renderFeed();
  }));
  $('feed-more').addEventListener('click', () => goBoard(state.feed === 'all' ? 'community' : state.feed));

  // ---------- search ----------
  function clearSearch(render = true) {
    state.search = '';
    $('searchInput').value = '';
    $('search-note').replaceChildren();
    $('feed-title').textContent = '지금 올라온 글';
    document.querySelectorAll('[data-feed]').forEach(chip => chip.setAttribute('aria-selected', String(chip.dataset.feed === state.feed)));
    if (render) renderFeed();
  }
  $('searchForm').addEventListener('submit', event => {
    event.preventDefault();
    const keyword = $('searchInput').value.trim();
    if (!keyword) { clearSearch(); return; }
    state.search = keyword;
    $('feed-title').textContent = '검색 결과';
    document.querySelectorAll('[data-feed]').forEach(chip => chip.setAttribute('aria-selected', 'false'));
    renderFeed();
    const count = feedItems().length;
    const note = $('search-note');
    note.replaceChildren(`‘${keyword}’ 검색 결과 ${count}건${count >= 20 ? ' (최근 20건)' : ''} `);
    const reset = make('button', 'more-link', '검색 지우기');
    reset.type = 'button';
    reset.addEventListener('click', () => clearSearch());
    note.appendChild(reset);
    $('feed-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // ---------- ranking & voice ----------
  function renderRanking() {
    const list = $('rank-list');
    const since = Date.now() - 30 * DAY;
    let items = posts('policy').filter(post => Date.parse(post.createdAt) >= since);
    if (!items.length) items = posts('policy');
    items = items.sort((left, right) => right.likes - left.likes || right.createdAt.localeCompare(left.createdAt)).slice(0, 5);
    if (!items.length) {
      list.replaceChildren(make('li', 'feed-empty', '아직 정책 제안이 없습니다. 첫 제안을 남겨 주세요.'));
      return;
    }
    list.replaceChildren(...items.map((post, index) => {
      const item = make('li');
      const button = make('button', 'rank-link');
      button.type = 'button';
      button.append(make('span', 'rank-num', String(index + 1)), make('span', 'rank-dept', DEPTS[post.category] || ''), make('span', 'rank-title', titleOf(post)), make('span', 'rank-likes', `♥ ${post.likes}`));
      button.addEventListener('click', () => openPost({ ...post, board: 'policy' }));
      item.appendChild(button);
      return item;
    }));
  }
  function renderVoice() {
    const list = $('voice-list');
    const items = posts('voice').slice(0, 4);
    if (!items.length) {
      list.replaceChildren(make('li', 'feed-empty', '아직 등록된 시민의 소리가 없습니다.'));
      return;
    }
    list.replaceChildren(...items.map(post => {
      const item = make('li');
      const button = make('button', 'rank-link');
      button.type = 'button';
      const body = make('span', 'rank-title');
      body.style.whiteSpace = 'normal';
      body.append(make('span', 'voice-kind', post.category), make('span', '', clip(post.text, 48)));
      button.append(body, make('span', 'feed-meta', timeAgo(post.createdAt)));
      button.addEventListener('click', () => openPost({ ...post, board: 'voice' }));
      item.appendChild(button);
      return item;
    }));
  }

  // ---------- hero stats ----------
  function countUp(element, value, suffix = '') {
    // 0인 항목은 카드를 숨겨 빈 사이트처럼 보이지 않게 합니다.
    element.closest('.stat').hidden = !value;
    const previous = Number(element.dataset.value || 0);
    element.dataset.value = String(value);
    const start = performance.now();
    const step = now => {
      const progress = Math.min(1, (now - start) / 600);
      element.textContent = String(Math.round(previous + (value - previous) * progress));
      if (suffix) element.appendChild(make('small', '', suffix));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function renderStats() {
    const today = kstMidnight();
    const recent = allPosts();
    countUp($('stat-today'), recent.filter(post => Date.parse(post.createdAt) >= today).length, '건');
    countUp($('stat-policy'), posts('policy').filter(post => Date.now() - Date.parse(post.createdAt) < 7 * DAY).length, '건');
  }

  function renderBoards() {
    renderFeed();
    renderRanking();
    renderVoice();
    renderStats();
  }
  window.addEventListener('space-boards', () => {
    clearTimeout(renderBoards.timer);
    renderBoards.timer = setTimeout(renderBoards, 60);
  });

  // ---------- account box ----------
  function renderAccount(detail) {
    const user = detail?.user || null;
    state.user = user;
    // Came here from 스페이스 톡 to log in: go back once the login succeeds.
    if (user) {
      let next = null;
      try { next = sessionStorage.getItem('space-after-login'); sessionStorage.removeItem('space-after-login'); } catch { next = null; }
      if (next && /^\/chat(#[\w=-]*)?$/.test(next)) { location.href = next; return; }
      // 스페이스 톡 초대 링크로 가입한 사람: 인증을 마치고 로그인하면 그 대화방으로 보낸다.
      try {
        const pending = JSON.parse(localStorage.getItem('space-pending-invite') || 'null');
        if (pending && pending.until > Date.now() && (user.emailVerified || detail?.mailConfigured === false)) { location.href = '/chat'; return; }
      } catch { /* storage unavailable */ }
    }
    const actions = $('me-actions');
    if (!user) {
      $('me-title').textContent = '함께 이야기해요';
      $('me-text').textContent = '로그인하면 글쓰기, 정책 추천, 실시간 채팅에 참여할 수 있습니다.';
      const login = make('button', 'btn btn-primary', '로그인');
      login.type = 'button';
      login.addEventListener('click', () => window.spaceOpenAuth?.('login'));
      const row = make('div', 'row');
      const signup = make('button', 'btn btn-outline', '회원가입');
      const forgot = make('button', 'btn btn-outline', '비밀번호 찾기');
      signup.type = forgot.type = 'button';
      signup.addEventListener('click', () => window.spaceOpenAuth?.('signup'));
      forgot.addEventListener('click', () => window.spaceOpenAuth?.('forgot'));
      row.append(signup, forgot);
      actions.replaceChildren(login, row);
    } else {
      $('me-title').replaceChildren(make('span', 'me-name', user.nickname), '님, 반갑습니다');
      $('me-text').textContent = !user.emailVerified && detail?.mailConfigured ? '이메일 인증을 마치면 글쓰기와 채팅에 참여할 수 있습니다. 상단의 "인증 메일 보내기"를 눌러 주세요.' : '오늘은 어떤 이야기를 나눠 볼까요?';
      const write = make('button', 'btn btn-primary', '새 이야기 쓰기');
      write.type = 'button';
      write.addEventListener('click', () => focusComposer('community'));
      const row = make('div', 'row');
      const policy = make('button', 'btn btn-outline', '정책 제안하기');
      policy.type = 'button';
      policy.addEventListener('click', () => goBoard('policy'));
      const voice = make('button', 'btn btn-outline', '시민의 소리');
      voice.type = 'button';
      voice.addEventListener('click', () => focusComposer('voice'));
      row.append(policy, voice);
      const talk = make('a', 'btn btn-outline', '스페이스 톡 열기');
      talk.href = '/chat';
      actions.replaceChildren(write, row, talk);
      if (user.admin) {
        const admin = make('a', 'btn btn-outline', '뉴스레터 관리');
        admin.href = '/newsletter-admin';
        actions.appendChild(admin);
      }
    }
    renderFeed();
  }
  function focusComposer(board) {
    history.replaceState(null, '', `#${BOARD_SECTION[board]}`);
    window.spaceShowSection?.(BOARD_SECTION[board]);
    const input = $(board === 'voice' ? 'voiceInput' : 'communityInput');
    setTimeout(() => input?.focus({ preventScroll: true }), 450);
  }
  $('hero-write').addEventListener('click', () => requireLogin(() => focusComposer('community')));
  document.querySelectorAll('[data-auth-open]').forEach(button => button.addEventListener('click', () => window.spaceOpenAuth?.(button.dataset.authOpen)));
  window.addEventListener('space-auth', event => renderAccount(event.detail));
  if (window.spaceAuth) renderAccount(window.spaceAuth);

  // ---------- notice ticker ----------
  const notices = [...document.querySelectorAll('#ticker-items li')].map(item => ({ tag: item.dataset.tag, href: item.dataset.href, text: item.textContent }));
  let noticeIndex = 0;
  let noticeTimer;
  function showNotice(index) {
    noticeIndex = (index + notices.length) % notices.length;
    const notice = notices[noticeIndex];
    $('ticker-tag').textContent = notice.tag;
    const link = make('a', '', notice.text);
    link.href = notice.href;
    const box = $('ticker-text');
    box.classList.remove('swap');
    void box.offsetWidth;
    box.classList.add('swap');
    box.replaceChildren(link);
    $('ticker-pos').textContent = `${noticeIndex + 1} / ${notices.length}`;
  }
  function startTicker() {
    clearInterval(noticeTimer);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) noticeTimer = setInterval(() => showNotice(noticeIndex + 1), 5000);
  }
  if (notices.length) {
    showNotice(0);
    startTicker();
    $('ticker-next').addEventListener('click', () => { showNotice(noticeIndex + 1); startTicker(); });
    $('ticker-prev').addEventListener('click', () => { showNotice(noticeIndex - 1); startTicker(); });
    const ticker = $('ticker');
    ticker.addEventListener('mouseenter', () => clearInterval(noticeTimer));
    ticker.addEventListener('mouseleave', startTicker);
    ticker.addEventListener('focusin', () => clearInterval(noticeTimer));
    ticker.addEventListener('focusout', startTicker);
  }

  // ---------- indicators, housing, chat head count ----------
  function dateLabel(time) {
    if (!time) return '';
    return time.length === 8 ? `${Number(time.slice(4, 6))}/${Number(time.slice(6, 8))}` : `${Number(time.slice(4, 6))}월`;
  }
  function deltaOf(item) {
    if (item.changePercent !== undefined) {
      const value = item.changePercent;
      return { text: `${value > 0 ? '▲' : value < 0 ? '▼' : ''}${number(Math.abs(value), item.id === 'dubai' || item.id === 'gold' ? 1 : 2)}%`, cls: value > 0 ? 'up' : value < 0 ? 'down' : 'flat' };
    }
    if (item.change !== undefined) {
      const value = item.change;
      const digits = item.changeUnit === '%p' ? 3 : item.digits;
      return { text: `${value > 0 ? '▲' : value < 0 ? '▼' : ''}${number(Math.abs(value), digits)}${item.changeUnit || ''}`, cls: value > 0 ? 'up' : value < 0 ? 'down' : 'flat' };
    }
    return { text: '', cls: 'flat' };
  }
  const lastValues = {};
  function renderIndicators(data) {
    const box = $('eco-list');
    if (!data?.items?.length) {
      box.replaceChildren(make('p', 'feed-empty', '지표를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.'));
      $('eco-updated').textContent = '';
      return;
    }
    const today = data.today || '';
    $('eco-updated').textContent = today ? `${dateLabel(today)} 조회 · 항목별 최신 발표` : '';
    box.replaceChildren(...data.items.map(item => {
      const row = make('div', 'indicator');
      const name = make('span', 'name', item.name);
      const when = item.date ? (item.date.length === 6 ? dateLabel(item.date) : item.date === today ? '오늘' : dateLabel(item.date)) : '';
      const closing = item.id === 'kospi' || item.id === 'kosdaq' ? ' 종가' : '';
      const meta = [item.note, when ? `${when}${closing}` : ''].filter(Boolean).join(' · ');
      if (meta) name.appendChild(make('small', '', meta));
      const figure = make('span', 'figure');
      if (item.value === null || item.value === undefined) {
        figure.appendChild(make('span', 'delta flat', '자료 없음'));
      } else {
        const delta = deltaOf(item);
        const value = make('span', 'value', `${number(item.value, item.digits)}${item.unit === '%' ? '%' : ''}`);
        if (item.unit === '원' || item.unit === '달러') value.appendChild(make('small', '', item.unit));
        figure.append(value, make('span', `delta ${delta.cls}`, delta.text));
        if (lastValues[item.id] !== undefined && lastValues[item.id] !== item.value) row.classList.add('flash');
        lastValues[item.id] = item.value;
      }
      row.append(name, figure);
      return row;
    }));
  }
  // 국내 증시: 같은 지표를 옆으로 흐르는 띠로 보여 준다(전 거래일 종가).
  function renderKrTape(data) {
    const tape = $('kr-tape');
    if (!tape) return;
    const wanted = ['kospi', 'kosdaq', 'usdkrw', 'ktb3y'];
    const items = (data?.items || []).filter(item => wanted.includes(item.id) && item.value !== null && item.value !== undefined);
    if (!items.length) { if (!tape.dataset.sig) tape.replaceChildren(make('span', 'feed-empty', '국내 증시 자료를 불러오는 중입니다.')); return; }
    const sig = items.map(item => `${item.id}:${item.value}:${item.date}`).join('|');
    if (tape.dataset.sig === sig) return; // 값이 그대로면 흐름이 끊기지 않게 다시 그리지 않는다
    tape.dataset.sig = sig;
    const cell = item => {
      const box = make('div', 'kr-item');
      const delta = deltaOf(item);
      const pct = item.changePercent !== undefined && item.change !== undefined ? ` (${item.change > 0 ? '+' : ''}${number(item.change, item.digits)})` : '';
      box.append(make('span', 'n', `${item.name} · ${dateLabel(item.date)}`), make('span', 'v', `${number(item.value, item.digits)}${item.unit === '%' ? '%' : item.unit === '원' ? '원' : ''}`), make('span', `c ${delta.cls}`, `${delta.text}${pct}`));
      return box;
    };
    const track = make('div', 'kr-track');
    // 끊김 없이 흐르도록 같은 묶음을 두 번(폭이 좁으면 네 번) 이어 붙인다.
    const copies = 4;
    for (let index = 0; index < copies; index += 1) items.forEach(item => {
      const node = cell(item);
      if (index > 0) node.setAttribute('aria-hidden', 'true');
      track.appendChild(node);
    });
    tape.replaceChildren(track);
  }
  function renderHousing(data) {
    const body = $('house-body');
    if (!data?.series?.length) {
      $('house-week').textContent = '';
      body.replaceChildren(make('p', 'feed-empty', '이번 주 자료를 준비하고 있습니다. 한국부동산원 발표 후 자동으로 표시됩니다.'));
      return;
    }
    const md = text => text ? `${Number(text.slice(4, 6))}/${Number(text.slice(6, 8))}` : '';
    $('house-week').textContent = `${data.week} 기준${data.nextRelease ? ` · 다음 발표 ${md(data.nextRelease)}(목)` : ''}`;
    const table = make('table', 'housing-table');
    const head = make('tr');
    head.appendChild(make('th', '', '지역'));
    data.series.forEach(series => head.appendChild(make('th', '', series.label)));
    const thead = make('thead');
    thead.appendChild(head);
    const tbody = make('tbody');
    const regions = [...new Set(data.series.flatMap(series => series.regions.map(entry => entry.region)))];
    regions.forEach(region => {
      const row = make('tr');
      row.appendChild(make('td', '', region));
      data.series.forEach(series => {
        const entry = series.regions.find(value => value.region === region);
        const change = entry?.change;
        row.appendChild(make('td', change > 0 ? 'up' : change < 0 ? 'down' : 'flat', change === undefined ? '–' : `${change > 0 ? '+' : change < 0 ? '−' : ''}${number(Math.abs(change), 2)}%`));
      });
      tbody.appendChild(row);
    });
    table.append(thead, tbody);
    body.replaceChildren(table);
  }
  // ---------- 미국 증시: TradingView 무료 위젯(화면에 보일 때만 불러옴) ----------
  (function usMarket() {
    const box = $('us-ticker');
    if (!box) return;
    const load = () => {
      if (box.dataset.loaded) return;
      box.dataset.loaded = '1';
      const script = document.createElement('script');
      script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js';
      script.async = true;
      script.text = JSON.stringify({
        symbols: [
          { proName: 'FOREXCOM:NSXUSD', title: '나스닥 100' },
          { proName: 'FOREXCOM:SPXUSD', title: 'S&P 500' },
          { proName: 'NYSE:NYA', title: 'NYSE 종합' },
          { proName: 'FOREXCOM:DJI', title: '다우존스' },
        ],
        showSymbolLogo: false, isTransparent: true, displayMode: 'compact', colorTheme: 'light', locale: 'kr',
      });
      box.appendChild(script);
    };
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); load(); } }, { rootMargin: '200px' });
      observer.observe(box);
    } else load();
  })();

  // ---------- 오늘의 부동산 동향 (국토교통부 실거래가) ----------
  let realestate = null;
  let reTab = 'apt';
  function won(manwon) {
    if (!Number.isFinite(manwon)) return '–';
    const eok = Math.floor(manwon / 10000);
    const rest = Math.round(manwon % 10000);
    if (!eok) return `${number(rest, 0)}만`;
    return rest ? `${eok}억 ${number(rest, 0)}만` : `${eok}억`;
  }
  function perArea(wonPerSquareMeter) {
    if (!Number.isFinite(wonPerSquareMeter)) return '–';
    return wonPerSquareMeter >= 10000 ? `㎡당 ${number(wonPerSquareMeter / 10000, 1)}만원` : `㎡당 ${number(wonPerSquareMeter, 0)}원`;
  }
  const md = text => `${Number(text.slice(4, 6))}/${Number(text.slice(6, 8))}`;
  function renderRealEstate(data) {
    if (data !== undefined) realestate = data;
    const body = $('re-body');
    const panel = $('realestate-panel');
    if (!realestate) {
      body.replaceChildren(make('p', 'feed-empty', '실거래가 자료를 연결하고 있습니다. 잠시 후 자동으로 표시됩니다.'));
      return;
    }
    $('re-range').textContent = `${md(realestate.from)}~${md(realestate.to)} 계약 · 최근 30일 신고분`;
    panel.querySelectorAll('[data-re]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.re === reTab)));
    const category = realestate.categories?.find(item => item.id === reTab);
    if (!category || !category.count) {
      const waiting = realestate.coverage && realestate.coverage.ready < realestate.coverage.total;
      const message = realestate.problems?.length && !realestate.coverage?.ready
        ? '실거래가 자료를 받아 오지 못했습니다. 운영자가 확인하고 있습니다.'
        : waiting ? `자료를 모으는 중입니다 (${realestate.coverage.ready}/${realestate.coverage.total}). 몇 분 뒤 다시 확인해 주세요.` : '최근 30일 안에 신고된 거래가 없습니다.';
      body.replaceChildren(make('p', 'feed-empty', message));
      return;
    }
    const isArea = category.metric === 'perSquareMeter';
    const grid = make('div', 're-grid');
    const left = make('div');
    const sum = make('p', 're-sum');
    sum.append(make('span', '', `${category.label} 거래`), make('strong', '', `${number(category.count, 0)}건`), make('span', '', `· ${category.regions.length}개 지역`));
    const table = make('table', 're-table');
    const head = make('tr');
    head.append(make('th', '', '지역'), make('th', '', '건수'), make('th', '', isArea ? '㎡당 가격(중간값)' : '거래가(중간값)'));
    const thead = make('thead');
    thead.appendChild(head);
    const tbody = make('tbody');
    category.regions.slice(0, 8).forEach(region => {
      const row = make('tr');
      row.append(make('td', '', region.name), make('td', 'count', `${region.count}건`), make('td', '', isArea ? perArea(region.median).replace('㎡당 ', '') : won(region.median)));
      tbody.appendChild(row);
    });
    table.append(thead, tbody);
    left.append(sum, table);
    const right = make('div', 're-recent');
    right.appendChild(make('h3', '', '최근 계약된 거래'));
    const list = make('ul');
    category.recent.forEach(deal => {
      const item = make('li');
      const what = make('span', 'what');
      const title = category.id === 'apt' ? `${deal.name}` : category.id === 'bldg' ? `${deal.name || '건물'}` : `${deal.name} ${number(deal.area, 0)}㎡`;
      what.append(document.createTextNode(title), make('small', '', `${md(deal.date)} · ${deal.region} ${deal.dong}${category.id === 'apt' ? ` · ${number(deal.area, 0)}㎡ ${deal.floor ? `${deal.floor}층` : ''}` : category.id === 'bldg' && deal.area ? ` · 연면적 ${number(deal.area, 0)}㎡` : ''}`));
      const price = make('span', 'price', won(deal.amount));
      if (isArea && deal.area) price.appendChild(make('small', '', perArea((deal.amount * 10000) / deal.area)));
      item.append(what, price);
      list.appendChild(item);
    });
    right.appendChild(list);
    grid.append(left, right);
    const nodes = [grid];
    if (realestate.coverage && realestate.coverage.ready < realestate.coverage.total) nodes.push(make('p', 're-note', `자료를 모으는 중입니다 (${realestate.coverage.ready}/${realestate.coverage.total}). 곧 모든 지역이 반영됩니다.`));
    body.replaceChildren(...nodes);
  }
  $('realestate-panel').querySelectorAll('[data-re]').forEach(button => button.addEventListener('click', () => { reTab = button.dataset.re; renderRealEstate(); }));

  // ---------- 스페이스 레터: 구독을 마친 브라우저에서는 '구독 신청' 안내를 감춘다 ----------
  (function letterSubscribed() {
    let done = null;
    try { done = localStorage.getItem('space-letter-subscribed'); } catch { done = null; }
    if (!done) return;
    const box = document.querySelector('.sub-box');
    if (box) {
      box.classList.add('done');
      $('sub-title').textContent = '스페이스 레터 구독 중';
      box.querySelector('p').textContent = '매주 월요일 아침 7시에 경제·정책 브리핑을 메일로 보내 드립니다. 지난 레터도 언제든 다시 읽을 수 있어요.';
      const go = $('sub-go');
      go.textContent = '지난 레터 보기';
      go.href = '/letter';
    }
    document.querySelectorAll('[data-letter-cta]').forEach(link => { link.textContent = '지난 레터 보기'; link.href = '/letter'; });
    const note = $('letter-subscribed');
    if (note) note.hidden = false;
    const title = $('newsletter-title');
    if (title) title.textContent = '스페이스 레터 (구독 중)';
  })();

  // ---------- 오늘의 정책브리핑 ----------
  let policyData;
  let pbTab = 'news';
  function renderPolicy(data) {
    if (data !== undefined) policyData = data;
    const list = $('pb-list');
    if (!list) return;
    $('policy-panel').querySelectorAll('[data-pb]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.pb === pbTab)));
    const items = (policyData?.items || []).filter(item => {
      const fact = item.kind === 'fact';
      if (pbTab === 'fact') return fact;
      if (pbTab === 'economy') return !fact && item.economy;
      return !fact;
    });
    if (!policyData) { list.replaceChildren(make('li', 'feed-empty', '정책브리핑 자료를 연결하고 있습니다. 곧 자동으로 표시됩니다.')); return; }
    if (!items.length) { list.replaceChildren(make('li', 'feed-empty', ({ news: '오늘 새로 올라온 정책뉴스가 아직 없습니다.', economy: '오늘은 경제·금융·부동산 분야 정책뉴스가 아직 없습니다.', fact: '최근 이틀 동안 올라온 \'사실은 이렇습니다\'(보도 설명 자료)가 없습니다.' })[pbTab])); return; }
    const when = at => {
      if (!at) return '';
      const date = new Date(at);
      const today = new Date().toDateString() === date.toDateString();
      return today ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : `${date.getMonth() + 1}/${date.getDate()}`;
    };
    list.replaceChildren(...items.slice(0, 8).map(item => {
      const li = make('li');
      const link = make('a');
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.append(make('span', `d${item.economy ? ' eco' : ''}`, item.dept), make('span', 't', item.title), make('span', 'w', when(item.at)));
      if (item.sub) link.appendChild(make('span', 's', item.sub));
      li.appendChild(link);
      return li;
    }));
  }
  // 메뉴의 '정책브리핑'을 누르면 상자로 부드럽게 내려가 잠시 강조한다.
  document.querySelectorAll('a[href="#policy-panel"]').forEach(link => link.addEventListener('click', event => {
    const panel = $('policy-panel');
    if (!panel) return;
    event.preventDefault();
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    panel.classList.add('flash-target');
    setTimeout(() => panel.classList.remove('flash-target'), 1600);
  }));
  $('policy-panel')?.querySelectorAll('[data-pb]').forEach(button => button.addEventListener('click', () => { pbTab = button.dataset.pb; renderPolicy(); }));

  function renderOnline(count) {
    state.online = count;
    const known = Number.isFinite(count);
    $('chat-online').textContent = known ? `${count}명 접속` : '접속 확인 중';
    const badge = $('nav-online');
    badge.hidden = !known || count < 1;
    badge.textContent = known ? String(count) : '';
    if (known) countUp($('stat-online'), count, '명');
  }
  async function refreshPortal() {
    try {
      const response = await fetch('/api/portal', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      renderIndicators(data.indicators);
      renderKrTape(data.indicators);
      renderHousing(data.housing);
      renderRealEstate(data.realestate);
      renderPolicy(data.policy);
      renderOnline(data.online);
    } catch (error) {
      console.error('Portal data failed:', error);
      if (!$('eco-list').querySelector('.indicator')) renderIndicators(null);
      if (!$('house-body').querySelector('table')) renderHousing(null);
      if (!realestate) renderRealEstate(null);
    }
  }
  refreshPortal();
  setInterval(() => { if (document.visibilityState === 'visible') refreshPortal(); }, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshPortal(); });

  // ---------- live chat preview (mirrors the chat room on this page) ----------
  const chatBox = $('chatBox');
  function renderChatPreview() {
    const messages = [...chatBox.querySelectorAll('.chat-message')].slice(-3);
    const list = $('chat-lines');
    if (!messages.length) {
      list.replaceChildren(make('li', 'empty', '새 대화가 오면 여기에 바로 보입니다. 대화는 누구나 볼 수 있고, 메시지는 회원만 보낼 수 있습니다.'));
      return;
    }
    list.replaceChildren(...messages.map(message => {
      const item = make('li');
      const name = message.dataset.name;
      if (name) {
        const who = make('strong', '', `${name}: `);
        if (message.style.getPropertyValue('--who')) who.style.color = message.style.getPropertyValue('--who');
        item.appendChild(who);
      }
      item.append(message.querySelector('.chat-text')?.textContent ?? message.textContent);
      return item;
    }));
  }
  if (chatBox) new MutationObserver(renderChatPreview).observe(chatBox, { childList: true });

  // ---------- newsletter archive ----------
  function nextMonday() {
    const kst = new Date(Date.now() + 9 * HOUR);
    const add = ((8 - kst.getUTCDay()) % 7) || (kst.getUTCHours() < 7 ? 0 : 7);
    const target = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + add));
    return `${target.getUTCMonth() + 1}월 ${target.getUTCDate()}일(월)`;
  }
  async function loadLetters() {
    const list = $('letter-list');
    try {
      const response = await fetch('/api/newsletter/archive', { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      const { letters } = await response.json();
      if (!letters.length) {
        list.replaceChildren(make('li', 'letter-empty', `첫 레터는 ${nextMonday()} 아침 7시에 발행됩니다. 지금 구독하면 바로 받아 보실 수 있습니다.`));
        return;
      }
      list.replaceChildren(...letters.slice(0, 4).map(letter => {
        const item = make('li');
        const link = make('a');
        link.href = `/letter?id=${encodeURIComponent(letter.id)}`;
        const date = new Date(letter.sentAt);
        link.append(make('span', 'date', `${date.getMonth() + 1}.${String(date.getDate()).padStart(2, '0')}`), make('span', 'subject', letter.subject.replace(/^스페이스 레터 · /, '')));
        item.appendChild(link);
        return item;
      }));
    } catch (error) {
      console.error('Letter archive failed:', error);
      list.replaceChildren(make('li', 'letter-empty', '지난 레터를 불러오지 못했습니다.'));
    }
  }
  loadLetters();
  $('sub-go').addEventListener('click', () => setTimeout(() => $('newsletter-email')?.focus({ preventScroll: true }), 500));

  // ---------- ad boxes: AdSense when a unit number is set, otherwise our own notices (house ads) ----------
  // 승인 전이거나 Google이 광고를 채우지 못하면(unfilled) 같은 자리에 사이트 안내 배너가 돌아가며 나옵니다.
  const HOUSE_ADS = [
    { kicker: '스페이스 레터', title: '매주 월요일 아침 7시, 경제·정책 브리핑', text: '한국은행·한국부동산원 공식 통계로 정리한 지표와 이번 주 정책을 무료로 받아 보세요.', cta: '무료 구독하기', href: '#newsletter-section', icon: 'mail' },
    { kicker: '정책비평·제안', title: '우리 동네를 바꾸는 한 줄 제안', text: '20개 부처별로 의견을 남기고, 공감하는 제안에 추천을 눌러 주세요.', cta: '제안하러 가기', href: '#policy-section', icon: 'idea' },
    { kicker: '스페이스 톡', title: '회원끼리 나누는 단체 대화방', text: '모임방을 만들고 초대 링크 하나로 함께 이야기해요. 새 메시지 알림도 받을 수 있어요.', cta: '대화방 열기', href: '/chat', icon: 'chat' },
    { kicker: '지난 레터', title: '지난 경제·정책 브리핑 모아 보기', text: '발행된 스페이스 레터를 누구나 다시 읽을 수 있습니다.', cta: '레터 보기', href: '/letter', icon: 'book' },
    { kicker: '학술·논문·소고', title: '칼럼·서평·짧은 이야기를 나눠요', text: '회원이 쓴 생각의 단상과 연구를 유형별로 모아 읽는 공간입니다.', cta: '둘러보기', href: '#research-section', icon: 'pen' },
  ];
  const ICONS = {
    mail: '<path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/>',
    idea: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    chat: '<path d="M4 5h16v10H9l-5 4z"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M8 7h7"/>',
    pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
  };
  function houseAd(container, offset) {
    container.querySelector('.house-ad')?.remove();
    container.querySelector('.ad-label').textContent = '스페이스 커뮤니티 안내';
    const box = make('div', 'house-ad');
    let index = offset % HOUSE_ADS.length;
    const render = () => {
      const ad = HOUSE_ADS[index];
      const link = make('a', 'house-ad-card');
      link.href = ad.href;
      const icon = make('span', 'house-ad-icon');
      icon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[ad.icon]}</svg>`;
      const copy = make('span', 'house-ad-copy');
      copy.append(make('span', 'house-ad-kicker', ad.kicker), make('strong', 'house-ad-title', ad.title), make('span', 'house-ad-text', ad.text));
      link.append(icon, copy, make('span', 'house-ad-cta', `${ad.cta} ›`));
      box.replaceChildren(link);
      const dots = make('span', 'house-ad-dots');
      dots.setAttribute('aria-hidden', 'true');
      HOUSE_ADS.forEach((_, dot) => dots.appendChild(make('i', dot === index ? 'on' : '')));
      box.appendChild(dots);
    };
    render();
    container.appendChild(box);
    container.hidden = false;
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      let paused = false;
      container.addEventListener('mouseenter', () => { paused = true; });
      container.addEventListener('mouseleave', () => { paused = false; });
      setInterval(() => { if (!paused && document.visibilityState === 'visible') { index = (index + 1) % HOUSE_ADS.length; render(); } }, 7000);
    }
  }
  document.querySelectorAll('.ad-slot[data-ad]').forEach((container, offset) => {
    const slot = AD_SLOTS[container.dataset.ad];
    if (!slot) { houseAd(container, offset * 2); return; }
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.dataset.adClient = AD_CLIENT;
    ins.dataset.adSlot = slot;
    ins.dataset.adFormat = 'auto';
    ins.dataset.fullWidthResponsive = 'true';
    container.appendChild(ins);
    container.hidden = false;
    // Google marks a unit it could not fill with data-ad-status="unfilled": show our notice in its place.
    new MutationObserver(() => {
      if (ins.dataset.adStatus === 'unfilled') { ins.remove(); houseAd(container, offset * 2); }
    }).observe(ins, { attributes: true, attributeFilter: ['data-ad-status'] });
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (error) { console.error('AdSense push failed:', error); houseAd(container, offset * 2); }
  });

  if (window.spaceBoards) renderBoards();
})();
