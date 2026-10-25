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
  // page: '지금 올라온 글' 쪽 번호(한 쪽 5개). 서버가 보낸 첫 화면(/?page=N)과 같은 쪽에서 시작한다.
  const state = { feed: 'all', search: '', user: null, online: null, page: Number(new URLSearchParams(location.search).get('page')) || 1 };
  const FEED_PAGE_SIZE = 5;

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
    // 글 페이지 제목과 같게: 첫 줄을 감싼 따옴표·별표·[대괄호]를 떼어 낸다.
    const first = String(post.text || '').split('\n').map(line => line.trim()).find(Boolean) || '';
    const cleaned = (/^\[[^\]]+\]$/.test(first) ? first.slice(1, -1) : !/^["'“‘*]/.test(first) ? first : first.replace(/^["'“”‘’*\s]+|["'“”‘’*\s]+$/g, ''))
      .replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    return clip(cleaned || post.text);
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

  function matcher(keyword) {
    const words = String(keyword).toLowerCase().split(/\s+/).filter(Boolean);
    return post => {
      const haystack = [post.title, post.text, post.category && DEPTS[post.category], post.category, post.authorName, post.no && `#${post.no}`]
        .filter(Boolean).join('\n').toLowerCase();
      return words.every(word => haystack.includes(word));
    };
  }

  // ---------- latest-posts feed ----------
  const feedList = $('feed-list');
  function feedItems() {
    let items = allPosts();
    if (state.search) {
      // 띄어 쓴 낱말이 모두 들어간 글을 찾는다(제목·본문·분류·글쓴이·글번호 #57).
      items = items.filter(matcher(state.search));
    } else if (state.feed !== 'all') {
      items = items.filter(post => post.board === state.feed);
    }
    return items;
  }
  // 페이지 번호(post-page.js의 게시판 목록 페이지와 같은 모양): 처음·끝 쪽과 지금 쪽 앞뒤 2쪽
  const feedPager = $('feed-pager');
  function feedPageUrl(number) {
    if (state.search) return '#latest-section';
    if (state.feed !== 'all') return `/board/${state.feed}${number > 1 ? `?page=${number}` : ''}`;
    return `/${number > 1 ? `?page=${number}` : ''}#latest-section`;
  }
  function renderFeedPager(page, pages) {
    if (pages <= 1) { feedPager.replaceChildren(); return; }
    const link = (number, label, rel) => {
      const anchor = make('a', '', label);
      anchor.href = feedPageUrl(number);
      anchor.dataset.page = number;
      if (rel) anchor.rel = rel;
      else anchor.setAttribute('aria-label', `${number}쪽`);
      return anchor;
    };
    const numbers = [...new Set([1, page - 2, page - 1, page, page + 1, page + 2, pages])].filter(number => number >= 1 && number <= pages);
    const parts = [];
    if (page > 1) parts.push(link(page - 1, '‹ 이전', 'prev'));
    numbers.forEach((number, index) => {
      if (index && number - numbers[index - 1] > 1) parts.push(make('span', 'gap', '…'));
      if (number === page) { const current = make('span', '', String(number)); current.setAttribute('aria-current', 'page'); parts.push(current); }
      else parts.push(link(number, String(number)));
    });
    if (page < pages) parts.push(link(page + 1, '다음 ›', 'next'));
    feedPager.replaceChildren(...parts);
  }
  feedPager.addEventListener('click', event => {
    const anchor = event.target.closest('a[data-page]');
    if (!anchor || event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1) return;
    event.preventDefault();
    state.page = Number(anchor.dataset.page);
    renderFeed();
    const top = $('feed-title').getBoundingClientRect().top;
    if (top < 0) $('feed-title').scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  function renderFeed() {
    const ready = Boolean(window.spaceBoards);
    if (!ready) return;
    const all = feedItems();
    const pages = Math.max(1, Math.ceil(all.length / FEED_PAGE_SIZE));
    // 게시판 글을 다 불러오기 전에는 쪽 수가 모자랄 수 있어, 고른 쪽(state.page)은 그대로 두고 보여 줄 쪽만 맞춘다.
    const page = Math.min(Math.max(1, Math.floor(state.page) || 1), pages);
    const items = all.slice((page - 1) * FEED_PAGE_SIZE, page * FEED_PAGE_SIZE);
    renderFeedPager(page, pages);
    if (!items.length) {
      feedList.replaceChildren(make('li', 'feed-empty', state.search ? `‘${state.search}’에 맞는 글이 없습니다.` : '아직 올라온 글이 없습니다. 첫 이야기를 남겨 주세요!'));
      return;
    }
    // 새로 올라온 글은 잠깐 빛나게, 탭을 바꿨을 때는 위에서부터 차례로 나타나게 한다
    const seen = feedList.dataset.ids ? new Set(feedList.dataset.ids.split(',')) : null;
    const sameTab = feedList.dataset.tab === `${state.feed}|${state.search}|${page}`;
    feedList.dataset.ids = items.map(post => post.id).join(',');
    feedList.dataset.tab = `${state.feed}|${state.search}|${page}`;
    feedList.replaceChildren(...items.map((post, index) => {
      const item = make('li', 'feed-item');
      if (!sameTab) { item.classList.add('enter'); item.style.setProperty('--i', index); }
      else if (seen && !seen.has(String(post.id))) item.classList.add('fresh');
      // 공개 글은 진짜 링크(/post/번호)로: 검색엔진이 따라가고, 새 탭으로 열 수도 있다. 보통 클릭은 지금처럼 게시판에서 연다.
      const linkable = Boolean(post.no);
      const button = make(linkable ? 'a' : 'button', 'feed-link');
      if (linkable) button.href = `/post/${post.no}`;
      else button.type = 'button';
      button.appendChild(make('span', `badge ${post.board}`, BOARD_LABEL[post.board]));
      const title = make('span', 'feed-title', post.board === 'policy' && DEPTS[post.category] ? `[${DEPTS[post.category]}] ${titleOf(post)}` :
        titleOf(post)); // 시민의 소리 분류는 글 페이지에서 보여 주고, 목록에서는 제목이 먼저 보이게 한다.
      button.appendChild(title);
      if (Date.now() - Date.parse(post.createdAt) < 6 * HOUR) button.appendChild(make('span', 'feed-new', 'N'));
      const meta = make('span', 'feed-meta');
      if (post.board === 'policy') meta.appendChild(make('span', 'likes', `♥ ${post.likes}`));
      if (post.no) meta.appendChild(make('span', 'post-no', `#${post.no}`));
      meta.appendChild(make('span', 'author', clip(post.authorName, 10)));
      meta.appendChild(make('span', 'when', timeAgo(post.createdAt)));
      button.appendChild(meta);
      button.setAttribute('aria-label', `${BOARD_LABEL[post.board]}: ${title.textContent}, ${post.authorName}, ${timeAgo(post.createdAt)}`);
      button.addEventListener('click', event => {
        if (linkable && (event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1)) return;
        event.preventDefault();
        openPost(post);
      });
      item.appendChild(button);
      return item;
    }));
  }
  document.querySelectorAll('[data-feed]').forEach(chip => chip.addEventListener('click', () => {
    state.feed = chip.dataset.feed;
    state.page = 1;
    clearSearch(false);
    document.querySelectorAll('[data-feed]').forEach(other => other.setAttribute('aria-selected', String(other === chip)));
    $('feed-more').textContent = state.feed === 'all' ? '소통·나눔 광장에서 글쓰기 ›' : `${BOARD_LABEL[state.feed]} 전체 보기 ›`;
    renderFeed();
  }));
  $('feed-more').addEventListener('click', () => goBoard(state.feed === 'all' ? 'community' : state.feed));

  // ---------- search ----------
  function clearSearch(render = true) {
    if (state.search) state.page = 1;
    state.search = '';
    $('searchInput').value = '';
    $('search-note').replaceChildren();
    $('feed-title').textContent = '지금 올라온 글';
    $('feed-title').classList.remove('searching');
    document.querySelectorAll('[data-feed]').forEach(chip => chip.setAttribute('aria-selected', String(chip.dataset.feed === state.feed)));
    if (render) renderFeed();
  }
  // ---------- 검색어를 적는 동안 맞는 글의 제목·내용 일부를 바로 아래에 보여 준다 ----------
  const suggest = make('div', 'search-suggest');
  suggest.id = 'search-suggest';
  suggest.setAttribute('role', 'listbox');
  suggest.hidden = true;
  document.body.appendChild(suggest);
  $('searchInput').setAttribute('aria-controls', 'search-suggest');
  let suggestIndex = -1;
  function hideSuggest() { suggest.hidden = true; suggestIndex = -1; }
  function placeSuggest() {
    const box = $('searchForm').getBoundingClientRect();
    suggest.style.left = `${Math.max(8, box.left)}px`;
    suggest.style.top = `${box.bottom + 6}px`;
    suggest.style.width = `${Math.min(box.width, window.innerWidth - 16)}px`;
  }
  function snippetOf(post, keyword) {
    const text = (window.spaceRichText ? window.spaceRichText.plain(post.text || '') : String(post.text || '')).replace(/\s+/g, ' ').trim();
    const word = String(keyword).toLowerCase().split(/\s+/).filter(Boolean).find(item => text.toLowerCase().includes(item));
    const at = word ? text.toLowerCase().indexOf(word) : 0;
    const start = Math.max(0, at - 20);
    return `${start ? '…' : ''}${text.slice(start, start + 70)}${text.length > start + 70 ? '…' : ''}`;
  }
  function mark(element, text, keyword) {
    const words = String(keyword).toLowerCase().split(/\s+/).filter(Boolean);
    const lower = text.toLowerCase();
    let index = 0;
    while (index < text.length) {
      let best = -1, size = 0;
      for (const word of words) { const at = lower.indexOf(word, index); if (at !== -1 && (best === -1 || at < best)) { best = at; size = word.length; } }
      if (best === -1) { element.append(text.slice(index)); break; }
      element.append(text.slice(index, best), make('mark', '', text.slice(best, best + size)));
      index = best + size;
    }
    return element;
  }
  // 검색어가 사이트의 정보 메뉴와 관련 있으면 글 목록 위에 '바로가기'로 그 메뉴를 함께 보여 준다.
  const SHORTCUTS = [
    { href: '#pension-panel', icon: '👵', name: '국민연금 정보', where: '우리동네 혜택 › 국민연금', words: ['국민연금', '연금', '노령연금', '기초연금', '노후', '은퇴'] },
    { href: '#finance-panel', icon: '💰', name: '금융정보 (예금·적금·연금저축)', where: '우리동네 혜택 › 금융정보', words: ['연금저축', '연금', '예금', '적금', '저축', '금리', '이자', '은행', '보험', '절세', '세금'] },
    { href: '#benefit-panel', icon: '🎁', name: '우리동네 혜택', where: '우리동네 혜택 › 혜택', words: ['혜택', '지원금', '보조금', '복지', '지원', '바우처', '수당', '신청'] },
    { href: '#farm-panel', icon: '🌾', name: '농사정보', where: '우리동네 혜택 › 농사정보', words: ['농사', '농업', '농촌', '농가', '작물', '귀농', '귀촌', '영농'] },
    { href: '#eco-panel', icon: '📊', name: '항목별 최신 경제지표', where: '경제지표', words: ['경제', '지표', '물가', '환율', '기준금리', '금리', '실업', '고용', '수출'] },
    { href: '#market-panel', icon: '📈', name: '국내·미국 증시', where: '경제지표 › 증시', words: ['주식', '증시', '코스피', '코스닥', '나스닥', '다우', '주가', '시장분석'] },
    { href: '#house-panel', icon: '🏢', name: '아파트 주간동향', where: '경제지표 › 아파트', words: ['아파트', '집값', '전세', '매매', '시세'] },
    { href: '#realestate-panel', icon: '🏠', name: '부동산 동향', where: '경제지표 › 부동산', words: ['부동산', '토지', '땅', '주택', '집값'] },
    { href: '#policy-panel', icon: '📰', name: '정책브리핑', where: '정책브리핑', words: ['정책', '브리핑', '정부', '발표'] },
    { href: '#issue-panel', icon: '🗞️', name: '오늘의 이슈', where: '오늘의 이슈', words: ['이슈', '뉴스', '기사', '평론'] },
    { href: '#weather-panel', icon: '☀️', name: '오늘 날씨', where: '홈 › 날씨', words: ['날씨', '기온', '비', '미세먼지'] },
    { href: '#newsletter-section', icon: '✉️', name: '스페이스 레터 (무료 구독)', where: '스페이스 레터', words: ['레터', '뉴스레터', '구독', '이메일'] },
    { href: '#voice-section', icon: '📣', name: '시민의 소리 (불편·민원)', where: '게시판 › 시민의 소리', words: ['민원', '불편', '신고', '시민의 소리', '고발'] },
    { href: '#chat-section', icon: '💬', name: '광장 채팅', where: '광장 채팅', words: ['채팅', '광장', '대화'] },
    { href: '/chat', icon: '🗨️', name: '스페이스 톡 (대화방)', where: '스페이스 톡', words: ['스페이스톡', '스페이스 톡', '톡', '대화방', '단톡'] },
    { href: '#guide-section', icon: '❓', name: '이용 안내', where: '이용 안내', words: ['이용', '안내', '가입', '회원', '사용법', '도움말'] },
  ];
  function shortcutsFor(keyword) {
    const words = String(keyword).toLowerCase().split(/\s+/).filter(Boolean);
    const hit = word => entry => entry.words.some(key => key === word || (word.length >= 2 && (key.includes(word) || word.includes(key) && key.length >= 2)));
    // 자료가 없어 숨겨 둔 메뉴(예: 연결 전인 정보)는 바로가기에서도 뺀다
    const available = entry => {
      if (!entry.href.startsWith('#')) return true;
      const target = document.getElementById(entry.href.slice(1));
      if (!target || target.hidden || target.closest('[hidden]')) return false;
      return !document.querySelector(`.sub-tabs a[href="${entry.href}"][hidden], .tabbox-tab[hidden][data-for="${entry.href.slice(1)}"]`);
    };
    return SHORTCUTS.filter(entry => words.some(word => hit(word)(entry)) && available(entry)).slice(0, 3);
  }

  function showSuggest() {
    const keyword = $('searchInput').value.trim();
    if (!keyword || /^#?\d+$/.test(keyword) || !window.spaceBoards) { hideSuggest(); return; }
    // 제목에 검색어가 들어간 글을 먼저, 그다음 최신순
    const inTitle = post => String(keyword).toLowerCase().split(/\s+/).filter(Boolean).every(word => titleOf(post).toLowerCase().includes(word));
    const found = allPosts().filter(matcher(keyword)).sort((left, right) => inTitle(right) - inTitle(left));
    suggestIndex = -1;
    const shortcuts = shortcutsFor(keyword).map(entry => {
      const link = make('a', 'suggest-item suggest-go');
      link.href = entry.href;
      link.setAttribute('role', 'option');
      const top = make('span', 'suggest-top');
      top.append(make('span', 'suggest-icon', entry.icon), make('strong', 'suggest-title', entry.name), make('span', 'suggest-arrow', '바로 가기 ›'));
      link.append(top, make('span', 'suggest-meta', `메뉴 위치: ${entry.where}`));
      link.addEventListener('mousedown', event => event.preventDefault());
      link.addEventListener('click', () => { hideSuggest(); $('searchInput').blur(); });
      return link;
    });
    const parts = [];
    if (shortcuts.length) parts.push(make('div', 'suggest-head', '🔎 관련 정보 메뉴'), ...shortcuts);
    if (shortcuts.length && found.length) parts.push(make('div', 'suggest-head', '📝 관련 글'));
    if (!found.length) {
      parts.push(make('div', 'suggest-empty', `‘${keyword}’이(가) 들어간 글이 없습니다.`));
      suggest.replaceChildren(...parts);
    } else {
      suggest.replaceChildren(...parts, ...found.slice(0, shortcuts.length ? 5 : 7).map(post => {
        const link = make('a', 'suggest-item');
        link.href = post.no ? `/post/${post.no}` : '#';
        link.setAttribute('role', 'option');
        const top = make('span', 'suggest-top');
        top.append(make('span', `badge ${post.board}`, BOARD_LABEL[post.board]), mark(make('strong', 'suggest-title'), titleOf(post), keyword));
        link.append(top, mark(make('span', 'suggest-snippet'), snippetOf(post, keyword), keyword),
          make('span', 'suggest-meta', `${post.category ? `${post.category} · ` : ''}${clip(post.authorName, 10)} · ${timeAgo(post.createdAt)}`));
        link.addEventListener('mousedown', event => event.preventDefault());
        link.addEventListener('click', event => {
          if (post.no && (event.ctrlKey || event.metaKey || event.shiftKey)) return;
          event.preventDefault();
          hideSuggest();
          openPost(post);
        });
        return link;
      }));
      if (found.length > (shortcuts.length ? 5 : 7)) {
        const all = make('button', 'suggest-all', `‘${keyword}’ 검색 결과 ${found.length}건 모두 보기 ›`);
        all.type = 'button';
        all.addEventListener('mousedown', event => event.preventDefault());
        all.addEventListener('click', () => $('searchForm').requestSubmit());
        suggest.appendChild(all);
      }
    }
    placeSuggest();
    suggest.hidden = false;
  }
  $('searchInput').addEventListener('input', showSuggest);
  $('searchInput').addEventListener('focus', showSuggest);
  $('searchInput').addEventListener('blur', () => setTimeout(hideSuggest, 120));
  $('searchInput').addEventListener('keydown', event => {
    const items = [...suggest.querySelectorAll('.suggest-item')];
    if (event.key === 'Escape') { hideSuggest(); return; }
    if (suggest.hidden || !items.length || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
    if (event.key === 'Enter') {
      if (suggestIndex >= 0) { event.preventDefault(); items[suggestIndex].click(); }
      return;
    }
    event.preventDefault();
    suggestIndex = (suggestIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length + 1) % (items.length + 1);
    if (suggestIndex === items.length) suggestIndex = -1;
    items.forEach((item, index) => item.classList.toggle('active', index === suggestIndex));
  });
  window.addEventListener('resize', () => { if (!suggest.hidden) placeSuggest(); });
  window.addEventListener('scroll', () => { if (!suggest.hidden) placeSuggest(); }, { passive: true });

  $('searchForm').addEventListener('submit', event => {
    event.preventDefault();
    hideSuggest();
    const keyword = $('searchInput').value.trim();
    if (!keyword) { clearSearch(); return; }
    // 글번호만 적으면(57 또는 #57) 그 글로 바로 간다.
    const number = keyword.match(/^(?:#|no\.?\s*|글\s*번호\s*)?(\d{1,7})$/i);
    if (number) { window.location.href = `/post/${Number(number[1])}`; return; }
    state.search = keyword;
    state.page = 1;
    $('feed-title').textContent = '검색 결과';
    $('feed-title').classList.add('searching');
    document.querySelectorAll('[data-feed]').forEach(chip => chip.setAttribute('aria-selected', 'false'));
    renderFeed();
    const count = feedItems().length;
    const note = $('search-note');
    note.replaceChildren(`‘${keyword}’ 검색 결과 ${count}건 `);
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
    const tag = $('ticker-tag');
    tag.textContent = notice.tag;
    tag.dataset.kind = { 공지: 'notice', 안내: 'guide', '시민의 소리': 'voice', 운영: 'ops' }[notice.tag] || 'notice';
    const link = make('a', 'ticker-link');
    link.href = notice.href;
    link.append(make('span', 'ticker-msg', notice.text), make('span', 'ticker-go', '자세히 ›'));
    const box = $('ticker-text');
    box.classList.remove('swap');
    void box.offsetWidth;
    box.classList.add('swap');
    box.replaceChildren(link);
    // 몇 번째 공지인지 점으로 보여 주고, 점을 누르면 그 공지로 간다
    const pos = $('ticker-pos');
    if (pos.children.length !== notices.length) {
      pos.replaceChildren(...notices.map((item, index) => {
        const dot = make('button', 'ticker-dot');
        dot.type = 'button';
        dot.setAttribute('aria-label', `${index + 1}번째 공지: ${item.tag}`);
        dot.addEventListener('click', () => { showNotice(index); startTicker(); });
        return dot;
      }));
    }
    [...pos.children].forEach((dot, index) => {
      dot.classList.toggle('on', index === noticeIndex);
      if (index === noticeIndex) dot.setAttribute('aria-current', 'true'); else dot.removeAttribute('aria-current');
    });
    // 다음 공지까지 남은 시간을 아래 막대로 보여 준다
    const ticker = $('ticker');
    ticker.classList.remove('run');
    void ticker.offsetWidth;
    ticker.classList.add('run');
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
    const pause = () => { clearInterval(noticeTimer); ticker.classList.add('paused'); };
    const resume = () => { ticker.classList.remove('paused'); showNotice(noticeIndex); startTicker(); };
    ticker.addEventListener('mouseenter', pause);
    ticker.addEventListener('mouseleave', resume);
    ticker.addEventListener('focusin', pause);
    ticker.addEventListener('focusout', () => setTimeout(() => { if (!ticker.contains(document.activeElement) && !ticker.matches(':hover')) resume(); }, 0));
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
  function renderKrTape(data, tapeId = 'kr-tape', wanted = ['kospi', 'kosdaq', 'usdkrw', 'ktb3y']) {
    const tape = $(tapeId);
    if (!tape) return;
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
  // 홈 오른쪽 '오늘의 경제지표' 요약: 흐르는 띠 + 핵심 4칸(누르면 경제지표 화면으로)
  function renderEcoMini(data) {
    renderKrTape(data, 'kr-tape-home', ['kospi', 'kosdaq', 'usdkrw', 'ktb3y', 'base', 'dubai', 'gold']);
    const grid = $('eco-mini-grid');
    if (!grid) return;
    const items = data?.items || [];
    const pick = ['kospi', 'usdkrw', 'base', 'ktb3y'].map(id => items.find(item => item.id === id)).filter(item => item && item.value !== null && item.value !== undefined);
    if (!pick.length) { if (!grid.children.length) grid.replaceChildren(make('p', 'feed-empty', '지표를 불러오는 중입니다.')); return; }
    $('eco-mini-updated').textContent = data.today ? `${dateLabel(data.today)} 기준 · 눌러서 자세히` : '눌러서 자세히 보기';
    grid.replaceChildren(...pick.map(item => {
      const tile = make('a', 'eco-tile');
      tile.href = item.id === 'kospi' ? '#market-panel' : '#eco-panel';
      const delta = deltaOf(item);
      tile.append(make('span', 'n', item.name),
        make('span', 'v', `${number(item.value, item.digits)}${item.unit === '%' ? '%' : item.unit === '원' ? '원' : ''}`),
        make('span', `c ${delta.cls}`, delta.text || '변동 없음'));
      return tile;
    }));
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
  // ---------- '이번 주 시장분석 읽기': 칼럼·학술 게시판을 시장분석 글만 보이게 열어 준다 ----------
  document.querySelectorAll('[data-research-filter]').forEach(link => link.addEventListener('click', () => {
    const filter = $('researchFilter');
    if (!filter) return;
    filter.value = link.dataset.researchFilter;
    filter.dispatchEvent(new Event('change'));
  }));
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

  // ---------- 스페이스 레터: 구독을 마치면 '구독하기' → '구독완료' (이 기기 기록 + 로그인 회원은 서버 확인) ----------
  function applyLetterSubscribed() {
    const box = document.querySelector('.sub-box');
    if (box && !box.classList.contains('done')) {
      box.classList.add('done');
      $('sub-title').textContent = '스페이스 레터 구독완료';
      box.querySelector('p').textContent = '매주 월요일 아침 7시에 경제·정책 브리핑을 메일로 보내 드립니다. 지난 레터도 언제든 다시 읽을 수 있어요.';
      const go = $('sub-go');
      go.textContent = '지난 레터 보기';
      go.href = '/letter';
    }
    document.querySelectorAll('[data-letter-cta]').forEach(link => {
      // 같은 줄(예: 맨 아래 바닥글)에 이미 '지난 레터 보기'가 있으면 겹치지 않게 숨긴다
      const twin = [...(link.parentElement?.querySelectorAll('a[href="/letter"]') || [])].some(other => other !== link && !other.hasAttribute('data-letter-cta'));
      if (twin) { link.hidden = true; return; }
      link.textContent = '지난 레터 보기'; link.href = '/letter';
    });
    document.querySelectorAll('[data-letter-cta-row]').forEach(link => { link.href = '/letter'; const label = link.querySelector('.me-extra-letter'); if (label) label.textContent = '지난 스페이스 레터 보기'; });
    const note = $('letter-subscribed');
    if (note) note.hidden = false;
    const intro = $('letter-intro');
    if (intro) intro.textContent = '매주 월요일 아침 7시, 한국은행·한국부동산원 공식 통계로 정리한 경제 지표와 이번 주 정부 정책, 커뮤니티의 목소리를 이메일로 보내드립니다.';
    document.querySelectorAll('[data-letter-mark]').forEach(button => { button.hidden = true; });
    const title = $('newsletter-title');
    if (title) title.textContent = '스페이스 레터 (구독완료)';
    const button = document.querySelector('#newsletter-form button[type="submit"]');
    if (button && !button.dataset.other) {
      button.textContent = '✓ 구독완료';
      button.disabled = true;
      button.classList.add('done');
      if (!$('letter-other')) {
        const other = make('button', 'link-btn', '다른 이메일로도 받기');
        other.type = 'button';
        other.id = 'letter-other';
        other.addEventListener('click', () => { button.dataset.other = '1'; button.disabled = false; button.textContent = '구독하기'; button.classList.remove('done'); other.remove(); $('newsletter-email')?.focus(); });
        button.after(other);
      }
    }
  }
  try { if (localStorage.getItem('space-letter-subscribed')) applyLetterSubscribed(); } catch { /* storage unavailable */ }
  // 다른 기기(PC 등)나 메일 앱 안 브라우저에서 구독을 마친 경우: 이 기기에도 '구독완료'로 표시만 한다(서버 정보는 바꾸지 않음).
  document.querySelectorAll('[data-letter-mark]').forEach(button => button.addEventListener('click', () => {
    try { localStorage.setItem('space-letter-subscribed', new Date().toISOString()); } catch { /* storage unavailable */ }
    applyLetterSubscribed();
  }));
  async function syncLetterStatus() {
    try {
      const response = await fetch('/api/newsletter/status', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return;
      const { status } = await response.json();
      if (status === 'confirmed') {
        try { localStorage.setItem('space-letter-subscribed', new Date().toISOString()); } catch { /* storage unavailable */ }
        applyLetterSubscribed();
      }
    } catch { /* offline */ }
  }
  window.addEventListener('space-auth', event => { if (event.detail?.user) syncLetterStatus(); });
  syncLetterStatus();

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
    if (!items.length) { list.replaceChildren(make('li', 'feed-empty', ({ news: '최근 며칠 사이 새로 올라온 정책뉴스가 아직 없습니다.', economy: '최근 며칠 사이 경제·금융·부동산 분야 정책뉴스가 없습니다.', fact: '최근 며칠 사이 올라온 \'사실은 이렇습니다\'(보도 설명 자료)가 없습니다.' })[pbTab])); return; }
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
  $('policy-panel')?.querySelectorAll('[data-pb]').forEach(button => button.addEventListener('click', () => { pbTab = button.dataset.pb; renderPolicy(); }));

  // ---------- 오늘의 이슈 (매일경제 헤드라인 자동 선별) + 회원 평론 ----------
  const is = { data: null, date: '', open: '', reviews: [], loaded: false, seq: 0 };
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  const dayLabel = value => {
    const date = new Date(Date.UTC(+value.slice(0, 4), +value.slice(4, 6) - 1, +value.slice(6, 8)));
    return `${+value.slice(4, 6)}월 ${+value.slice(6, 8)}일 (${WEEK[date.getUTCDay()]})`;
  };
  const clockOf = iso => {
    if (!iso) return '';
    const date = new Date(iso);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };
  async function issueApi(url, body) {
    const response = await fetch(url, body ? {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.spaceAuth?.csrfToken || '' },
      body: JSON.stringify(body),
    } : { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `오류 (${response.status})`);
    return data;
  }
  const reviewsOf = id => is.reviews.filter(post => post.issue?.id === id);
  function currentIssue() {
    return (is.data?.items || []).find(item => item.field === is.open && !item.empty && !item.hidden) || null;
  }
  function renderIssues() {
    const grid = $('is-grid');
    if (!grid) return;
    const data = is.data;
    const admin = Boolean(window.spaceAuth?.user?.admin);
    $('is-admin').hidden = !admin;
    const select = $('is-date');
    const dates = data?.dates || [];
    const wanted = [['', `오늘${data?.today ? ` · ${dayLabel(data.today)}` : ''}`], ...dates.filter(date => date !== data?.today).map(date => [date, dayLabel(date)])];
    if (select.options.length !== wanted.length) select.replaceChildren(...wanted.map(([value, label]) => { const option = make('option', '', label); option.value = value; return option; }));
    select.value = is.date;
    if (!data) { grid.replaceChildren(make('li', 'feed-empty', '오늘의 이슈를 불러오고 있습니다.')); return; }
    const allEmpty = data.items.every(item => item.empty);
    const note = data.fallback ? `오늘 기사를 아직 받지 못해 ${dayLabel(data.date)} 이슈를 보여 드립니다.`
      : allEmpty && data.problems?.length ? `기사 목록 연결 확인 중${admin ? ` (${data.problems[0]})` : ''}` : '';
    $('is-updated').textContent = note || (data.updatedAt ? `${dayLabel(data.date)} · ${data.locked ? '고정됨' : `${clockOf(data.updatedAt)} 갱신 · 낮 12시에 고정`}` : '매일경제 헤드라인에서 분야별 1건 자동 선별');
    const items = data.items.filter(item => admin || !item.hidden);
    grid.replaceChildren(...items.map(item => {
      const li = make('li', `is-card f-${item.field}${item.hidden ? ' is-hidden' : ''}`);
      li.appendChild(make('span', 'is-field', item.label));
      if (item.empty || item.hidden) {
        li.appendChild(make('p', 'is-empty', item.hidden ? '관리자가 숨긴 분야입니다.' : data.problems?.length ? '신문사 기사 목록을 받아오지 못했습니다. 잠시 뒤 다시 시도합니다.' : '이 분야의 헤드라인을 고르는 중입니다.'));
        return li;
      }
      const link = make('a', 'is-title', item.title);
      link.href = item.link;
      link.target = '_blank';
      link.rel = 'noopener nofollow';
      const meta = make('div', 'is-meta');
      meta.appendChild(make('span', '', [item.source || '매일경제', clockOf(item.at), item.manual ? '운영자 선정' : item.related ? `관련 보도 ${item.related}건` : ''].filter(Boolean).join(' · ')));
      const count = reviewsOf(item.id).length;
      const button = make('button', `is-review-btn${is.open === item.field ? ' active' : ''}`, `💬 평론${count ? ` ${count}` : ''}`);
      button.type = 'button';
      button.setAttribute('aria-expanded', String(is.open === item.field));
      button.addEventListener('click', () => { is.open = is.open === item.field ? '' : item.field; renderIssues(); if (is.open) $('is-review').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
      meta.appendChild(button);
      li.append(link, meta);
      return li;
    }));
    renderReview();
  }
  function renderReview() {
    const box = $('is-review');
    const issue = currentIssue();
    box.hidden = !issue;
    if (!issue) return;
    $('is-review-field').textContent = issue.label;
    $('is-review-field').className = `is-field f-${issue.field}`;
    $('is-review-title').textContent = issue.title;
    $('is-review-title').href = issue.link;
    const user = window.spaceAuth?.user;
    $('is-form').hidden = !user;
    $('is-login').hidden = Boolean(user);
    const list = reviewsOf(issue.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    if (!list.length) { $('is-reviews').replaceChildren(make('li', 'feed-empty', is.loaded ? '아직 평론이 없습니다. 첫 평론을 남겨 주세요.' : '평론을 불러오고 있습니다.')); return; }
    $('is-reviews').replaceChildren(...list.map(post => {
      const li = make('li', 'is-rv');
      if (post.title) li.appendChild(make('strong', 'is-rv-title', post.title));
      const body = make('p', 'is-rv-text', post.text.length > 600 ? `${post.text.slice(0, 600)}…` : post.text);
      li.appendChild(body);
      const meta = make('div', 'is-rv-meta');
      meta.appendChild(make('span', '', `${post.authorName || '회원'} · ${timeAgo(post.createdAt)}${post.editedAt ? ' · 수정됨' : ''}`));
      const like = make('button', `link-btn${post.liked ? ' on' : ''}`, `♥ 공감 ${post.likes || 0}`);
      like.type = 'button';
      like.addEventListener('click', () => requireLogin(async () => {
        try { Object.assign(post, await issueApi('/api/board/like', { postId: post.id })); renderReview(); } catch (error) { $('is-form-status').textContent = error.message; }
      }));
      meta.appendChild(like);
      if (post.no) { const more = make('a', 'link-btn', '전체 보기'); more.href = `/post/${post.no}`; meta.appendChild(more); }
      if (!post.mine) {
        const report = make('button', 'link-btn', post.reported ? '신고함' : '신고');
        report.type = 'button';
        report.disabled = Boolean(post.reported);
        report.addEventListener('click', () => requireLogin(async () => {
          const reason = window.prompt('신고 사유를 적어 주세요. (예: 비방, 허위사실, 광고)');
          if (!reason) return;
          try { const result = await issueApi('/api/board/report', { postId: post.id, reason: reason.slice(0, 200) }); post.reported = true; $('is-form-status').textContent = result.message; renderReview(); }
          catch (error) { $('is-form-status').textContent = error.message; }
        }));
        meta.appendChild(report);
      }
      if (post.hidden) meta.appendChild(make('span', 'is-rv-hidden', '숨김(신고 누적)'));
      li.appendChild(meta);
      return li;
    }));
  }
  async function loadIssues() {
    const seq = ++is.seq;
    try {
      const data = await issueApi(`/api/portal/issues${is.date ? `?date=${is.date}` : ''}`);
      if (seq !== is.seq) return;
      is.data = data;
    } catch (error) {
      if (seq !== is.seq) return;
      is.data = { items: [], dates: [], problems: [error.message] };
      $('is-grid').replaceChildren(make('li', 'feed-empty', '오늘의 이슈를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'));
      return;
    }
    if (!is.data.items.some(item => item.field === is.open && !item.empty && !item.hidden)) is.open = '';
    renderIssues();
  }
  async function loadIssueReviews() {
    try {
      is.reviews = (await issueApi('/api/board?board=issue')).posts || [];
    } catch { is.reviews = []; }
    is.loaded = true;
    renderIssues();
  }
  if ($('issue-panel')) {
    $('is-date').addEventListener('change', event => { is.date = event.target.value; is.open = ''; loadIssues(); });
    $('is-review-close').addEventListener('click', () => { is.open = ''; renderIssues(); });
    $('is-login-btn').addEventListener('click', () => window.spaceOpenAuth?.('login'));
    $('is-form').addEventListener('submit', async event => {
      event.preventDefault();
      const issue = currentIssue();
      const status = $('is-form-status');
      if (!issue) return;
      const text = $('is-form-text').value.trim();
      if (!text) { status.textContent = '내용을 적어 주세요.'; return; }
      const button = event.submitter || event.target.querySelector('button[type=submit]');
      button.disabled = true;
      status.textContent = '올리는 중…';
      try {
        const result = await issueApi('/api/board/posts', {
          board: 'issue', category: issue.label, title: $('is-form-title').value.trim(), text,
          issue: { id: issue.id, date: is.data.date, title: issue.title, link: issue.link, source: issue.source || '' },
        });
        is.reviews.unshift(result.post);
        $('is-form-title').value = '';
        $('is-form-text').value = ''; $('is-form-text').dispatchEvent(new Event('input'));
        status.textContent = '평론이 올라갔습니다. 고맙습니다.';
        renderIssues();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
    const adminForm = $('is-admin-form');
    const adminAction = async action => {
      const form = new FormData(adminForm);
      const status = $('is-admin-status');
      status.textContent = '저장 중…';
      try {
        await issueApi('/api/portal/issues/admin', { action, field: form.get('field'), title: form.get('title'), link: form.get('link'), source: form.get('source') });
        status.textContent = { set: '바꿨습니다.', auto: '자동 선별로 되돌렸습니다.', hide: '이 분야를 숨겼습니다.' }[action];
        if (action === 'set') { adminForm.title.value = ''; adminForm.link.value = ''; }
        is.date = '';
        loadIssues();
      } catch (error) {
        status.textContent = error.message;
      }
    };
    adminForm.addEventListener('submit', event => { event.preventDefault(); adminAction('set'); });
    adminForm.querySelectorAll('button[data-action]:not([type=submit])').forEach(button => button.addEventListener('click', () => adminAction(button.dataset.action)));
    window.addEventListener('space-auth', () => { renderIssues(); loadIssueReviews(); });
    loadIssues();
    loadIssueReviews();
    setInterval(() => { if (document.visibilityState === 'visible' && !is.date) loadIssues(); }, 30 * 60 * 1000);
  }

  // ---------- 우리 동네 신청 혜택 ----------
  const bf = { region: 'uiryeong', aud: '', town: true, q: '', shown: 10, data: null, seq: 0 };
  try {
    const saved = new URLSearchParams(location.search).get('동네') || localStorage.getItem('bf-region');
    const known = { yangsan: 'yangsan', gimhae: 'gimhae', uiryeong: 'uiryeong', 양산: 'yangsan', 김해: 'gimhae', 의령: 'uiryeong' };
    if (known[saved]) bf.region = known[saved];
  } catch { /* storage blocked */ }
  const ymdLabel = value => `${Math.floor(value / 100) % 100}월 ${value % 100}일`;
  function dueBadge(item) {
    if (item.due) {
      const due = new Date(Math.floor(item.due / 10000), Math.floor(item.due / 100) % 100 - 1, item.due % 100);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const days = Math.round((due - today) / 86400000);
      return make('span', `bf-due${days <= 14 ? ' soon' : ''}`, days === 0 ? `오늘 마감` : `마감 D-${days} · ${ymdLabel(item.due)}`);
    }
    return make('span', 'bf-due always', item.always ? '상시 신청' : '기간 확인');
  }
  const SCOPE = { manual: '고시·공고', local: '', province: '경상남도', national: '정부' };
  function renderBenefits() {
    const list = $('bf-list');
    if (!list) return;
    const panel = $('benefit-panel');
    panel.querySelectorAll('[data-bf-region]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.bfRegion === bf.region)));
    const data = bf.data;
    const regionName = { yangsan: '양산시', gimhae: '김해시', uiryeong: '의령군' }[bf.region];
    if (!data) { list.replaceChildren(make('li', 'skeleton'), make('li', 'skeleton')); return; }
    const audiences = $('bf-audiences');
    const all = make('button', 'chip', '전체');
    all.type = 'button';
    all.setAttribute('aria-pressed', String(!bf.aud));
    all.setAttribute('aria-selected', String(!bf.aud));
    all.addEventListener('click', () => { bf.aud = ''; loadBenefits(); });
    audiences.replaceChildren(all, ...(data.audiences || []).filter(entry => data.counts?.[entry.id] || bf.aud === entry.id).map(entry => {
      const chip = make('button', 'chip', entry.label);
      chip.type = 'button';
      chip.appendChild(make('small', '', String(data.counts?.[entry.id] || 0)));
      chip.setAttribute('aria-selected', String(bf.aud === entry.id));
      chip.addEventListener('click', () => { bf.aud = bf.aud === entry.id ? '' : entry.id; loadBenefits(); });
      return chip;
    }));
    if (!data.connected) { $('bf-count').textContent = ''; list.replaceChildren(make('li', 'feed-empty', '정부24 혜택 자료를 연결하고 있습니다. 곧 자동으로 표시됩니다.')); $('bf-more').hidden = true; return; }
    // 정부24 자료가 아직 연결되지 않았어도 관리자가 넣은 고시·공고 안내는 보여 준다.
    const waiting = !data.loaded ? (data.problems?.length ? '정부24 혜택 자료 연결 승인을 기다리고 있습니다. 승인되면 자동으로 채워집니다.' : `${regionName} 혜택 자료를 받아 오는 중입니다. 잠시 뒤 새로 고침해 주세요.`) : '';
    if (waiting && !data.items?.length) { $('bf-count').textContent = ''; list.replaceChildren(make('li', 'feed-empty', waiting)); $('bf-more').hidden = true; $('bf-admin').hidden = !window.spaceAuth?.user?.admin; return; }
    $('bf-count').textContent = waiting ? `${waiting} 아래는 직접 올린 고시·공고 안내입니다.` : `${regionName}${bf.town ? ' · 읍·면·동 신청' : ''}${bf.aud ? ` · ${data.audiences.find(entry => entry.id === bf.aud)?.label}` : ''}${bf.q ? ` · '${bf.q}'` : ''} — ${data.matched}건 (마감 지난 혜택은 뺐습니다)`;
    if (!data.items.length) { list.replaceChildren(make('li', 'feed-empty', bf.q ? '찾는 혜택이 없습니다. 다른 낱말로 찾아보세요.' : '조건에 맞는 혜택이 없습니다. \'읍·면·동 신청만\'을 끄면 더 많이 볼 수 있습니다.')); $('bf-more').hidden = true; return; }
    const admin = Boolean(window.spaceAuth?.user?.admin);
    list.replaceChildren(...data.items.slice(0, bf.shown).map(item => {
      const li = make('li');
      const head = make('div', 'bf-head');
      head.appendChild(dueBadge(item));
      if (SCOPE[item.scope]) head.appendChild(make('span', `bf-scope ${item.scope}`, SCOPE[item.scope]));
      head.appendChild(make('span', 'bf-name', item.name));
      li.appendChild(head);
      if (item.summary) li.appendChild(make('p', 'bf-sum', item.summary));
      const meta = make('p', 'bf-meta');
      const addMeta = (label, value) => { if (!value) return; if (meta.childNodes.length) meta.appendChild(document.createElement('br')); meta.append(make('b', '', `${label} `), value); };
      addMeta('대상', item.target);
      addMeta('신청 기간', item.deadlineText);
      addMeta('신청처', item.reception || item.method);
      addMeta('문의', [item.agency, item.dept, item.phone].filter(Boolean).join(' '));
      if (meta.childNodes.length) li.appendChild(meta);
      const actions = make('div', 'bf-actions');
      if (item.url) {
        const link = make('a', '', item.manual ? '공고 원문 보기 ↗' : '자세히(정부24) ↗');
        link.href = item.url; link.target = '_blank'; link.rel = 'noopener';
        actions.appendChild(link);
      }
      if (admin && item.manual) {
        const remove = make('button', '', '이 안내 삭제');
        remove.type = 'button';
        remove.addEventListener('click', async () => {
          if (!window.confirm(`'${item.name}' 안내를 삭제할까요?`)) return;
          await benefitAdmin({ remove: item.id });
          loadBenefits();
        });
        actions.appendChild(remove);
      }
      if (actions.childNodes.length) li.appendChild(actions);
      return li;
    }));
    $('bf-more').hidden = data.items.length <= bf.shown;
    $('bf-admin').hidden = !admin;
  }
  async function loadBenefits() {
    const seq = ++bf.seq;
    bf.shown = 10;
    const params = new URLSearchParams({ region: bf.region, town: bf.town ? '1' : '0' });
    if (bf.aud) params.set('aud', bf.aud);
    if (bf.q) params.set('q', bf.q);
    try {
      const response = await fetch(`/api/portal/benefits?${params}`, { credentials: 'same-origin' });
      const data = await response.json();
      if (seq !== bf.seq) return;
      bf.data = response.ok ? data : { connected: true, loaded: false, problems: [data.error || String(response.status)], audiences: [], items: [] };
    } catch (error) {
      if (seq !== bf.seq) return;
      bf.data = { connected: true, loaded: false, problems: ['인터넷 연결을 확인해 주세요.'], audiences: [], items: [] };
    }
    renderBenefits();
  }
  async function benefitAdmin(body) {
    const response = await fetch('/api/portal/benefits/manual', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.spaceAuth?.csrfToken || '' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '저장하지 못했습니다.');
    return data;
  }
  if ($('benefit-panel')) {
    $('benefit-panel').querySelectorAll('[data-bf-region]').forEach(button => button.addEventListener('click', () => {
      bf.region = button.dataset.bfRegion;
      try { localStorage.setItem('bf-region', bf.region); } catch { /* storage blocked */ }
      loadBenefits();
    }));
    $('bf-town').addEventListener('change', event => { bf.town = event.target.checked; loadBenefits(); });
    let typing;
    $('bf-q').addEventListener('input', event => { clearTimeout(typing); typing = setTimeout(() => { bf.q = event.target.value.trim(); loadBenefits(); }, 350); });
    $('bf-more').addEventListener('click', () => { bf.shown += 10; renderBenefits(); });
    // 이장님·이웃에게 링크 하나로 알릴 수 있게: 지역이 담긴 주소를 카카오톡 등으로 공유한다.
    $('bf-share').addEventListener('click', async () => {
      const name = { yangsan: '양산', gimhae: '김해', uiryeong: '의령' }[bf.region];
      const url = `${location.origin}/?동네=${encodeURIComponent(name)}#benefit-panel`;
      const soon = (bf.data?.items || []).filter(item => item.due).slice(0, 3).map(item => `· ${item.name} (${ymdLabel(item.due)} 마감)`);
      const text = [`[${name} 주민 신청 혜택 안내]`, '읍·면·동에 신청해야 받을 수 있는 혜택을 마감 순으로 모았습니다.', ...soon].join('\n');
      try {
        if (navigator.share) { await navigator.share({ title: `${name} 우리 동네 신청 혜택`, text, url }); return; }
        await navigator.clipboard.writeText(`${text}\n${url}`);
        $('bf-share').textContent = '✓ 복사됨 — 카톡에 붙여넣기';
        setTimeout(() => { $('bf-share').textContent = '📤 카톡으로 알리기'; }, 2500);
      } catch { /* share cancelled */ }
    });
    $('bf-form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.target;
      const status = $('bf-status');
      const input = Object.fromEntries(new FormData(form));
      status.textContent = '저장 중…';
      try {
        await benefitAdmin(input);
        status.textContent = '추가했습니다.';
        form.reset();
        bf.region = input.region === 'all' ? bf.region : input.region;
        loadBenefits();
      } catch (error) {
        status.textContent = error.message;
      }
    });
    window.addEventListener('space-auth', () => renderBenefits());
    loadBenefits();
  }

  // ---------- 오늘의 날씨 ----------
  const wx = { region: 'uiryeong', data: null };
  try { const saved = localStorage.getItem('wx-region'); if (saved) wx.region = saved; } catch { /* storage blocked */ }
  const wxIcon = (sky, pty, night) => {
    if (pty === 3 || pty === 7) return '🌨️';
    if (pty === 2 || pty === 6) return '🌨️';
    if (pty === 4) return '🌦️';
    if (pty === 1 || pty === 5) return '🌧️';
    if (sky === 4) return '☁️';
    if (sky === 3) return night ? '☁️' : '⛅';
    return night ? '🌙' : '☀️';
  };
  const dayName = (date, index) => index === 0 ? '오늘' : index === 1 ? '내일' : index === 2 ? '모레' : `${Number(date.slice(4, 6))}/${Number(date.slice(6, 8))}`;
  function renderWeather() {
    const body = $('wx-body');
    if (!body) return;
    const data = wx.data;
    if (!data) return;
    if (!data.connected || !data.regions?.length) { $('weather-panel').hidden = true; return; }
    $('weather-panel').hidden = false;
    if (!data.regions.some(region => region.id === wx.region)) wx.region = data.regions[0].id;
    $('wx-regions').replaceChildren(...data.regions.map(region => {
      const chip = make('button', 'chip', region.name);
      chip.type = 'button';
      chip.setAttribute('role', 'tab');
      chip.setAttribute('aria-selected', String(region.id === wx.region));
      chip.addEventListener('click', () => { wx.region = region.id; try { localStorage.setItem('wx-region', region.id); } catch { /* ignore */ } renderWeather(); });
      return chip;
    }));
    const region = data.regions.find(entry => entry.id === wx.region);
    const today = region.days?.[0];
    if (!region.now && !today) {
      body.replaceChildren(make('p', 'wx-empty', data.problems?.length ? '기상청 날씨 자료를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.' : '날씨 자료를 받아 오는 중입니다.'));
      return;
    }
    const hour = new Date().getHours();
    const night = hour >= 19 || hour < 6;
    const nowBox = make('div', 'wx-now');
    const pty = region.now?.pty || 0;
    nowBox.appendChild(make('span', 'wx-icon', wxIcon(today?.sky, pty, night)));
    const temp = make('div', 'wx-temp', region.now?.temp != null ? `${Math.round(region.now.temp)}` : '–');
    temp.appendChild(make('small', '', '℃'));
    const desc = make('div', 'wx-desc');
    const state = pty ? region.now.ptyText : (today?.skyText || '');
    desc.append(make('b', '', `${region.name} ${state}`.trim()), document.createElement('br'));
    if (today) desc.append(`최저 ${today.min ?? '–'}℃ · 최고 ${today.max ?? '–'}℃`, document.createElement('br'));
    const extra = [today?.pop != null ? `강수확률 ${today.pop}%` : '', region.now?.humidity != null ? `습도 ${region.now.humidity}%` : ''].filter(Boolean).join(' · ');
    if (extra) desc.append(extra);
    nowBox.append(temp, desc);
    const nodes = [nowBox];
    const rainy = (region.days || []).find(day => day.ptyText && (day.pop ?? 0) >= 50);
    if (rainy) {
      const index = region.days.indexOf(rainy);
      const when = rainy.rainFrom ? ` ${Number(rainy.rainFrom.slice(0, 2))}시경부터` : '';
      nodes.push(make('p', 'wx-alert', `☔ ${dayName(rainy.date, index)}${when} ${rainy.ptyText} 소식 (강수확률 ${rainy.pop}%)`));
    }
    const days = make('div', 'wx-days');
    (region.days || []).slice(0, 3).forEach((day, index) => {
      const box = make('div', 'wx-day');
      const t = make('div', 't');
      t.append(make('span', 'lo', day.min != null ? `${day.min}°` : '–'), ' / ', make('span', 'hi', day.max != null ? `${day.max}°` : '–'));
      box.append(make('div', 'd', dayName(day.date, index)), make('div', 'i', wxIcon(day.sky, day.pty, false)), t, make('div', 'p', day.pop != null ? `☂ ${day.pop}%` : ''));
      days.appendChild(box);
    });
    if (days.childNodes.length) nodes.push(days);
    body.replaceChildren(...nodes);
    if (region.now?.at) {
      const at = region.now.at;
      $('wx-updated').textContent = `기상청 · ${Number(at.slice(8, 10))}시 관측`;
    }
  }
  async function loadWeather() {
    try {
      const response = await fetch('/api/portal/weather', { credentials: 'same-origin' });
      if (!response.ok) return;
      wx.data = await response.json();
      renderWeather();
    } catch { /* offline */ }
  }
  if ($('weather-panel')) {
    loadWeather();
    setInterval(() => { if (document.visibilityState === 'visible') loadWeather(); }, 10 * 60 * 1000);
  }

  // ---------- 우리 동네 국민연금 ----------
  const pn = { region: 'uiryeong', data: null };
  const manwon = value => (value == null ? '–' : value >= 10000 ? `${(Math.round(value / 1000) / 10).toLocaleString('ko-KR')}만 원` : `${value.toLocaleString('ko-KR')}원`);
  const people = value => (value == null ? '–' : `${value.toLocaleString('ko-KR')}명`);
  const period = months => (months == null ? '–' : months >= 12 ? `${Math.floor(months / 12)}년${months % 12 ? ` ${months % 12}개월` : ''}` : `${months}개월`);
  function pnTable(head, rows) {
    const table = make('table', 'pn-table');
    const tr = make('tr');
    head.forEach(text => tr.appendChild(make('th', '', text)));
    table.appendChild(tr);
    rows.forEach(cells => {
      const row = make('tr');
      cells.forEach(([text, cls]) => row.appendChild(make('td', cls || '', text)));
      table.appendChild(row);
    });
    return table;
  }
  // ---------- 2026 달라진 국민연금 (운영자가 확인한 요약, 기준일 표시) ----------
  const PN_POLICY_AS_OF = '2026년 10월 기준';
  const PN_POLICY = [
    ['보험료율 9% → 9.5%', '2026년 1월부터. 매년 0.5%p씩 올라 2033년 13%가 됩니다. 직장가입자는 회사와 절반씩(본인 4.75%) 냅니다.'],
    ['받는 돈(소득대체율) 41.5% → 43%', '2026년 이후 가입한 기간부터 적용됩니다(40년 가입·평균소득 기준).'],
    ['연금 지급을 국가가 보장', '국가가 연금 지급을 책임진다는 내용이 법에 명시되었습니다.'],
    ['출산 크레딧 확대', '첫째 아이부터 가입기간 12개월을 인정하고, 50개월 상한을 없앴습니다.'],
    ['군복무 크레딧 확대', '인정 기간이 최대 6개월에서 12개월로 늘었습니다.'],
    ['저소득 지역가입자 보험료 지원', '월 소득 80만 원 미만 지역가입자는 보험료의 50%를 지원받습니다(납부 재개자 12개월 제한 폐지).'],
    ['일하는 수급자 감액 완화', '2026년 6월 17일부터 연금 받으면서 버는 월 소득이 519만 3,511원 미만이면 깎지 않고 전액 받습니다(종전 319만 원).'],
    ['연금액 2.1% 인상', '2026년 1월분부터 물가 상승률(2.1%)만큼 올랐습니다. 산정 기준 A값은 3,193,511원입니다.'],
    ['보험료 기준소득 상·하한', '2026년 7월 ~ 2027년 6월: 상한 659만 원, 하한 41만 원.'],
  ];
  const PN_POLICY_SOURCES = [
    ['정책브리핑 「국민연금, 2026년부터 이렇게 바뀐대!」', 'https://www.korea.kr/news/policyNewsView.do?newsId=148955341'],
    ['정책브리핑 「국가가 연금 지급 보장 법제화」', 'https://www.korea.kr/news/policyNewsView.do?newsId=148957270'],
    ['국민연금공단 공지·고시', 'https://www.nps.or.kr'],
  ];
  // ---------- 내 연금 간단 계산(2026년 산식, 간이) ----------
  const PN_A = 3193511; // 2026년 A값(보건복지부 고시 제2026-12호)
  const PN_CAP = 6590000;
  const PN_FLOOR = 410000;
  function pnStartAge(birthYear) {
    if (!birthYear) return null;
    if (birthYear <= 1952) return 60;
    if (birthYear <= 1956) return 61;
    if (birthYear <= 1960) return 62;
    if (birthYear <= 1964) return 63;
    if (birthYear <= 1968) return 64;
    return 65;
  }
  function pnEstimate(incomeWon, years) {
    const b = Math.min(PN_CAP, Math.max(PN_FLOOR, incomeWon));
    if (years < 10) return { b, monthly: null };
    const factor = years < 20 ? 0.5 + 0.05 * (years - 10) : 1 + 0.05 * (years - 20);
    return { b, monthly: Math.round((1.29 * (PN_A + b) * factor) / 12) };
  }
  function pensionCalc() {
    const wrap = make('div', 'pn-calc');
    const form = make('div', 'pn-calc-form');
    const field = (label, attrs) => {
      const box = make('label', 'pn-field');
      box.appendChild(make('span', '', label));
      const input = make('input');
      Object.assign(input, attrs);
      box.appendChild(input);
      form.appendChild(box);
      return input;
    };
    const income = field('보험료 내는 동안 월 평균 소득(세전, 만 원)', { type: 'number', min: 0, max: 5000, step: 10, value: pn.calc?.income ?? 300, inputMode: 'numeric' });
    const years = field('국민연금 가입 기간(예상, 년)', { type: 'number', min: 0, max: 45, step: 1, value: pn.calc?.years ?? 20, inputMode: 'numeric' });
    const birth = field('태어난 해(선택)', { type: 'number', min: 1940, max: 2010, step: 1, value: pn.calc?.birth ?? '', placeholder: '예: 1968', inputMode: 'numeric' });
    const later = field('연금 받을 때도 일한다면 월 소득(근로·사업, 만 원)', { type: 'number', min: 0, max: 5000, step: 10, value: pn.calc?.later ?? 0, inputMode: 'numeric' });
    const out = make('div', 'pn-calc-out');
    const update = () => {
      const incomeWon = Math.max(0, Number(income.value) || 0) * 10000;
      const y = Math.max(0, Math.min(45, Number(years.value) || 0));
      const by = Number(birth.value) || 0;
      pn.calc = { income: income.value, years: years.value, birth: birth.value, later: later.value };
      const laterWon = Math.max(0, Number(later.value) || 0) * 10000;
      const { b, monthly } = pnEstimate(incomeWon, y);
      pn.lastPension = monthly ? { monthly, b } : null;
      const start = pnStartAge(by >= 1940 && by <= 2010 ? by : 0);
      const lines = [];
      if (monthly === null) lines.push(make('p', 'pn-calc-big', '가입 기간이 10년 미만이면 매달 받는 연금 대신 낸 보험료를 돌려받습니다(반환일시금).'));
      else {
        const big = make('p', 'pn-calc-big');
        big.append(start ? `만 ${start}세부터 매달 받는 국민연금 약 ` : '매달 받는 국민연금(예상) 약 ', make('strong', '', `${manwon(monthly)}`));
        lines.push(big);
      }
      // 연금 받을 때의 소득: 2026년 6월 17일부터 월 519만 3,511원(A값 + 200만 원) 미만이면 감액 없음
      if (monthly !== null) {
        const cut = PN_A + 2000000;
        if (laterWon <= 0) lines.push(make('p', 'pn-calc-note', '연금 받을 때 따로 버는 소득이 없으면 위 금액을 그대로 받습니다.'));
        else if (laterWon < cut) lines.push(make('p', 'pn-calc-note', `연금 받을 때 월 소득 ${manwon(laterWon)}: 월 ${Math.round(cut / 10000).toLocaleString('ko-KR')}만 원 미만이라 깎이지 않고 전액 받습니다(2026년 6월부터).`));
        else lines.push(make('p', 'pn-calc-warn', `연금 받을 때 월 소득 ${manwon(laterWon)}: 월 ${Math.round(cut / 10000).toLocaleString('ko-KR')}만 원 이상이라, 받기 시작한 뒤 최대 5년 동안 연금 일부가 깎일 수 있습니다(최대 절반까지). 깎이는 금액은 소득에 따라 달라 국민연금공단(☎1355)에서 확인하세요.`));
      }
      const fee = make('p', 'pn-calc-note');
      fee.textContent = `지금 내는 보험료(9.5%): 월 ${Math.round(b * 0.095).toLocaleString('ko-KR')}원 · 직장가입자 본인 몫(4.75%) 월 ${Math.round(b * 0.0475).toLocaleString('ko-KR')}원`;
      lines.push(fee);
      lines.push(make('p', 'pn-calc-note', start ? `${by}년생은 만 ${start}세부터 받습니다(1969년 이후 출생은 만 65세). 일찍 받으면 줄고, 늦춰 받으면 늘어납니다.` : '태어난 해를 넣으면 몇 살부터 받는지도 알려 드립니다(1969년 이후 출생은 만 65세부터).'));
      if (monthly) {
        const next = make('button', 'pn-next', '👵 이 국민연금으로 기초연금 계산하기 →');
        next.type = 'button';
        // 국민연금 계산값을 그대로 넘긴다: 연금액, 연금 받을 때 근로소득, A급여(연금 중 A값 몫 = 연금 × A ÷ (A + 내 소득))
        const aGrant = Math.round((monthly * PN_A) / (PN_A + b) / 1000) / 10;
        next.addEventListener('click', () => {
          pn.basic = { ...(pn.basic || {}), pension: Math.round(monthly / 1000) / 10, work: Math.round(laterWon / 10000), agrant: aGrant };
          pn.view = 'basic';
          renderPension();
        });
        lines.push(next);
      }
      out.replaceChildren(...lines);
    };
    [income, years, birth, later].forEach(input => input.addEventListener('input', update));
    update();
    const caution = make('p', 'pn-calc-caution', '간이 계산입니다. 모든 가입 기간을 2026년 산식(지급률 1.29, A값 3,193,511원)으로 보고, 소득은 지금 화폐가치로 계산했습니다. 2025년 이전 가입 기간은 지급률이 더 높아 실제 연금이 이보다 많을 수 있고, 부양가족연금·크레딧·물가 조정은 빠졌습니다. 정확한 금액은 아래 「정확한 내 연금 조회」에서 본인 인증 후 확인하세요.');
    const title = make('p', 'pn-calc-title', '🧮 나이 들어 매달 받는 국민연금은 얼마일까? 보험료 낼 때의 소득과 가입 기간을 넣어 보세요.');
    wrap.append(title, form, out, caution);
    return wrap;
  }
  // ---------- 기초연금 간이 계산 (2026년 기준, 소득인정액·국민연금 연계감액·부부감액·소득역전방지감액) ----------
  const BP = { base: 349700, single: 2470000, couple: 3952000, workDeduct: 1160000, finDeduct: 20000000,
    homeDeduct: { metro: 135000000, city: 85000000, rural: 72500000 } };
  function basicPensionEstimate(input) {
    const won = value => Math.max(0, Number(value) || 0) * 10000;
    const couple = input.household !== 'single';
    const both = input.household === 'both';
    const work = won(input.work);
    const pension = won(input.pension);
    const other = won(input.other);
    // 소득평가액: 근로소득은 116만 원 빼고 70%만, 국민연금 등 공적연금·기타 소득은 그대로
    const workCounted = Math.max(0, work - BP.workDeduct) * 0.7;
    const incomeEval = workCounted + pension + other;
    // 재산의 소득환산액: [(일반재산-기본공제) + (금융재산-2천만 원) - 부채] × 4% ÷ 12
    const property = Math.max(0, won(input.home) - (BP.homeDeduct[input.area] || BP.homeDeduct.city))
      + Math.max(0, won(input.finance) - BP.finDeduct) - won(input.debt);
    const propertyEval = Math.max(0, property) * 0.04 / 12;
    const recognized = Math.round(incomeEval + propertyEval);
    const limit = couple ? BP.couple : BP.single;
    const result = { recognized, limit, workCounted, propertyEval: Math.round(propertyEval), eligible: recognized <= limit, notes: [] };
    if (!result.eligible) return result;
    // 국민연금 연계감액: ① 기준연금액 - 2/3×A급여 + 부가연금액(기준연금액의 1/2), ② 기준연금액×250% - 국민연금액 중 큰 금액(기준연금액의 50%~100%)
    let each = BP.base;
    if (pension > 0) {
      const aGrant = input.agrant !== '' && input.agrant != null ? won(input.agrant) : pension / 2;
      const one = BP.base - (2 / 3) * aGrant + BP.base / 2;
      const two = BP.base * 2.5 - pension;
      each = Math.min(BP.base, Math.max(BP.base / 2, Math.max(one, two)));
      if (each < BP.base) {
        result.notes.push(`국민연금이 월 ${Math.round(BP.base * 1.5).toLocaleString('ko-KR')}원(기준연금액의 150%)을 넘어 연계감액 적용`);
        if (input.agrant === '' || input.agrant == null) result.notes.push('A급여를 몰라 국민연금의 절반으로 어림했습니다(공단에서 A급여를 확인해 넣으면 더 정확합니다)');
      }
    }
    // 부부가 둘 다 받으면 각각 20% 감액
    if (both) { each *= 0.8; result.notes.push('부부가 함께 받아 각각 20% 감액'); }
    let household = both ? each * 2 : each;
    // 소득역전방지 감액: 소득인정액 + 기초연금이 선정기준액을 넘으면 넘는 만큼 감액
    if (recognized + household > limit) {
      household = Math.max(0, limit - recognized);
      each = both ? household / 2 : household;
      result.notes.push('소득인정액과 기초연금 합이 선정기준액을 넘어 그만큼 감액(소득역전방지)');
    }
    result.each = Math.floor(each / 10) * 10;
    result.household = Math.floor(household / 10) * 10;
    result.pension = pension;
    return result;
  }
  function basicPensionCalc() {
    const wrap = make('div', 'pn-calc');
    const defaults = { household: 'single', area: pn.region === 'uiryeong' ? 'rural' : 'city', work: 0, pension: pn.lastPension ? Math.round(pn.lastPension.monthly / 1000) / 10 : 0, other: 0, home: 0, finance: 0, debt: 0, agrant: '' };
    const state = pn.basic = { ...defaults, ...(pn.basic || {}) };
    const title = make('p', 'pn-calc-title', '👵 만 65세 이상이 받는 기초연금은 얼마일까? 국민연금·소득·재산에 따라 줄어드는 금액까지 계산합니다.');
    const form = make('div', 'pn-calc-form');
    const select = (label, key, options) => {
      const box = make('label', 'pn-field');
      box.appendChild(make('span', '', label));
      const el = make('select');
      options.forEach(([value, text]) => { const o = make('option', '', text); o.value = value; el.appendChild(o); });
      el.value = state[key];
      el.addEventListener('change', () => { state[key] = el.value; update(); });
      box.appendChild(el);
      form.appendChild(box);
    };
    const number = (label, key, hint = '') => {
      const box = make('label', 'pn-field');
      box.appendChild(make('span', '', label));
      const el = make('input');
      Object.assign(el, { type: 'number', min: 0, step: 'any', inputMode: 'decimal', value: state[key], placeholder: hint });
      el.addEventListener('input', () => { state[key] = el.value; update(); });
      box.appendChild(el);
      form.appendChild(box);
    };
    select('가구', 'household', [['single', '혼자 삶(단독)'], ['both', '부부 둘 다 65세 이상'], ['one', '부부 중 한 명만']]);
    select('사는 곳', 'area', [['city', '도의 시 (양산·김해 등)'], ['rural', '도의 군 (의령 등)'], ['metro', '서울·광역시']]);
    number('국민연금 월 수령액(만 원)', 'pension');
    number('연금 받을 때 월 근로소득(만 원, 부부 합산)', 'work');
    number('기타 월 소득(만 원: 임대·이자·다른 연금 등)', 'other');
    number('집·땅 등 재산(공시가격, 만 원)', 'home');
    number('예금·적금 등 금융재산(만 원)', 'finance');
    number('빚(대출·전세보증금 등, 만 원)', 'debt');
    number('A급여(만 원, 모르면 비워 두세요)', 'agrant', '모르면 비움');
    const out = make('div', 'pn-calc-out');
    const update = () => {
      const r = basicPensionEstimate(state);
      const lines = [];
      lines.push(make('p', 'pn-calc-note', `소득인정액 약 ${manwon(r.recognized)} · 선정기준액 ${manwon(r.limit)} ${state.household === 'single' ? '(단독)' : '(부부)'}`));
      if (!r.eligible) {
        lines.push(make('p', 'pn-calc-big', '소득인정액이 선정기준액보다 많아 기초연금 대상이 아닐 가능성이 높습니다.'));
      } else {
        const big = make('p', 'pn-calc-big');
        big.append(state.household === 'both' ? '기초연금 예상 1인당 약 ' : '기초연금 예상 월 약 ', make('strong', '', manwon(r.each)));
        if (state.household === 'both') big.append(` (부부 합계 ${manwon(r.household)})`);
        lines.push(big);
        r.notes.forEach(note => lines.push(make('p', 'pn-calc-note', `· ${note}`)));
      }
      out.replaceChildren(...lines);
      total.replaceChildren(pensionTotalCard(state, r));
    };
    const total = make('div', 'pn-total');
    update();
    const how = make('details', 'pn-how');
    how.appendChild(make('summary', '', '계산 방법 보기'));
    [
      '① 소득인정액 = 소득평가액 + 재산의 소득환산액',
      '· 소득평가액 = (근로소득 − 116만 원) × 70% + 국민연금 등 공적연금 + 기타 소득',
      '· 재산 환산 = [(집·땅 − 기본공제) + (금융재산 − 2,000만 원) − 빚] × 4% ÷ 12 (기본공제: 서울·광역시 1억 3,500만, 도의 시 8,500만, 도의 군 7,250만 원)',
      '② 선정기준액(2026): 단독 247만 원, 부부 395.2만 원 이하면 대상',
      '③ 기준연금액 월 34만 9,700원에서 시작',
      '④ 국민연금 연계감액: 국민연금이 52만 4,550원(기준연금액의 150%)을 넘고 A급여가 26만 2,275원을 넘으면 [기준연금액 − ⅔×A급여 + 17만 4,850원]과 [기준연금액×250% − 국민연금] 중 큰 금액. 최소 17만 4,850원(절반)은 보장',
      '⑤ 부부가 함께 받으면 각각 20% 감액',
      '⑥ 소득인정액 + 기초연금이 선정기준액을 넘으면 넘는 만큼 감액(소득역전방지)',
    ].forEach(text => how.appendChild(make('p', 'pn-calc-note', text)));
    const caution = make('p', 'pn-calc-caution', '간이 계산입니다. 자동차·회원권, 자녀 집 무료 거주, 부부 각자의 근로소득 공제 등은 단순화했고, 실제 금액은 신청 후 조사로 정해집니다. 정확한 판정은 주소지 행정복지센터(읍·면사무소) 또는 국민연금공단(☎1355)·복지로(☎129)에 문의하세요.');
    const links = make('div', 'pn-links');
    [['복지로 기초연금 모의계산 ↗', 'https://www.bokjiro.go.kr'], ['국민연금공단 기초연금 안내 ↗', 'https://www.nps.or.kr']].forEach(([text, href]) => {
      const a = make('a', 'btn btn-outline', text);
      a.href = href; a.target = '_blank'; a.rel = 'noopener';
      links.appendChild(a);
    });
    wrap.append(title, form, total, out, how, caution, links);
    return wrap;
  }
  // 💰 매달 받는 돈 합계: 국민연금 + 기초연금 (+ 일해서 버는 돈)
  function pensionTotalCard(state, r) {
    const won = value => Math.max(0, Number(value) || 0) * 10000;
    const national = won(state.pension);
    const basic = r.eligible ? r.household : 0;
    const work = won(state.work);
    const other = won(state.other);
    const card = make('div', 'pn-total-card');
    card.appendChild(make('p', 'pn-total-title', `💰 매달 받는 돈 합계 ${state.household === 'both' ? '(부부 기준)' : ''}`));
    const table = make('table', 'pn-total-table');
    const row = (label, value, cls = '') => {
      const tr = make('tr', cls);
      tr.append(make('th', '', label), make('td', '', value));
      table.appendChild(tr);
    };
    row('국민연금', manwon(national));
    row(state.household === 'both' ? '기초연금 (부부 합계)' : '기초연금', r.eligible ? manwon(basic) : '대상 아님');
    row('연금 합계', manwon(national + basic), 'sum');
    if (work || other) {
      if (work) row('일해서 버는 돈(근로소득)', manwon(work));
      if (other) row('기타 소득', manwon(other));
      row('모두 합친 한 달 수입', manwon(national + basic + work + other), 'sum');
    }
    card.appendChild(table);
    card.appendChild(make('p', 'pn-calc-caution', '세금·건강보험료를 빼기 전 금액입니다. 국민연금은 소득이 있으면 세금(연금소득세)과 건강보험료가 생길 수 있습니다.'));
    return card;
  }
  function pensionPolicy() {
    const wrap = make('div', 'pn-policy');
    const head = make('p', 'pn-calc-note', `${PN_POLICY_AS_OF} · 연금개혁(2025년 국회 통과)으로 2026년부터 달라진 점`);
    const list = make('ol', 'pn-policy-list');
    PN_POLICY.forEach(([title, body]) => {
      const li = make('li');
      li.append(make('strong', '', title), make('span', '', body));
      list.appendChild(li);
    });
    const sources = make('p', 'pn-calc-caution');
    sources.append('출처: ');
    PN_POLICY_SOURCES.forEach(([label, url], index) => {
      const a = make('a', '', label);
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      if (index) sources.append(' · ');
      sources.appendChild(a);
    });
    wrap.append(head, list, sources);
    return wrap;
  }
  function pensionNewsView(data) {
    const items = data.news || [];
    if (!items.length) return make('p', 'pn-empty', '최근 30일 동안 정책브리핑에 올라온 연금 소식이 없습니다. 바뀌는 정책은 「2026 달라진 점」을 확인하세요.');
    const list = make('ul', 'pn-news');
    items.forEach(item => {
      const li = make('li');
      const a = make('a', '', item.title);
      a.href = item.url;
      a.target = '_blank';
      a.rel = 'noopener';
      li.appendChild(a);
      const meta = [item.dept, item.at ? new Date(item.at).toLocaleDateString('ko-KR') : ''].filter(Boolean).join(' · ');
      if (item.sub) li.appendChild(make('span', 'pn-news-sub', item.sub));
      li.appendChild(make('span', 'pn-news-meta', meta));
      list.appendChild(li);
    });
    return list;
  }
  function renderPension() {
    const data = pn.data;
    const panel = $('pension-panel');
    if (!panel || !data) return;
    if (!data.connected) { panel.hidden = true; return; }
    panel.hidden = false;
    pn.view = pn.view || 'stats';
    panel.querySelectorAll('[data-pn-view]').forEach(chip => chip.setAttribute('aria-selected', String(chip.dataset.pnView === pn.view)));
    $('pn-regions').hidden = pn.view !== 'stats';
    $('pn-source').hidden = pn.view !== 'stats';
    if (pn.view === 'policy') { $('pn-body').replaceChildren(pensionPolicy()); return; }
    if (pn.view === 'news') { $('pn-body').replaceChildren(pensionNewsView(data)); return; }
    if (pn.view === 'calc') { $('pn-body').replaceChildren(pensionCalc()); return; }
    if (pn.view === 'basic') { $('pn-body').replaceChildren(basicPensionCalc()); return; }
    const names = data.names || [];
    $('pn-regions').replaceChildren(...names.map(entry => {
      const chip = make('button', 'chip', entry.name);
      chip.type = 'button';
      chip.setAttribute('role', 'tab');
      chip.setAttribute('aria-selected', String(entry.id === pn.region));
      chip.addEventListener('click', () => { pn.region = entry.id; renderPension(); });
      return chip;
    }));
    const region = (data.regions || []).find(entry => entry.id === pn.region);
    if (!region) {
      $('pn-body').replaceChildren(make('p', 'pn-empty', data.problems?.length ? '국민연금공단 자료 연결을 기다리고 있습니다. 승인되면 자동으로 채워집니다.' : '자료를 받아 오는 중입니다.'));
      return;
    }
    const blocks = [];
    if (region.recipients.length) {
      const block = make('div', 'pn-block');
      const h = make('h3', '', '연금 받는 분');
      h.appendChild(make('small', '', '나이별 · 노령·장애·유족 전체'));
      // 공단 자료의 나이(crtrAge)는 '그 나이 한 살'이다(60 → 만 60세). 평균 수급기간 값은 의미가 분명하지 않아 싣지 않는다.
      block.append(h, pnTable(['나이', '받는 분', '월 평균 연금'],
        region.recipients.map(row => [[`만 ${row.age}세`], [people(row.count)], [manwon(row.monthly), 'money']])));
      blocks.push(block);
    }
    if (region.subscribers.length) {
      const block = make('div', 'pn-block');
      const h = make('h3', '', '연금 내는 분 (가입자)');
      h.appendChild(make('small', '', '나이별'));
      block.append(h, pnTable(['나이', '가입자', '예상 연금(월 평균)', '평균 가입기간'],
        region.subscribers.map(row => [[`만 ${row.age}세`], [people(row.count)], [manwon(row.expected), 'money'], [period(row.months)]])));
      blocks.push(block);
    }
    $('pn-body').replaceChildren(...(blocks.length ? blocks : [make('p', 'pn-empty', '이 지역 자료가 아직 없습니다.')]));
  }
  async function loadPension() {
    try {
      const response = await fetch('/api/portal/pension', { credentials: 'same-origin' });
      if (!response.ok) return;
      pn.data = await response.json();
      renderPension();
    } catch { /* offline */ }
  }
  if ($('pension-panel')) {
    $('pension-panel').querySelectorAll('[data-pn-view]').forEach(chip => chip.addEventListener('click', () => { pn.view = chip.dataset.pnView; renderPension(); }));
    loadPension();
  }

  // ---------- 우리 동네 농사정보 (KAMIS 가격 · 농사로 주간농사정보) ----------
  const fm = { data: null, kind: 'retail' };
  const fmWon = value => (value === null || value === undefined ? '–' : `${Number(value).toLocaleString('ko-KR')}원`);
  function fmChange(now, before) {
    if (!now || !before) return ['–', ''];
    const rate = ((now - before) / before) * 100;
    if (Math.abs(rate) < 0.05) return ['–', 'same'];
    return [`${rate > 0 ? '▲' : '▼'} ${Math.abs(rate).toFixed(1)}%`, rate > 0 ? 'up' : 'down'];
  }
  // KAMIS 품목명은 '품목/품종'(예: 양파/양파, 쌀/20kg, 배추/여름(고랭지)) — 품종이 품목·단위와 같으면 떼고, 다르면 작게 붙인다.
  function fmName(row) {
    const [item, ...rest] = String(row.name || '').split('/');
    let kind = rest.join('/').trim();
    if (kind.startsWith(item) && kind !== item) kind = kind.slice(item.length).trim();
    if (!kind || kind === item || kind === row.unit) return [item, ''];
    return [item, kind];
  }
  function renderFarm() {
    const data = fm.data;
    const panel = $('farm-panel');
    if (!panel || !data) return;
    const connected = data.connected || {};
    if (!connected.prices && !connected.news) { panel.hidden = true; return; }
    panel.hidden = false;
    $('fm-updated').textContent = [connected.prices && '농산물 가격', connected.news && '이번 주 농사정보'].filter(Boolean).join(' · ');
    $('fm-source').textContent = `출처: ${[connected.prices && '한국농수산식품유통공사 농산물유통정보(KAMIS) 전국 평균 가격', connected.news && '농촌진흥청 농사로 Open API'].filter(Boolean).join(' · ')}.${connected.prices ? ' 가격은 조사일 기준이며 지역·품질에 따라 다릅니다.' : ''}`;
    const prices = data.prices;
    const rows = prices ? prices[fm.kind] || [] : [];
    $('fm-prices-block').hidden = !connected.prices;
    if (connected.prices) {
      $('fm-date').textContent = prices?.date ? `${prices.date} 조사 · 전국 평균` : '';
      panel.querySelectorAll('[data-fm-kind]').forEach(chip => chip.setAttribute('aria-selected', String(chip.dataset.fmKind === fm.kind)));
      const table = $('fm-table');
      const head = make('tr');
      ['품목', '단위', '가격', '전날보다', '한 달 전보다', '1년 전보다'].forEach(text => head.appendChild(make('th', '', text)));
      const body = rows.map(row => {
        const tr = make('tr');
        const [item, kind] = fmName(row);
        const nameCell = make('td', '', item);
        if (kind) nameCell.appendChild(make('small', 'fm-kind', ` ${kind}`));
        tr.appendChild(nameCell);
        tr.appendChild(make('td', 'fm-unit', row.unit));
        tr.appendChild(make('td', 'money', fmWon(row.price)));
        for (const before of [row.prevDay, row.prevMonth, row.prevYear]) {
          const [label, tone] = fmChange(row.price, before);
          tr.appendChild(make('td', `fm-change ${tone}`, label));
        }
        return tr;
      });
      table.replaceChildren(head, ...(body.length ? body : [(() => { const tr = make('tr'); const td = make('td', 'pn-empty', data.problems?.length ? '가격 자료를 받지 못했습니다. 잠시 뒤 다시 확인해 주세요.' : '오늘 조사된 가격이 아직 없습니다.'); td.colSpan = 6; tr.appendChild(td); return tr; })()]));
    }
    const news = data.news?.items || [];
    $('fm-news-block').hidden = !connected.news;
    if (connected.news) {
      $('fm-news').replaceChildren(...(news.length ? news.map(item => {
        const li = make('li');
        const link = make('a', '', item.title);
        link.href = item.link;
        link.target = '_blank';
        link.rel = 'noopener';
        li.appendChild(link);
        if (item.date) li.appendChild(make('span', 'fm-date', item.date));
        return li;
      }) : [make('li', 'pn-empty', '농사정보를 받아 오는 중입니다.')]));
    }
  }
  async function loadFarm() {
    try {
      const response = await fetch('/api/portal/farm', { credentials: 'same-origin' });
      if (!response.ok) return;
      fm.data = await response.json();
      renderFarm();
    } catch { /* offline */ }
  }
  if ($('farm-panel')) {
    $('farm-panel').querySelectorAll('[data-fm-kind]').forEach(chip => chip.addEventListener('click', () => { fm.kind = chip.dataset.fmKind; renderFarm(); }));
    loadFarm();
  }

  // ---------- 우리 동네 금융정보 (금융감독원 금융상품 한눈에) ----------
  const fi = { data: null, view: 'deposit', group: 'all', sort: 'max', sector: 'all', psort: 'avg3' };
  const pct = value => (value == null ? '–' : `${Number(value).toFixed(2)}%`);
  function fiFilterBar() {
    const bar = $('fi-filter');
    const chip = (label, active, onClick) => {
      const button = make('button', 'chip', label);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(active));
      button.addEventListener('click', onClick);
      return button;
    };
    if (fi.view === 'annuity') {
      const parts = [['all', '전체'], ...FI_SECTORS.map(name => [name, name])]
        .map(([id, label]) => chip(label, fi.sector === id, () => { fi.sector = id; renderFinance(); }));
      if (fi.data?.pensionSavings?.companies?.length) {
        parts.push(make('span', 'fi-sep', '·'),
          chip('3년 평균 수익률순', fi.psort === 'avg3', () => { fi.psort = 'avg3'; renderFinance(); }),
          chip('1년 수익률순', fi.psort === 'year1', () => { fi.psort = 'year1'; renderFinance(); }),
          chip('수수료 낮은순', fi.psort === 'fee', () => { fi.psort = 'fee'; renderFinance(); }));
      }
      bar.replaceChildren(...parts);
      return;
    }
    if (fi.view === 'tax' || !fi.data?.connected) { bar.replaceChildren(); return; }
    bar.replaceChildren(
      ...[['all', '전체'], ['은행', '은행'], ['저축은행', '저축은행']].map(([id, label]) => chip(label, fi.group === id, () => { fi.group = id; renderFinance(); })),
      make('span', 'fi-sep', '·'),
      chip('최고금리순', fi.sort === 'max', () => { fi.sort = 'max'; renderFinance(); }),
      chip('기본금리순', fi.sort === 'base', () => { fi.sort = 'base'; renderFinance(); }),
    );
  }
  function fiSavingsList(rows, kind) {
    let list = rows.filter(row => fi.group === 'all' || row.group === fi.group);
    if (fi.sort === 'base') list = [...list].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
    list = list.slice(0, 20);
    if (!list.length) return make('p', 'pn-empty', '보여 드릴 상품이 없습니다.');
    const wrap = make('div');
    const groupText = fi.group === 'all' ? '은행·저축은행 전체' : fi.group;
    wrap.appendChild(make('p', 'fi-sortnote', fi.sort === 'base'
      ? `${groupText} · 기본금리(우대 조건 없이 누구나 받는 금리)가 높은 순 ${list.length}개`
      : `${groupText} · 최고금리(우대 조건을 모두 채웠을 때 금리)가 높은 순 ${list.length}개`));
    if (fi.group !== '은행' && fi.sort === 'max') wrap.appendChild(make('p', 'fi-meta', '저축은행은 대부분 우대 조건이 없어 기본금리와 최고금리가 같습니다. 순서 차이는 주로 「은행」을 골랐을 때 크게 보입니다.'));
    const ol = make('ol', 'fi-list');
    wrap.appendChild(ol);
    list.forEach(row => {
      const li = make('li', 'fi-item');
      const head = make('div', 'fi-head');
      head.append(make('span', 'fi-co', row.company), make('span', 'fi-badge', row.group));
      if (row.joinDeny && row.joinDeny !== '제한 없음') head.appendChild(make('span', 'fi-badge warn', row.joinDeny));
      const name = make('p', 'fi-name', row.name);
      const rate = make('p', 'fi-rate');
      const baseFirst = fi.sort === 'base';
      rate.append(`${row.term}개월 · 기본 `, make('strong', baseFirst ? 'hi' : '', pct(row.rate)), ' · 최고 ', make('strong', baseFirst ? '' : 'hi', pct(row.maxRate)));
      if (row.rateType) rate.append(` (${row.rateType}${row.reserveType ? `·${row.reserveType}` : ''})`);
      li.append(head, name, rate);
      const meta = [row.joinWay && `가입: ${row.joinWay}`, row.member && `대상: ${row.member}`, row.maxLimit ? `한도 ${Number(row.maxLimit).toLocaleString('ko-KR')}원` : ''].filter(Boolean).join(' · ');
      if (meta) li.appendChild(make('p', 'fi-meta', meta));
      if (row.special) {
        const more = make('details', 'fi-more');
        more.append(make('summary', '', '우대 조건 보기'), make('p', 'fi-meta', row.special));
        li.appendChild(more);
      }
      ol.appendChild(li);
    });
    return wrap;
  }
  function fiAnnuityList(rows) {
    if (!rows.length) return make('p', 'pn-empty', '보여 드릴 상품이 없습니다.');
    const wrap = make('div');
    wrap.appendChild(make('p', 'pn-calc-note', '연금저축펀드는 과거 평균 수익률, 연금저축보험은 공시이율입니다. 과거 수익률이 앞으로의 수익을 보장하지 않으며, 펀드는 원금 손실이 날 수 있습니다. 연금저축은 낸 돈에 세액공제 혜택이 있습니다.'));
    const ol = make('ol', 'fi-list');
    rows.slice(0, 20).forEach(row => {
      const li = make('li', 'fi-item');
      const head = make('div', 'fi-head');
      head.append(make('span', 'fi-co', row.company), make('span', 'fi-badge', row.sector || row.group));
      if (row.pensionKind) head.appendChild(make('span', 'fi-badge', row.pensionKind));
      if (row.productType) head.appendChild(make('span', 'fi-badge', row.productType));
      const rate = make('p', 'fi-rate');
      if (row.avgRate != null) rate.append('평균 수익률 ', make('strong', 'hi', pct(row.avgRate)));
      if (row.disclosedRate != null) rate.append(row.avgRate != null ? ' · ' : '', '공시이율 ', make('strong', 'hi', pct(row.disclosedRate)));
      if (row.guaranteedRate != null) rate.append(` · 최저보증 ${pct(row.guaranteedRate)}`);
      li.append(head, make('p', 'fi-name', row.name), rate);
      const recent = row.recent.filter(value => value != null);
      if (recent.length) li.appendChild(make('p', 'fi-meta', `최근 연도별 수익률: ${row.recent.map(value => (value == null ? '–' : pct(value))).join(' / ')}`));
      ol.appendChild(li);
    });
    wrap.appendChild(ol);
    return wrap;
  }
  // 세금 덜 내는 저축 (2026년 10월 기준)
  const FI_TAX = [
    ['일반 예금·적금 이자', '이자의 15.4%(소득세 14% + 지방소득세 1.4%)를 떼고 받습니다.'],
    ['비과세종합저축', '만 65세 이상 기초연금 수급자(2026년 신규 가입부터), 장애인, 독립·국가유공자, 기초생활수급자 등. 전 금융회사 합쳐 1인당 원금 5,000만 원까지 이자에 세금이 없습니다. 2028년 말까지 가입. 최근 3년 안에 금융소득종합과세 대상이었다면 가입할 수 없습니다.'],
    ['농협·수협·신협·산림조합·새마을금고 조합원 예탁금', '조합원(준조합원)이면 1인당 3,000만 원까지 이자에 농어촌특별세 1.4%만 냅니다(출자금은 2,000만 원까지 배당 비과세). 2026년부터 총급여 7,000만 원(종합소득 6,000만 원) 넘는 분은 단계적으로 세율이 오르고, 그 이하인 분은 당분간 1.4%가 유지됩니다.'],
    ['ISA(개인종합자산관리계좌)', '3년 이상 유지하면 이익 200만 원(서민·농어민형 400만 원)까지 비과세, 넘는 부분은 9.9%만 냅니다. 한 해 2,000만 원(총 1억 원)까지 넣을 수 있습니다.'],
  ];
  function fiTaxView() {
    const wrap = make('div', 'pn-calc');
    const list = make('ol', 'pn-policy-list');
    FI_TAX.forEach(([title, body]) => { const li = make('li'); li.append(make('strong', '', title), make('span', '', body)); list.appendChild(li); });
    wrap.appendChild(make('p', 'pn-calc-title', '🧾 같은 이자라도 어디에 맡기느냐에 따라 손에 쥐는 돈이 달라집니다 (2026년 10월 기준)'));
    wrap.appendChild(list);
    const form = make('div', 'pn-calc-form');
    const state = fi.tax || (fi.tax = { amount: 3000, rate: 3.5, months: 12 });
    const input = (label, key, attrs) => {
      const box = make('label', 'pn-field');
      box.appendChild(make('span', '', label));
      const el = make('input');
      Object.assign(el, { type: 'number', min: 0, step: 'any', inputMode: 'decimal', value: state[key], ...attrs });
      el.addEventListener('input', () => { state[key] = el.value; update(); });
      box.appendChild(el);
      form.appendChild(box);
    };
    input('맡길 돈(만 원)', 'amount', {});
    input('연 금리(%)', 'rate', {});
    input('기간(개월)', 'months', { step: 1 });
    const out = make('div', 'pn-total-card');
    const update = () => {
      const principal = Math.max(0, Number(state.amount) || 0) * 10000;
      const rate = Math.max(0, Number(state.rate) || 0) / 100;
      const months = Math.max(0, Number(state.months) || 0);
      const interestOf = amount => amount * rate * (months / 12);
      const gross = interestOf(principal);
      const mutualPart = Math.min(principal, 30000000);
      const freePart = Math.min(principal, 50000000);
      const cases = [
        ['일반 과세 (15.4%)', gross * 0.154],
        ['조합 예탁금 (3,000만 원까지 1.4%)', interestOf(mutualPart) * 0.014 + interestOf(principal - mutualPart) * 0.154],
        ['비과세종합저축 (5,000만 원까지 0%)', interestOf(principal - freePart) * 0.154],
        ['ISA 일반형 (200만 원까지 0%, 초과 9.9%)', Math.max(0, gross - 2000000) * 0.099],
      ];
      out.replaceChildren(make('p', 'pn-total-title', `💵 세전 이자 ${Math.round(gross).toLocaleString('ko-KR')}원 → 세후 받는 이자`));
      const table = make('table', 'pn-total-table');
      cases.forEach(([label, tax]) => {
        const tr = make('tr');
        tr.append(make('th', '', label), make('td', '', `${Math.round(gross - tax).toLocaleString('ko-KR')}원 (세금 ${Math.round(tax).toLocaleString('ko-KR')}원)`));
        table.appendChild(tr);
      });
      out.appendChild(table);
      out.appendChild(make('p', 'pn-calc-caution', '단리로 단순 계산했습니다. 각 제도는 가입 자격과 한도가 있고(위 설명 참고), ISA는 3년 이상 유지 등 조건을 채워야 합니다.'));
    };
    update();
    wrap.append(form, out);
    return wrap;
  }
  // 연금저축: 판매 회사 종류별 안내 (금감원 Open API가 연금저축 목록을 주지 않을 때도 보여 준다)
  const FI_SECTORS = ['은행', '생명보험', '손해보험', '금융투자'];
  const FI_SECTOR_INFO = {
    은행: { product: '연금저축신탁', points: [
      '2018년 1월부터 새로 가입할 수 없습니다. 이미 가입한 분만 계속 넣을 수 있습니다.',
      '은행 창구에서 새로 들려면 은행이 판매하는 연금저축펀드(운용은 자산운용사)나 개인형 퇴직연금(IRP)을 이용합니다.',
      '기존 신탁은 실적에 따라 수익이 달라지며, 다른 회사 연금저축으로 세금 불이익 없이 옮길(이전) 수 있습니다.',
    ] },
    생명보험: { product: '연금저축보험', points: [
      '보험사가 정하는 공시이율로 쌓이고, 최저보증이율 아래로는 내려가지 않습니다.',
      '살아 있는 동안 계속 받는 종신연금을 고를 수 있는 것은 생명보험 연금저축뿐입니다.',
      '예금자보호(1인당 1억 원, 같은 회사의 다른 보호상품과 합산)를 받습니다.',
      '사업비(수수료)를 먼저 떼므로, 일찍 해지하면 낸 돈보다 적게 받을 수 있습니다. 정해진 날짜에 꼬박꼬박 내야 합니다.',
    ] },
    손해보험: { product: '연금저축손해보험', points: [
      '공시이율로 쌓이고 최저보증이율이 있습니다(화재·손해보험사 상품).',
      '연금은 정해진 기간(최장 25년) 동안만 받는 확정기간형이며, 종신형은 없습니다.',
      '예금자보호(1인당 1억 원, 같은 회사의 다른 보호상품과 합산)를 받습니다.',
      '사업비 때문에 일찍 해지하면 낸 돈보다 적게 받을 수 있습니다.',
    ] },
    금융투자: { product: '연금저축펀드', points: [
      '증권사에서 계좌를 열고 그 안에서 펀드(ETF 포함)를 골라 굴립니다.',
      '투자 결과에 따라 수익이 나거나 원금 손실이 날 수 있고, 예금자보호가 없습니다.',
      '돈을 넣는 시기와 금액이 자유롭고, 상품을 바꿔 타기 쉽습니다.',
      '과거 수익률이 앞으로의 수익을 보장하지 않습니다.',
    ] },
  };
  function fiAnnuityGuide(sector, hasData) {
    const box = make('div', 'fi-guide');
    if (sector === 'all') {
      box.appendChild(make('p', 'fi-name', '연금저축은 「낼 때 세금을 돌려받는」 노후 저축입니다'));
      const ul = make('ul', 'fi-guide-list');
      [
        '1년에 낸 돈 중 600만 원까지(퇴직연금 IRP와 합쳐 900만 원까지) 세액공제를 받습니다.',
        '공제율: 총급여 5,500만 원(종합소득 4,500만 원) 이하 16.5%, 그 위는 13.2% — 600만 원을 내면 79만~99만 원을 돌려받습니다.',
        '55세 이후 10년 넘게 나눠 받으면 연금소득세 5.5%(70세 미만)·4.4%(70~79세)·3.3%(80세 이상)만 냅니다.',
        '중간에 깨면 공제받은 부분과 이익에 16.5%(기타소득세)를 냅니다.',
      ].forEach(text => ul.appendChild(make('li', '', text)));
      box.appendChild(ul);
      const table = make('ul', 'fi-guide-list');
      FI_SECTORS.forEach(name => table.appendChild(make('li', '', `${name}: ${FI_SECTOR_INFO[name].product} — ${FI_SECTOR_INFO[name].points[0]}`)));
      box.append(make('p', 'fi-name', '어디서 파나요? (위 칸을 누르면 자세히 볼 수 있습니다)'), table);
    } else {
      const info = FI_SECTOR_INFO[sector];
      box.appendChild(make('p', 'fi-name', `${sector} — ${info.product}`));
      const ul = make('ul', 'fi-guide-list');
      info.points.forEach(text => ul.appendChild(make('li', '', text)));
      box.appendChild(ul);
    }
    if (!hasData) box.appendChild(make('p', 'fi-meta', '회사별 수익률·수수료율 비교는 금융감독원 통합연금포털 자료를 연결하는 중입니다. 연결되면 이 칸에 회사 순위가 나옵니다. 그전에는 아래 금감원 화면에서 확인해 주세요.'));
    const link = make('a', 'fi-link', '금감원 「금융상품 한눈에」 열기 ↗ (연금 → 연금저축)');
    link.href = 'https://finlife.fss.or.kr/';
    link.target = '_blank'; link.rel = 'noopener';
    box.appendChild(link);
    return box;
  }
  // 통합연금포털 회사별 수익률·수수료율 + 원리금보장 연금저축보험 공시이율
  const fiYear1 = row => row.earnRate1 ?? row.earnRate;
  function fiPensionCompanies(ps, sector) {
    const wrap = make('div', 'fi-ps');
    const sortKey = fi.psort === 'fee' ? row => -(row.fee3 ?? row.feeRate1 ?? 99) : fi.psort === 'year1' ? row => fiYear1(row) ?? -99 : row => row.avg3 ?? -99;
    const sectors = sector === 'all' ? FI_SECTORS : [sector];
    const label = fi.psort === 'fee' ? '3년 평균 수수료율이 낮은 순' : fi.psort === 'year1' ? '최근 1년 수익률이 높은 순' : '최근 3년 연평균 수익률이 높은 순';
    wrap.appendChild(make('p', 'fi-sortnote', `회사별 연금저축 ${label}${ps.basis ? ` (${ps.basis} 공시)` : ''}`));
    sectors.forEach(name => {
      const rows = ps.companies.filter(row => row.sector === name).sort((a, b) => sortKey(b) - sortKey(a));
      if (!rows.length) return;
      const shown = sector === 'all' ? rows.slice(0, 3) : rows.slice(0, 15);
      if (sector === 'all') wrap.appendChild(make('p', 'fi-name', `${name} 상위 3곳 (${FI_SECTOR_INFO[name].product})`));
      const ol = make('ol', 'fi-list');
      shown.forEach(row => {
        const li = make('li', 'fi-item');
        const head = make('div', 'fi-head');
        head.append(make('span', 'fi-co', row.company), make('span', 'fi-badge', row.sector));
        const rate = make('p', 'fi-rate');
        rate.append('3년 평균 ', make('strong', fi.psort === 'avg3' ? 'hi' : '', pct(row.avg3)),
          ' · 1년 ', make('strong', fi.psort === 'year1' ? 'hi' : '', pct(fiYear1(row))),
          ' · 수수료 ', make('strong', fi.psort === 'fee' ? 'hi' : '', pct(row.fee3 ?? row.feeRate1)));
        li.append(head, rate);
        const meta = [row.avg5 != null && `5년 평균 ${pct(row.avg5)}`, row.avg10 != null && `10년 평균 ${pct(row.avg10)}`, row.reserve ? `적립금 ${Math.round(row.reserve / 1e8).toLocaleString('ko-KR')}억 원` : ''].filter(Boolean).join(' · ');
        if (meta) li.appendChild(make('p', 'fi-meta', meta));
        ol.appendChild(li);
      });
      wrap.appendChild(ol);
    });
    const guar = ps.guaranteed.filter(row => sectors.includes(row.sector)).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
    if (guar.length) {
      wrap.appendChild(make('p', 'fi-sortnote', '지금 판매 중인 원리금보장 연금저축보험 — 공시이율 높은 순'));
      const ol = make('ol', 'fi-list');
      guar.slice(0, sector === 'all' ? 5 : 15).forEach(row => {
        const li = make('li', 'fi-item');
        const head = make('div', 'fi-head');
        head.append(make('span', 'fi-co', row.company), make('span', 'fi-badge', row.sector));
        const rate = make('p', 'fi-rate');
        rate.append('공시이율 ', make('strong', 'hi', pct(row.rate)), ` · 최저보증 ${pct(row.guaranteed)}`);
        li.append(head, make('p', 'fi-name', row.product), rate);
        if (row.online) li.appendChild(make('p', 'fi-meta', `온라인 가입 수수료: ${row.online.replace(/\|/g, ' / ')}`));
        ol.appendChild(li);
      });
      wrap.appendChild(ol);
    }
    wrap.appendChild(make('p', 'pn-calc-note', '수익률은 회사가 운용한 연금저축 전체의 과거 실적이며 앞으로의 수익을 보장하지 않습니다. 수수료가 낮을수록 오래 넣을 때 유리합니다. 특정 회사 가입을 권하는 것이 아닙니다.'));
    wrap.appendChild(make('p', 'fi-meta', '출처: 통합연금포털(금융감독원) 콘텐츠'));
    return wrap;
  }
  function renderFinance() {
    const panel = $('finance-panel');
    if (!panel) return;
    const data = fi.data || {};
    if (data.connected === false && (fi.view === 'deposit' || fi.view === 'saving')) fi.view = 'tax';
    panel.querySelectorAll('[data-fi-view]').forEach(chip => chip.setAttribute('aria-selected', String(chip.dataset.fiView === fi.view)));
    fiFilterBar();
    const body = $('fi-body');
    if (fi.view === 'tax') { body.replaceChildren(fiTaxView()); return; }
    if (fi.view === 'annuity' && data.pensionSavings?.companies?.length) {
      const details = make('details', 'fi-more');
      details.append(make('summary', '', fi.sector === 'all' ? '연금저축 세액공제·종류 안내 보기' : `${fi.sector} 연금저축 특징 보기`), fiAnnuityGuide(fi.sector, true));
      body.replaceChildren(fiPensionCompanies(data.pensionSavings, fi.sector), details);
      return;
    }
    if (fi.view === 'annuity' && data.connected === false) { body.replaceChildren(fiAnnuityGuide(fi.sector, false)); return; }
    if (!fi.data) { body.replaceChildren(make('p', 'pn-empty', '금융감독원에서 금리 자료를 받아 오는 중입니다… (처음 한 번은 10~20초 걸릴 수 있습니다)')); return; }
    if (!data.connected) { body.replaceChildren(make('p', 'pn-empty', '금리 자료를 연결하는 중입니다.')); return; }
    const rows = fi.view === 'deposit' ? data.deposits : fi.view === 'saving' ? data.savings : data.annuities;
    if (fi.view === 'annuity') {
      const list = (rows || []).filter(row => fi.sector === 'all' || row.sector === fi.sector);
      const parts = [fiAnnuityGuide(fi.sector, list.length > 0)];
      if (list.length) parts.push(fiAnnuityList(list));
      body.replaceChildren(...parts);
      return;
    }
    if (!rows?.length && data.problems?.length) { body.replaceChildren(make('p', 'pn-empty', '금융감독원 자료를 잠시 받지 못했습니다. 잠시 뒤 다시 확인해 주세요.')); return; }
    body.replaceChildren(fi.view === 'annuity' ? fiAnnuityList(rows || []) : fiSavingsList(rows || [], fi.view));
  }
  async function loadFinance() {
    try {
      const response = await fetch('/api/portal/finance', { credentials: 'same-origin' });
      fi.data = response.ok ? await response.json() : { connected: false };
    } catch { fi.data = { connected: false }; }
    renderFinance();
  }
  if ($('finance-panel')) {
    $('finance-panel').querySelectorAll('[data-fi-view]').forEach(chip => chip.addEventListener('click', () => { fi.view = chip.dataset.fiView; renderFinance(); }));
    loadFinance();
  }

  // ---------- 첫 화면 사진 카드의 '살아 있는 소식 한 줄': 접속자·방금 올라온 글·정책브리핑을 번갈아 보여 준다 ----------
  const heroTicker = { index: 0, timer: null };
  function heroTickerItems() {
    const items = ['CONNECTING IDEAS · 생각이 연결되는 곳'];
    if (Number(state.online) > 0) items.push(`지금 ${state.online}명이 광장에서 이야기 중`);
    const latest = allPosts()[0];
    if (latest) items.push(`방금 올라온 글 · ${titleOf(latest).slice(0, 34)}`);
    const policy = (policyData?.items || []).find(item => item.kind !== 'fact');
    if (policy) items.push(`오늘의 정책 · ${policy.title.slice(0, 34)}`);
    return items;
  }
  function startHeroTicker() {
    const element = $('hero-ticker');
    if (!element || heroTicker.timer || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    heroTicker.timer = setInterval(() => {
      if (document.hidden) return;
      const items = heroTickerItems();
      heroTicker.index = (heroTicker.index + 1) % items.length;
      element.textContent = items[heroTicker.index];
      element.classList.remove('swap');
      void element.offsetWidth;
      element.classList.add('swap');
    }, 4500);
  }
  startHeroTicker();

  function renderOnline(count) {
    state.online = count;
    const known = Number.isFinite(count);
    if ($('chat-online')) $('chat-online').textContent = known ? `${count}명 접속` : '접속 확인 중';
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
      renderEcoMini(data.indicators);
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
    if (!list) return; // 홈에서 채팅 미리보기를 뺀 뒤에도 오류 없이
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
  $('sub-go')?.addEventListener('click', () => setTimeout(() => $('newsletter-email')?.focus({ preventScroll: true }), 500));

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
  // 광고 번호가 없는 자리는 숨기고, 맨 아래 한 곳만 '스페이스 커뮤니티 안내'를 보여 준다 (홈에 빈 공간·중복 안내가 생기지 않게)
  const houseOnly = container => container.dataset.ad === 'bottom';
  document.querySelectorAll('.ad-slot[data-ad]').forEach((container, offset) => {
    const slot = AD_SLOTS[container.dataset.ad];
    if (!slot) { if (houseOnly(container)) houseAd(container, 0); return; }
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
      if (ins.dataset.adStatus === 'unfilled') { ins.remove(); if (houseOnly(container)) houseAd(container, 0); else container.hidden = true; }
    }).observe(ins, { attributes: true, attributeFilter: ['data-ad-status'] });
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (error) { console.error('AdSense push failed:', error); if (houseOnly(container)) houseAd(container, 0); else container.hidden = true; }
  });

  if (window.spaceBoards) renderBoards();
})();
