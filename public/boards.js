(() => {
  const categories = [{ title: '재정·경제산업부', depts: [{ id: 'economy', name: '기획재정부' }, { id: 'industry', name: '산업통상자원부' }, { id: 'finance', name: '금융위원회' }, { id: 'sme', name: '중소벤처기업부' }] },
    { title: '사회·교육·문화', depts: [{ id: 'education', name: '교육부' }, { id: 'culture', name: '문화체육관광부' }, { id: 'welfare', name: '보건복지부' }, { id: 'labor', name: '고용노동부' }, { id: 'gender', name: '여성가족부' }, { id: 'environment', name: '환경부' }] },
    { title: '외교·안보·통일', depts: [{ id: 'foreign', name: '외교부' }, { id: 'unification', name: '통일부' }, { id: 'defense', name: '국방부' }] },
    { title: '과학·인프라', depts: [{ id: 'science', name: '과학기술정보통신부' }, { id: 'landtransport', name: '국토교통부' }, { id: 'agriculture', name: '농림축산식품부' }, { id: 'ocean', name: '해양수산부' }] },
    { title: '일반행정·법무', depts: [{ id: 'safety', name: '행정안전부' }, { id: 'justice', name: '법무부' }, { id: 'personnel', name: '인사혁신처' }] }];
  const $ = id => document.getElementById(id);
  const state = { about: null, user: null, mailConfigured: false, ready: false, sort: 'latest', keyword: '', posts: { community: [], voice: [], policy: [], research: [] } };
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

  // 정책 제안은 부처 칸이 20개라 아래쪽 안내 줄이 보이지 않으므로, 등록을 누른 부처 칸 바로 아래에도 결과를 보여 준다.
  let policyCard = null;
  function setStatus(board, message, isError = false) {
    const element = statusOf[board];
    if (element) {
      element.textContent = message;
      element.dataset.error = String(isError);
    }
    // 결과 문구는 글 목록(.policy-output)과 따로 둔 안내 줄에 쓴다(글 목록을 덮지 않게).
    const note = board === 'policy' && policyCard?.querySelector('.policy-status');
    if (note) {
      note.textContent = message;
      note.classList.toggle('policy-error', isError);
      note.dataset.error = String(isError);
      note.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
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
      card.dataset.dept = dept.id;
      card.appendChild(make('h4', '', dept.name));
      const titleInput = make('input', 'post-title-input');
      titleInput.maxLength = 120;
      titleInput.placeholder = '제목 (선택)';
      titleInput.setAttribute('aria-label', `${dept.name} 제안 제목`);
      card.appendChild(titleInput);
      const textarea = make('textarea');
      textarea.dataset.placeholder = `${dept.name} 관련 의견을 작성하세요`;
      textarea.maxLength = 20000;
      const button = make('button', 'submitPolicy', '제안 등록');
      button.dataset.dept = dept.id;
      const output = make('div', 'policy-output');
      output.id = `output-${dept.id}`;
      // 긴 정책 제안도 표·소제목으로 정리할 수 있게: 표 붙여넣기 변환과 📋 표 넣기 단추
      tablePaste(textarea);
      const tools = make('div', 'photo-row');
      const tableButton = make('button', 'like-btn table-add', '📋 표 넣기');
      tableButton.type = 'button';
      tableButton.addEventListener('click', () => openTableMaker(textarea));
      tools.append(tableButton, make('span', 'photo-note', '소제목은 줄 앞에 ## 또는 ■ · 밑줄은 __글자__ · 2만 자까지'));
      const cardStatus = make('p', 'form-status policy-status');
      cardStatus.setAttribute('role', 'status');
      card.append(textarea, tools, button, cardStatus, output);
      // 붙여넣은 글이 2만 자를 넘으면 브라우저가 뒤쪽을 잘라 버리므로 바로 알려 준다.
      textarea.addEventListener('paste', () => setTimeout(() => {
        if (textarea.value.length >= textarea.maxLength) {
          cardStatus.textContent = `글이 ${textarea.maxLength.toLocaleString('ko-KR')}자를 넘어 뒤쪽이 잘렸습니다. 별첨·참고자료 부분을 빼고 본문만 붙여넣어 주세요.`;
          cardStatus.classList.add('policy-error');
          cardStatus.dataset.error = 'true';
        }
      }, 0));
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

  // 칼럼·학술: 누구나 읽고, 글쓰기는 회원만. 비회원에게는 글쓰기 칸 대신 로그인 안내를 보인다.
  const researchComposer = $('research-section').querySelector('.post-composer');
  const researchLock = make('div', 'notice');
  researchLock.hidden = true;
  researchLock.innerHTML = '<strong>글쓰기는 회원만</strong><br>칼럼·학술 글은 누구나 읽을 수 있고, 글은 가입한 회원이 쓸 수 있습니다. ';
  const lockLogin = make('button', 'submitPolicy', '로그인');
  const lockSignup = make('button', 'submitPolicy', '회원가입');
  lockLogin.type = lockSignup.type = 'button';
  lockLogin.addEventListener('click', () => window.spaceOpenAuth?.('login'));
  lockSignup.addEventListener('click', () => window.spaceOpenAuth?.('signup'));
  researchLock.append(lockLogin, ' ', lockSignup);
  researchComposer.before(researchLock);
  $('researchFilter').closest('.post-controls').classList.add('filter-row');

  // ---------- 사진 첨부 (글쓰기 칸에 붙여넣기·끌어다 놓기·📷 버튼) ----------
  // 사진은 화면에서 긴 변 1600px JPEG로 줄여 올린다. 다시 그려 저장하므로 촬영 위치(GPS) 같은 정보는 지워진다.
  const MAX_PHOTOS = 4;
  async function shrinkPhoto(file) {
    let source;
    try {
      source = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      source = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('unreadable'));
        image.src = URL.createObjectURL(file);
      }).catch(() => null);
    }
    if (!source) throw new Error(/heic|heif/i.test(file.type || file.name) ? '이 사진 형식(HEIC)은 이 브라우저에서 열 수 없어요. 사진을 JPG로 저장하거나 화면을 캡처해 올려 주세요.' : '사진을 읽을 수 없습니다. JPG·PNG 사진을 골라 주세요.');
    const width = source.width;
    const height = source.height;
    const scale = Math.min(1, 1600 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    source.close?.();
    for (const quality of [0.85, 0.72, 0.6]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= 1400 * 1024) return blob;
    }
    throw new Error('사진이 너무 큽니다. 더 작은 사진을 골라 주세요.');
  }
  async function uploadPhoto(blob) {
    const response = await fetch('/api/board/image', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'image/jpeg', 'X-CSRF-Token': window.spaceAuth?.csrfToken || '' }, body: blob,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `사진 올리기 실패 (${response.status})`);
    return result.id;
  }
  const photoUrl = id => `/api/board/image?id=${id}`;
  // 글쓰기 칸 하나에 붙는 사진 고르기 도구. existing: 수정할 때 이미 붙어 있는 사진 id들.
  // ---------- 📋 표 넣기: 칸에 바로 적어 표를 만들고, 글쓰기 칸 커서 자리에 넣는다 ----------
  // 표는 '칸 | 칸 | 칸' 글자로 들어가고, 등록하면 게시판·글 화면에서 테두리 있는 표로 보인다(rich-text.js).
  function openTableMaker(textarea) {
    const dialog = make('dialog', 'table-maker');
    dialog.setAttribute('aria-label', '표 넣기');
    let grid = [['항목', '내용', '비고'], ['', '', ''], ['', '', '']];
    const head = make('div', 'tm-head');
    head.append(make('strong', '', '📋 표 넣기'), make('span', 'tm-hint', '첫 줄은 머리줄(회색 칸)입니다. 숫자는 오른쪽에 맞춰져요.'));
    const tools = make('div', 'tm-tools');
    const wrap = make('div', 'tm-wrap');
    const table = make('table', 'tm-grid');
    wrap.appendChild(table);
    const status = make('p', 'tm-status');
    const read = () => { grid = [...table.rows].map(row => [...row.cells].map(cell => cell.querySelector('input').value)); };
    const draw = focus => {
      table.replaceChildren(...grid.map((cells, r) => {
        const tr = make('tr', r === 0 ? 'tm-header' : '');
        cells.forEach((value, c) => {
          const td = make('td');
          const input = make('input');
          input.type = 'text';
          input.value = value;
          input.maxLength = 80;
          input.placeholder = r === 0 ? `제목 ${c + 1}` : '';
          input.setAttribute('aria-label', `${r + 1}번째 줄 ${c + 1}번째 칸`);
          input.addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            read();
            if (r === grid.length - 1) { grid.push(Array(grid[0].length).fill('')); draw([r + 1, c]); }
            else table.rows[r + 1].cells[c].querySelector('input').focus();
          });
          // 한글·엑셀에서 여러 칸을 복사해 붙이면 칸마다 나눠 채운다.
          input.addEventListener('paste', event => {
            const text = event.clipboardData?.getData('text/plain') || '';
            if (!/[\t\n]/.test(text.trim())) return;
            event.preventDefault();
            read();
            text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').forEach((line, dr) => {
              line.split('\t').forEach((cellText, dc) => {
                while (grid.length <= r + dr) grid.push(Array(grid[0].length).fill(''));
                if (grid[0].length <= c + dc && grid[0].length < 10) grid.forEach(row => row.push(''));
                if (c + dc < grid[0].length) grid[r + dr][c + dc] = cellText.trim();
              });
            });
            draw([r, c]);
          });
          td.appendChild(input);
          tr.appendChild(td);
        });
        return tr;
      }));
      if (focus) table.rows[focus[0]]?.cells[focus[1]]?.querySelector('input')?.focus();
    };
    const tool = (label, action, title) => {
      const button = make('button', 'like-btn', label);
      button.type = 'button';
      button.title = title;
      button.addEventListener('click', () => { read(); action(); draw(); });
      tools.appendChild(button);
    };
    tool('＋ 줄', () => { if (grid.length < 40) grid.push(Array(grid[0].length).fill('')); }, '맨 아래에 줄 더하기');
    tool('－ 줄', () => { if (grid.length > 2) grid.pop(); }, '맨 아래 줄 빼기');
    tool('＋ 칸', () => { if (grid[0].length < 10) grid.forEach(row => row.push('')); }, '오른쪽에 칸 더하기');
    tool('－ 칸', () => { if (grid[0].length > 2) grid.forEach(row => row.pop()); }, '맨 오른쪽 칸 빼기');
    const actions = make('div', 'tm-actions');
    const cancel = make('button', 'btn btn-outline', '취소');
    cancel.type = 'button';
    const insert = make('button', 'submitPolicy', '표 넣기');
    insert.type = 'button';
    actions.append(cancel, insert);
    dialog.append(head, tools, wrap, status, actions);
    document.body.appendChild(dialog);
    const close = () => { dialog.close(); dialog.remove(); };
    cancel.addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    insert.addEventListener('click', () => {
      read();
      // 칸 안의 | 는 표를 나누는 표시와 겹치므로 ／ 로 바꾸고, 내용이 없는 줄은 뺀다(머리줄은 남김).
      const clean = value => String(value || '').replace(/\|/g, '／').replace(/\s+/g, ' ').trim();
      const rows = grid.map(cells => cells.map(clean)).filter((cells, index) => index === 0 || cells.some(Boolean));
      if (rows.length < 2 || !rows[0].some(Boolean)) {
        status.textContent = '머리줄과 내용을 한 줄 이상 적어 주세요.';
        return;
      }
      // 빈 칸은 '-' 로 채워 표 모양이 흐트러지지 않게 한다.
      const text = rows.map(cells => cells.map(value => value || '-').join(' | ')).join('\n');
      const before = textarea.value.slice(0, textarea.selectionStart);
      const after = textarea.value.slice(textarea.selectionEnd);
      const lead = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
      const tail = after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
      textarea.focus();
      textarea.setRangeText(`${lead}${text}${tail}`, textarea.selectionStart, textarea.selectionEnd, 'end');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      close();
    });
    draw();
    dialog.showModal();
    table.rows[0].cells[0].querySelector('input').select();
  }

  // 한글·엑셀·웹에서 표를 복사해 붙이면 칸 사이를 탭으로 바꿔 넣는다(글 화면에서 표로 보임).
  function tablePaste(textarea) {
    textarea.addEventListener('paste', event => {
      const html = event.clipboardData?.getData('text/html') || '';
      if (!/<table[\s>]/i.test(html)) return;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const parts = [];
      let used = false;
      const walk = node => {
        if (node.nodeType === 3) { parts.push(node.textContent); return; }
        if (node.nodeType !== 1) return;
        if (node.tagName === 'TABLE') {
          used = true;
          const rows = [...node.querySelectorAll('tr')].map(row => [...row.children].filter(cell => /^T[DH]$/.test(cell.tagName))
            .map(cell => cell.innerText?.trim?.() ?? cell.textContent.replace(/\s+/g, ' ').trim()).map(text => text.replace(/[\t\n]+/g, ' ')))
            .filter(row => row.some(Boolean));
          parts.push(`\n${rows.map(row => row.join('\t')).join('\n')}\n`);
          return;
        }
        if (/^(BR)$/.test(node.tagName)) { parts.push('\n'); return; }
        const block = /^(P|DIV|H[1-6]|LI|UL|OL|SECTION|ARTICLE)$/.test(node.tagName);
        if (block) parts.push('\n');
        node.childNodes.forEach(walk);
        if (block) parts.push('\n');
      };
      walk(doc.body);
      if (!used) return;
      const text = parts.join('').replace(/[ \u00a0]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      event.preventDefault();
      textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, 'end');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function photoPicker(board, textarea, existing = []) {
    tablePaste(textarea);
    const photos = existing.map(id => ({ id, url: photoUrl(id) }));
    const box = make('div', 'photo-picker');
    const row = make('div', 'photo-row');
    const add = make('button', 'like-btn photo-add', '📷 사진 첨부');
    add.type = 'button';
    add.title = '사진 고르기 (붙여넣기·끌어다 놓기도 됩니다)';
    const file = make('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.multiple = true;
    file.hidden = true;
    const note = make('span', 'photo-note', `최대 ${MAX_PHOTOS}장 · 사진 위치정보는 자동으로 지워져요. 얼굴·차량번호는 가려 주세요.`);
    const strip = make('div', 'photo-strip');
    const tableButton = make('button', 'like-btn table-add', '📋 표 넣기');
    tableButton.type = 'button';
    tableButton.title = '줄·칸 수를 정하고 내용을 채워 표를 넣습니다';
    tableButton.addEventListener('click', () => openTableMaker(textarea));
    row.append(add, tableButton, file, note);
    box.append(row, strip);
    const draw = () => {
      strip.replaceChildren(...photos.map(photo => {
        const cell = make('figure', `photo-thumb${photo.busy ? ' busy' : ''}`);
        const image = make('img');
        image.src = photo.url;
        image.alt = '첨부할 사진';
        const remove = make('button', 'photo-remove', '✕');
        remove.type = 'button';
        remove.title = '이 사진 빼기';
        remove.setAttribute('aria-label', '이 사진 빼기');
        remove.addEventListener('click', () => { photos.splice(photos.indexOf(photo), 1); draw(); });
        cell.append(image, remove);
        if (photo.busy) cell.appendChild(make('figcaption', '', '올리는 중…'));
        return cell;
      }));
      strip.hidden = !photos.length;
      add.disabled = photos.length >= MAX_PHOTOS;
    };
    async function addFiles(files) {
      const list = [...files].filter(item => item.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(item.name || ''));
      if (!list.length) return false;
      if (!canWrite()) {
        setStatus(board, writeHint(), true);
        if (!state.user) window.spaceOpenAuth?.('login');
        return true;
      }
      for (const item of list) {
        if (photos.length >= MAX_PHOTOS) { setStatus(board, `사진은 글 하나에 ${MAX_PHOTOS}장까지 붙일 수 있습니다.`, true); break; }
        const photo = { id: null, url: URL.createObjectURL(item), busy: true };
        photos.push(photo);
        draw();
        try {
          const blob = await shrinkPhoto(item);
          URL.revokeObjectURL(photo.url);
          photo.url = URL.createObjectURL(blob);
          photo.id = await uploadPhoto(blob);
          photo.busy = false;
          setStatus(board, '사진을 붙였습니다. 내용을 확인하고 등록해 주세요.');
        } catch (error) {
          photos.splice(photos.indexOf(photo), 1);
          setStatus(board, error.message, true);
        }
        draw();
      }
      return true;
    }
    add.addEventListener('click', () => file.click());
    file.addEventListener('change', () => { addFiles(file.files); file.value = ''; });
    // 복사한 사진을 글쓰기 칸에 Ctrl+V(휴대폰은 길게 눌러 붙여넣기)로 넣을 수 있다.
    const area = textarea.closest('.post-composer, form, .research-composer') || textarea.parentElement || textarea;
    area.addEventListener('paste', event => {
      const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(file.name || ''));
      if (!files.length) files.push(...[...(event.clipboardData?.items || [])].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean));
      if (!files.length) return;
      event.preventDefault();
      addFiles(files);
    });
    area.addEventListener('dragover', event => { if ([...(event.dataTransfer?.types || [])].includes('Files')) event.preventDefault(); });
    area.addEventListener('drop', event => {
      if (!event.dataTransfer?.files?.length) return;
      event.preventDefault();
      addFiles(event.dataTransfer.files);
    });
    draw();
    return {
      element: box,
      addFiles,
      ids: () => photos.filter(photo => photo.id).map(photo => photo.id),
      busy: () => photos.some(photo => photo.busy),
      clear: () => { photos.length = 0; draw(); },
    };
  }
  function postPhotos(post) {
    const grid = make('div', `post-photos n${Math.min(post.images.length, 4)}`);
    post.images.forEach((id, index) => {
      const link = make('a');
      link.href = photoUrl(id);
      link.target = '_blank';
      link.rel = 'noopener';
      const image = make('img');
      image.src = photoUrl(id);
      image.loading = 'lazy';
      image.alt = `첨부 사진 ${index + 1}`;
      link.appendChild(image);
      grid.appendChild(link);
    });
    return grid;
  }

  // ---------- 시민의 소리 → 공식 민원 창구 잇기 ----------
  // 국민신문고·안전신문고는 외부 사이트가 대신 접수할 수 없어(본인 인증 필요), 민원 양식에 맞춘 글을 복사해 주고 접수 화면을 연다.
  const OFFICIAL = [
    { id: 'epeople', name: '국민신문고', url: 'https://www.epeople.go.kr', when: '설치·개선 요청, 행정 불편, 정책 제안', how: '로그인 → 민원신청 → 처리기관에서 해당 시·군(예: 양산시)을 고르고 붙여넣기' },
    { id: 'safety', name: '안전신문고', url: 'https://www.safetyreport.go.kr', when: '가로등 고장, 도로 파손, 위험 시설 등 안전 신고', how: '안전신문고 앱(권장) 또는 누리집 → 신고하기 → 사진을 찍어 올리고 붙여넣기(위치가 함께 들어갑니다)' },
  ];
  const PROGRESS_STATUS = ['접수함', '처리 중', '답변 받음', '해결됨', '반려됨'];
  const PROGRESS_CHANNELS = ['국민신문고', '안전신문고', '시·군청 누리집', '읍·면·동 방문/전화', '국민제안(국민신문고)', '국회 국민동의청원', '국회의원 입법 건의', '국민연금공단', '국민참여입법센터', '기타'];
  function complaintText(post) {
    const link = post.no ? `${location.origin}/post/${post.no}` : '';
    return [
      post.title ? `제목: ${post.title}` : '',
      '',
      post.text.trim(),
      '',
      post.images?.length ? `※ 현장 사진 ${post.images.length}장을 함께 첨부합니다.${link ? ' (아래 주소에서도 볼 수 있습니다)' : ''}` : '',
      link ? `※ 같은 불편을 겪는 주민들의 의견: 스페이스 커뮤니티 시민의 소리 ${link}` : '',
    ].filter((line, index, all) => line !== '' || (all[index - 1] !== '' && index > 0)).join('\n').trim();
  }
  function officialPanel(post, item, anchor = item.querySelector('.label')) {
    const existing = item.querySelector('.official-panel');
    if (existing) { existing.remove(); return; }
    const panel = make('div', 'official-panel');
    panel.appendChild(make('p', 'official-lead', '시청·군청이 처리하고 답변하게 하려면 공식 창구에 접수해 주세요. 내용을 복사해 드리니 접수 화면에 붙여넣기만 하면 됩니다. 민원은 본인 이름으로 접수됩니다.'));
    const preview = make('textarea', 'official-text');
    preview.value = complaintText(post);
    preview.rows = 6;
    preview.setAttribute('aria-label', '접수할 민원 내용(고쳐 써도 됩니다)');
    const choices = make('div', 'official-choices');
    for (const channel of OFFICIAL) {
      const card = make('div', 'official-card');
      const open = make('button', 'btn btn-primary', `📋 복사하고 ${channel.name} 열기`);
      open.type = 'button';
      open.addEventListener('click', async () => {
        let copied = false;
        try { await navigator.clipboard.writeText(preview.value); copied = true; } catch {
          preview.focus(); preview.select();
          try { copied = document.execCommand('copy'); } catch { copied = false; }
        }
        window.open(channel.url, '_blank', 'noopener');
        status.textContent = copied ? `복사했습니다. 열린 ${channel.name} 화면의 내용 칸에 붙여넣기(Ctrl+V, 휴대폰은 길게 누르기) 하세요.${post.images?.length ? ' 사진은 직접 첨부해 주세요.' : ''}` : '자동 복사가 막혀 있어요. 위 내용을 길게 눌러(또는 Ctrl+A, Ctrl+C) 복사해 붙여넣어 주세요.';
      });
      card.append(make('strong', '', channel.name), make('span', 'official-when', channel.when), make('span', 'official-how', channel.how), open);
      choices.appendChild(card);
    }
    const status = make('p', 'official-status');
    status.setAttribute('role', 'status');
    const after = make('p', 'official-after', post.mine ? '접수한 뒤 이 글의 「처리 경과 적기」에 접수번호와 답변을 남기면 이웃들도 진행 상황을 볼 수 있어요.' : '같은 불편을 겪고 계시면 본인 이름으로 함께 접수해 주세요. 여러 사람이 접수할수록 힘이 실립니다.');
    panel.append(preview, choices, status, after);
    if (anchor === item) item.appendChild(panel); else anchor?.after(panel);
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  // ---------- 정책 제안 → 공식 경로(정부·국회·공단) ----------
  // 외부 기관은 다른 사이트가 대신 접수할 수 없으므로(본인 인증), 제출용 글을 만들어 복사해 주고 접수 화면을 연다.
  const PROPOSAL_ROUTES = [
    { name: '국민제안 (국민신문고)', url: 'https://www.epeople.go.kr', who: '정부 부처(예: 보건복지부)',
      when: '제도·법령을 바꿔 달라는 정책 제안. 소관 기관이 채택 여부를 심사해 알려 줍니다.',
      how: '로그인 → 국민제안 → 제안 신청 → 처리기관에 소관 부처(예: 보건복지부)를 고르고 붙여넣기' },
    { name: '국회 국민동의청원', url: 'https://petitions.assembly.go.kr', who: '국회 소관 상임위원회',
      when: '법 개정이 필요한 제안. 공개 후 30일 안에 5만 명이 동의하면 소관 상임위원회(예: 보건복지위원회)에 회부됩니다.',
      how: '본인 인증 → 청원 등록 → 붙여넣기 → 공개되면 주소를 스페이스톡·카카오톡으로 알려 동의를 모으기' },
    { name: '국회의원 입법 건의', url: 'https://www.assembly.go.kr', who: '소관 위원회 소속 국회의원',
      when: '의원이 법안으로 발의해 주기를 바랄 때. 지역구 의원이나 소관 상임위원회 위원에게 보냅니다.',
      how: '국회 누리집 → 국회의원 → 의원을 찾아 누리집·전자우편으로 붙여넣어 보내기' },
    { name: '국민연금공단', url: 'https://www.nps.or.kr', who: '국민연금공단',
      when: '국민연금·기초연금 운영과 관련한 개선 의견. 공단이 검토하고 보건복지부에 전달할 수 있습니다.',
      how: '누리집 → 고객의 소리(민원·제안) → 붙여넣기' },
    { name: '국민참여입법센터', url: 'https://opinion.lawmaking.go.kr', who: '법령을 고치는 부처',
      when: '관련 법령의 입법예고·규제 의견을 받는 기간에 의견을 낼 때.',
      how: '입법예고 목록에서 관련 법령(예: 기초연금법 시행령)을 찾아 의견 제출에 붙여넣기' },
  ];
  function proposalText(post) {
    const plain = window.spaceRichText ? window.spaceRichText.plain(post.text || '') : String(post.text || '');
    const link = postLink(post);
    return [
      `제목: ${post.title || plain.split('\n')[0].slice(0, 60)}`,
      '',
      plain.trim(),
      '',
      `※ 이 제안은 시민 소통 공간 스페이스 커뮤니티(withpluces.com) 정책 제안 게시판에서 시민 ${post.likes || 0}명의 추천을 받은 의견입니다.${link ? `\n※ 원문과 시민 의견: ${link}` : ''}`,
    ].join('\n');
  }
  function proposalPanel(post, item) {
    const existing = item.querySelector('.proposal-panel');
    if (existing) { existing.remove(); return; }
    const panel = make('div', 'official-panel proposal-panel');
    panel.appendChild(make('p', 'official-lead', '게시판에만 머무르면 제도가 바뀌지 않습니다. 아래 공식 경로로 제출해 주세요. 제출용 글을 복사해 드리니 각 기관 화면에 붙여넣기만 하면 됩니다. 제출은 본인 이름(본인 인증)으로 합니다.'));
    const preview = make('textarea', 'official-text');
    preview.value = proposalText(post);
    preview.rows = 8;
    preview.setAttribute('aria-label', '제출할 제안 내용(고쳐 써도 됩니다)');
    const status = make('p', 'official-status');
    status.setAttribute('role', 'status');
    const choices = make('div', 'official-choices');
    PROPOSAL_ROUTES.forEach((route, index) => {
      const card = make('div', 'official-card');
      const open = make('button', 'btn btn-primary', `📋 복사하고 ${route.name} 열기`);
      open.type = 'button';
      open.addEventListener('click', async () => {
        let copied = false;
        try { await navigator.clipboard.writeText(preview.value); copied = true; } catch {
          preview.focus(); preview.select();
          try { copied = document.execCommand('copy'); } catch { copied = false; }
        }
        window.open(route.url, '_blank', 'noopener');
        status.textContent = copied ? `복사했습니다. 열린 ${route.name} 화면의 내용 칸에 붙여넣기(Ctrl+V, 휴대폰은 길게 누르기) 하세요. 제출한 뒤 「진행 경과 적기」에 접수번호를 남겨 주세요.` : '자동 복사가 막혀 있어요. 위 내용을 길게 눌러(또는 Ctrl+A, Ctrl+C) 복사해 붙여넣어 주세요.';
      });
      card.append(make('strong', '', `${index + 1}. ${route.name}`), make('span', 'official-when', `받는 곳: ${route.who}`), make('span', 'official-when', route.when), make('span', 'official-how', route.how), open);
      choices.appendChild(card);
    });
    const after = make('p', 'official-after', '권장 순서: ① 국민제안으로 소관 부처에 공식 제출 → ② 국회 국민동의청원을 열고 스페이스톡·카카오톡으로 동의 모으기 → ③ 보건복지위원회 위원·지역구 의원에게 입법 건의. 진행 상황은 이 글의 「진행 경과」로 모두가 볼 수 있습니다.');
    panel.append(preview, choices, status, after);
    item.querySelector('.label')?.after(panel);
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function progressBadge(post) {
    const box = make('div', `progress-box s-${PROGRESS_STATUS.indexOf(post.progress.status)}`);
    const head = make('div', 'progress-head');
    head.append(make('span', 'progress-status', post.progress.status), make('span', '', `${post.progress.channel}${post.progress.receipt ? ` · 접수번호 ${post.progress.receipt}` : ''} · ${new Date(post.progress.updatedAt).toLocaleDateString('ko-KR')} ${post.progress.by || '글쓴이'} 기록`));
    box.appendChild(head);
    if (post.progress.answer) {
      const answer = make('p', 'progress-answer', post.progress.answer);
      answer.style.whiteSpace = 'pre-wrap';
      box.appendChild(answer);
    }
    return box;
  }
  function progressForm(post, item) {
    const existing = item.querySelector('.progress-form');
    if (existing) { existing.remove(); return; }
    const form = make('form', 'progress-form');
    const row = make('div', 'progress-row');
    const select = (label, options, value) => {
      const element = make('select');
      element.setAttribute('aria-label', label);
      options.forEach(entry => { const option = make('option', '', entry); option.value = entry; element.appendChild(option); });
      if (value) element.value = value;
      return element;
    };
    const channel = select('접수한 곳', PROGRESS_CHANNELS, post.progress?.channel);
    const status = select('진행 상황', PROGRESS_STATUS, post.progress?.status);
    const receipt = make('input');
    receipt.maxLength = 40;
    receipt.placeholder = '접수번호 (선택)';
    receipt.value = post.progress?.receipt || '';
    row.append(channel, status, receipt);
    const answer = make('textarea');
    answer.maxLength = 800;
    answer.rows = 3;
    answer.placeholder = post.board === 'policy' ? '기관·국회 답변이나 진행 요지 (선택). 담당자 이름·연락처 등 개인정보는 적지 말아 주세요.' : '시청·군청 답변 요지 (선택). 담당 공무원 이름·연락처 등 개인정보는 적지 말아 주세요.';
    answer.value = post.progress?.answer || '';
    const actions = make('div', 'progress-actions');
    const save = make('button', 'btn btn-primary', '처리 경과 저장');
    save.type = 'submit';
    actions.appendChild(save);
    if (post.progress) {
      const clear = make('button', 'btn btn-outline', '지우기');
      clear.type = 'button';
      clear.addEventListener('click', () => sendProgress({ clear: true }));
      actions.appendChild(clear);
    }
    const note = make('p', 'official-status');
    note.setAttribute('role', 'status');
    form.append(row, answer, actions, note);
    async function sendProgress(extra) {
      save.disabled = true;
      try {
        const result = await api('/api/board/progress', { postId: post.id, channel: channel.value, status: status.value, receipt: receipt.value, answer: answer.value, ...extra });
        state.posts[post.board] = state.posts[post.board].map(entry => entry.id === post.id ? result.post : entry);
        render(post.board);
        announce(post.board);
        setStatus(post.board, result.message);
      } catch (error) {
        note.textContent = error.message;
        save.disabled = false;
      }
    }
    form.addEventListener('submit', event => { event.preventDefault(); sendProgress({}); });
    item.querySelector('.label')?.after(form);
  }

  // ---------- 스페이스 커뮤니티가 대신 전달 ----------
  // 글쓴이가 동의하면 운영자가 (주)위드플러시아 법인 명의로 시·군청(국민신문고)에 접수한다. 한 건씩도, 여러 건 묶어서도 보낼 수 있다.
  const FORWARD_REGIONS = ['양산시', '김해시', '의령군', '창원시', '진주시', '부산광역시', '경상남도', '기타'];
  const ORG = '스페이스 커뮤니티(withpluces.com, 운영: (주)위드플러시아)';
  const postLink = post => (post.no ? `${location.origin}/post/${post.no}` : '');
  const ymdKo = () => { const date = new Date(); return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`; };
  function orgSingle(post) {
    return [
      `제목: [스페이스 커뮤니티 주민 의견 전달] ${post.title || post.text.split('\n')[0].slice(0, 40)}`,
      '',
      `안녕하십니까. 시민 소통 사이트 ${ORG}는 ${post.forward?.region || ''} 주민 회원이 올린 의견을 글쓴이의 동의를 받아 전달합니다.`,
      '',
      `■ 분류: ${post.category || '시민의 소리'}`,
      '■ 내용:',
      post.text.trim(),
      '',
      `■ 같은 불편에 공감한 회원: ${post.likes || 0}명`,
      post.images?.length ? `■ 현장 사진 ${post.images.length}장 첨부` : '',
      postLink(post) ? `■ 원문: ${postLink(post)}` : '',
      '',
      '처리 계획과 결과를 회신해 주시면 회원들께 알리겠습니다. 감사합니다.',
      `${ymdKo()} ${ORG}`,
    ].filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n').trim();
  }
  function orgBundle(posts) {
    const region = [...new Set(posts.map(post => post.forward?.region).filter(Boolean))].join('·');
    const lines = [
      `제목: [스페이스 커뮤니티] ${region} 주민 의견 모음 ${posts.length}건 (${ymdKo()})`,
      '',
      `안녕하십니까. 시민 소통 사이트 ${ORG}는 ${region} 주민 회원들이 올린 의견 ${posts.length}건을 글쓴이들의 동의를 받아 함께 전달합니다.`,
      '',
    ];
    posts.forEach((post, index) => {
      const body = post.text.trim().replace(/\s+/g, ' ');
      lines.push(`${index + 1}. [${post.category || '시민의 소리'}] ${post.title || body.slice(0, 40)}`);
      lines.push(`   ${body.length > 300 ? `${body.slice(0, 300)}…` : body}`);
      lines.push(`   공감 ${post.likes || 0}명${post.images?.length ? ` · 사진 ${post.images.length}장` : ''}${postLink(post) ? ` · 원문 ${postLink(post)}` : ''}`);
      lines.push('');
    });
    lines.push('건별 처리 계획과 결과를 회신해 주시면 회원들께 알리겠습니다. 감사합니다.', `${ymdKo()} ${ORG}`);
    return lines.join('\n').trim();
  }
  async function copyText(text, fallback) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      if (fallback) { fallback.focus(); fallback.select(); try { return document.execCommand('copy'); } catch { return false; } }
      return false;
    }
  }
  function forwardBadge(post) {
    const done = post.forward.status === '전달함';
    return make('div', `forward-badge${done ? ' done' : ''}`, done
      ? `🏛️ 스페이스 커뮤니티가 ${post.forward.region}에 전달했습니다${post.forward.forwardedAt ? ` (${new Date(post.forward.forwardedAt).toLocaleDateString('ko-KR')})` : ''}`
      : `🏛️ 스페이스 커뮤니티 전달 대기 중 · ${post.forward.region} · 운영자가 확인 후 접수합니다`);
  }
  function forwardForm(post, item) {
    const existing = item.querySelector('.forward-form');
    if (existing) { existing.remove(); return; }
    const form = make('form', 'forward-form');
    if (post.forward) {
      form.appendChild(make('p', 'official-lead', `${post.forward.region}에 전달을 요청해 두셨습니다. 운영자가 접수하기 전까지는 취소할 수 있습니다.`));
      const cancel = make('button', 'btn btn-outline', '전달 요청 취소');
      cancel.type = 'submit';
      form.appendChild(cancel);
    } else {
      form.appendChild(make('p', 'official-lead', '운영자가 「스페이스 커뮤니티」 이름으로 시·군청(국민신문고)에 이 글을 접수합니다. 회원님 이름·연락처는 전달하지 않고, 글 내용·사진·공감 수만 전달합니다. 답변이 오면 처리 경과에 적고 메일로 알려 드립니다.'));
      const region = make('select');
      region.setAttribute('aria-label', '전달할 시·군');
      FORWARD_REGIONS.forEach(name => { const option = make('option', '', name); option.value = name; region.appendChild(option); });
      const consent = make('label', 'forward-consent');
      const box = make('input');
      box.type = 'checkbox';
      consent.append(box, document.createTextNode(' 이 글의 내용과 사진을 운영자가 시·군청에 전달하는 데 동의합니다.'));
      const send = make('button', 'btn btn-primary', '🏛️ 전달 요청하기');
      send.type = 'submit';
      form.append(region, consent, send);
      form.dataset.mode = 'ask';
      form.region = region;
      form.consent = box;
    }
    const note = make('p', 'official-status');
    note.setAttribute('role', 'status');
    form.appendChild(note);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const body = form.dataset.mode === 'ask' ? { postId: post.id, region: form.region.value, consent: form.consent.checked } : { postId: post.id, cancel: true };
      if (form.dataset.mode === 'ask' && !form.consent.checked) { note.textContent = '동의에 체크해 주세요.'; return; }
      try {
        const result = await api('/api/board/forward', body);
        state.posts.voice = state.posts.voice.map(entry => entry.id === post.id ? result.post : entry);
        render('voice');
        setStatus('voice', result.message);
      } catch (error) { note.textContent = error.message; }
    });
    item.querySelector('.label')?.after(form);
  }

  // 운영자: 시청 전달 대기함
  function forwardAdmin() {
    const section = $('voice-section');
    let box = $('forward-admin');
    if (!state.user?.admin) { box?.remove(); return; }
    if (box) return;
    box = make('details', 'forward-admin');
    box.id = 'forward-admin';
    box.appendChild(make('summary', '', '🏛️ 운영자: 시청 전달 대기함'));
    const body = make('div', 'forward-admin-body');
    box.appendChild(body);
    section.querySelector('.civic-flow')?.before(box);
    const queue = { posts: [], region: '', selected: new Set() };
    const draw = () => {
      const posts = queue.posts.filter(post => !queue.region || post.forward.region === queue.region);
      const filter = make('select');
      filter.setAttribute('aria-label', '지역');
      [['', '모든 지역'], ...FORWARD_REGIONS.map(name => [name, name])].forEach(([value, label]) => {
        const count = queue.posts.filter(post => (!value || post.forward.region === value) && post.forward.status !== '전달함').length;
        const option = make('option', '', `${label}${count ? ` (대기 ${count})` : ''}`);
        option.value = value;
        filter.appendChild(option);
      });
      filter.value = queue.region;
      filter.addEventListener('change', () => { queue.region = filter.value; queue.selected.clear(); draw(); });
      const top = make('div', 'forward-top');
      const allWaiting = make('button', 'like-btn', '대기 중인 글 모두 고르기');
      allWaiting.type = 'button';
      allWaiting.addEventListener('click', () => { posts.filter(post => post.forward.status !== '전달함').forEach(post => queue.selected.add(post.id)); draw(); });
      top.append(filter, allWaiting);
      const list = make('ul', 'forward-list');
      if (!posts.length) list.appendChild(make('li', 'label', '전달 요청이 없습니다.'));
      posts.forEach(post => {
        const li = make('li', post.forward.status === '전달함' ? 'done' : '');
        const pick = make('input');
        pick.type = 'checkbox';
        pick.checked = queue.selected.has(post.id);
        pick.setAttribute('aria-label', '고르기');
        pick.addEventListener('change', () => { if (pick.checked) queue.selected.add(post.id); else queue.selected.delete(post.id); draw(); });
        const info = make('div', 'forward-info');
        info.append(make('strong', '', post.title || post.text.split('\n')[0].slice(0, 50)),
          make('span', '', `${post.forward.region} · ${post.category} · 공감 ${post.likes}명${post.images?.length ? ` · 사진 ${post.images.length}` : ''} · ${post.forward.status === '전달함' ? `전달함${post.progress ? ` (${post.progress.status}${post.progress.receipt ? ` ${post.progress.receipt}` : ''})` : ''}` : '대기'}`));
        const single = make('button', 'like-btn', '한 건 문안 복사');
        single.type = 'button';
        single.addEventListener('click', async () => {
          output.value = orgSingle(post);
          queue.selected = new Set([post.id]);
          draw();
          status.textContent = (await copyText(output.value, output)) ? '한 건 문안을 복사했습니다. 국민신문고에 붙여넣고 사진을 첨부해 접수하세요.' : '아래 문안을 복사해 주세요.';
        });
        const open = make('a', 'like-btn', '원문');
        open.href = postLink(post) || '#';
        open.target = '_blank';
        li.append(pick, info, single, open);
        list.appendChild(li);
      });
      const chosen = queue.posts.filter(post => queue.selected.has(post.id));
      const actions = make('div', 'forward-actions');
      const bundle = make('button', 'btn btn-primary', `📋 고른 ${chosen.length}건 묶음 문안 복사`);
      bundle.type = 'button';
      bundle.disabled = chosen.length < 2;
      bundle.addEventListener('click', async () => {
        output.value = orgBundle(chosen);
        status.textContent = (await copyText(output.value, output)) ? `${chosen.length}건 묶음 문안을 복사했습니다. 사진은 건별로 첨부해 주세요.` : '아래 문안을 복사해 주세요.';
      });
      const epeople = make('a', 'btn btn-outline', '국민신문고 열기 ↗');
      epeople.href = 'https://www.epeople.go.kr';
      epeople.target = '_blank';
      epeople.rel = 'noopener';
      actions.append(bundle, epeople);
      const output = make('textarea', 'official-text');
      output.rows = 8;
      output.placeholder = '「한 건 문안 복사」나 「묶음 문안 복사」를 누르면 접수할 문안이 여기에 나옵니다.';
      const record = make('form', 'forward-record');
      const channel = make('select');
      PROGRESS_CHANNELS.forEach(name => { const option = make('option', '', name); option.value = name; channel.appendChild(option); });
      const progress = make('select');
      PROGRESS_STATUS.forEach(name => { const option = make('option', '', name); option.value = name; progress.appendChild(option); });
      const receipt = make('input');
      receipt.maxLength = 40;
      receipt.placeholder = '접수번호';
      const answer = make('textarea');
      answer.rows = 2;
      answer.maxLength = 800;
      answer.placeholder = '시청 답변 요지 (답변을 받은 뒤 적기, 선택)';
      const save = make('button', 'btn btn-primary', `고른 ${chosen.length}건에 전달 기록 저장 (글쓴이에게 메일 알림)`);
      save.type = 'submit';
      save.disabled = !chosen.length;
      const row = make('div', 'progress-row');
      row.append(channel, progress, receipt);
      record.append(row, answer, save);
      record.addEventListener('submit', async event => {
        event.preventDefault();
        save.disabled = true;
        try {
          const result = await api('/api/board/forward-mark', { postIds: chosen.map(post => post.id), channel: channel.value, status: progress.value, receipt: receipt.value, answer: answer.value });
          status.textContent = result.message;
          queue.selected.clear();
          await loadQueue();
          load('voice');
        } catch (error) { status.textContent = error.message; save.disabled = false; }
      });
      const status = make('p', 'official-status');
      status.setAttribute('role', 'status');
      const keep = body.querySelector('.official-text')?.value || '';
      output.value = keep;
      body.replaceChildren(make('p', 'official-lead', '글쓴이가 동의한 시민의 소리입니다. 한 건씩 또는 같은 지역 글을 여러 건 골라 묶어서 국민신문고(법인 계정)로 접수한 뒤, 접수번호를 기록하세요.'), top, list, actions, output, record, status);
    };
    async function loadQueue() {
      try { queue.posts = (await api('/api/board/forward-queue')).posts; } catch (error) { queue.posts = []; setStatus('voice', error.message, true); }
      draw();
    }
    box.addEventListener('toggle', () => { if (box.open) loadQueue(); });
  }

  // ---------- 판결 평론: 전원합의체 판결 글 아래에서 바로 평론을 쓰고, 쓴 평론을 모아 보여 준다 ----------
  const jumpTo = id => {
    const target = $(`post-${id}`);
    if (!target) return false;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    flash(target);
    return true;
  };
  function aboutLine(post) {
    const line = make('p', 'about-line');
    line.append('📜 평론 대상 판결: ');
    const link = make('a', '', post.about.title || '판결 글');
    link.href = `#post-${post.about.id}`;
    link.addEventListener('click', event => { if (jumpTo(post.about.id)) event.preventDefault(); });
    line.appendChild(link);
    return line;
  }
  function judgmentReviews(post) {
    const box = make('div', 'judgment-reviews');
    const reviews = (state.posts.research || []).filter(entry => entry.category === '판결 평론' && entry.about?.id === post.id && !entry.hidden)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const head = make('div', 'judgment-reviews-head');
    head.appendChild(make('strong', '', reviews.length ? `💬 이 판결에 대한 평론 ${reviews.length}편` : '💬 아직 이 판결에 대한 평론이 없습니다'));
    const write = make('button', 'like-btn review-btn', '✍️ 이 판결 평론 쓰기');
    write.type = 'button';
    write.addEventListener('click', () => startReview(post));
    head.appendChild(write);
    box.appendChild(head);
    if (reviews.length) {
      const list = make('ul');
      reviews.forEach(review => {
        const entry = make('li');
        const link = make('a', '', review.title || '평론');
        link.href = `#post-${review.id}`;
        link.addEventListener('click', event => { if (jumpTo(review.id)) event.preventDefault(); });
        entry.append(link, make('span', 'label', ` · ${review.authorName} · ${new Date(review.createdAt).toLocaleDateString('ko-KR')}`));
        list.appendChild(entry);
      });
      box.appendChild(list);
    }
    return box;
  }
  function startReview(post) {
    if (!canWrite()) { setStatus('research', writeHint(), true); if (!state.user) window.spaceOpenAuth?.('login'); return; }
    const type = $('researchType');
    type.value = '판결 평론';
    type.dispatchEvent(new Event('change'));
    setAbout(post);
    const composer = type.closest('.post-composer');
    composer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    flash(composer);
    setTimeout(() => $('researchTitle').focus({ preventScroll: true }), 400);
  }

  // 정보안내 초안: 첫 줄 = 제목, 다음 = 본문 앞부분 요약(문장 단위로 약 300자), 끝 = 전체 글 주소.
  function infoDraft(post) {
    // 표·꾸밈 기호는 빼고 문장만 요약한다(표는 「전체 글 읽기」에서 보이도록).
    const body = (window.spaceRichText ? window.spaceRichText.plain(post.text || '', { tables: false }) : String(post.text || '')).replace(/\r/g, '').trim();
    const title = (post.title || body.split('\n')[0] || '스페이스 커뮤니티 정보안내').trim().slice(0, 80);
    const rest = post.title ? body : body.split('\n').slice(1).join('\n');
    const flat = rest.replace(/\n{2,}/g, '\n').trim();
    let summary = flat.slice(0, 300);
    if (flat.length > 300) {
      const cut = Math.max(summary.lastIndexOf('. '), summary.lastIndexOf('다.'), summary.lastIndexOf('\n'));
      summary = `${(cut > 120 ? summary.slice(0, summary[cut] === '\n' ? cut : cut + 2) : summary).trim()} …`;
    }
    const lines = [title];
    if (summary) lines.push(summary);
    lines.push('', `▶ 전체 글 보기: ${location.origin}/post/${post.no}`);
    if (post.category === '시장분석') lines.push('※ 투자 권유가 아닌 정보 제공입니다. 투자 판단과 책임은 본인에게 있습니다.');
    return lines.join('\n');
  }

  function renderPost(post) {
    const item = make('article', post.category === '시' ? 'post-item poem' : 'post-item');
    item.id = `post-${post.id}`;
    if (post.hidden) item.style.opacity = '0.6';
    const head = make('div');
    if (post.category && post.board !== 'policy') head.appendChild(make('strong', '', `[${post.category}] `));
    if (post.title) head.appendChild(make('strong', 'post-title', post.title));
    if (head.childNodes.length) item.appendChild(head);
    if (post.board === 'research' && post.category === '판결 평론' && post.about) item.appendChild(aboutLine(post));
    // 본문: 표·소제목·밑줄·굵게·링크를 꾸며 보여 준다(시는 줄바꿈 그대로).
    let body;
    if (post.category !== '시' && window.spaceRichText) {
      body = make('div', 'rich-body');
      body.innerHTML = window.spaceRichText.toHtml(post.text);
    } else {
      body = make('p', '', post.text);
      body.style.whiteSpace = 'pre-wrap';
    }
    item.appendChild(body);
    // 정책 제안 부처 칸은 좁아서 긴 글은 접어 둔다. 그래야 글 아래 '수정'·'추천' 단추가 바로 보인다.
    if (post.board === 'policy' && post.text.length > 600) {
      const closedLabel = `▼ 전체 펼치기 (${post.text.length.toLocaleString('ko-KR')}자)`;
      body.classList.add('rt-folded');
      const toggle = make('button', 'like-btn fold-toggle', closedLabel);
      toggle.type = 'button';
      toggle.addEventListener('click', () => {
        const folded = body.classList.toggle('rt-folded');
        toggle.textContent = folded ? closedLabel : '▲ 접기';
        if (folded) item.scrollIntoView({ block: 'nearest' });
      });
      item.appendChild(toggle);
    }
    if (post.board === 'research' && post.category === '대법원 전원합의체 판결' && !post.hidden) item.appendChild(judgmentReviews(post));
    if (post.images?.length) item.appendChild(postPhotos(post));
    if (post.board === 'voice' && post.forward) item.appendChild(forwardBadge(post));
    if ((post.board === 'voice' || post.board === 'policy') && post.progress) item.appendChild(progressBadge(post));
    const meta = make('div', 'label');
    meta.style.display = 'flex';
    meta.style.flexWrap = 'wrap';
    meta.style.gap = '8px';
    meta.style.alignItems = 'center';
    meta.appendChild(make('span', '', `${post.authorName} · ${new Date(post.createdAt).toLocaleString('ko-KR')}${post.editedAt ? ` · 수정됨 ${new Date(post.editedAt).toLocaleString('ko-KR')}` : ''}`));
    // 공개 게시판 글은 고유 주소(withpluces.com/post/번호)로 바로 열고 공유할 수 있다.
    if (post.no && !post.hidden) {
      const permalink = make('a', 'like-btn', `🔗 글 주소 #${post.no}`);
      permalink.href = `/post/${post.no}`;
      permalink.title = '이 글만 따로 보기·공유하기';
      permalink.style.textDecoration = 'none';
      meta.appendChild(permalink);
    }
    // 운영자만: 이 글의 제목·요약·글 주소를 광장 채팅 '📊 정보안내'로 옮겨 담는다(스페이스톡 정보안내 채널로 전달).
    if (state.user?.admin && post.no && !post.hidden) {
      const notify = make('button', 'like-btn info-notify-btn', '📊 정보안내로 알리기');
      notify.type = 'button';
      notify.title = '제목·요약·글 주소를 광장 채팅에 채워 넣습니다. 확인한 뒤 「전송」을 누르면 스페이스톡 정보안내로도 갑니다.';
      notify.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('space-announce-draft', { detail: { tag: '[정보안내]', text: infoDraft(post) } }));
      });
      meta.appendChild(notify);
    }
    if (post.board === 'voice' && !post.hidden) {
      const official = make('button', 'like-btn official-btn', '📮 공식 민원으로 보내기');
      official.type = 'button';
      official.title = '국민신문고·안전신문고에 이 내용을 접수하기';
      official.addEventListener('click', () => officialPanel(post, item));
      meta.appendChild(official);
      if (post.mine && state.user && post.forward?.status !== '전달함') {
        const forward = make('button', 'like-btn forward-btn', post.forward ? '🏛️ 전달 요청됨' : '🏛️ 커뮤니티가 대신 전달');
        forward.type = 'button';
        forward.title = '운영자가 스페이스 커뮤니티 이름으로 시·군청에 접수합니다';
        forward.addEventListener('click', () => forwardForm(post, item));
        meta.appendChild(forward);
      }
      if ((post.mine || state.user?.admin) && state.user) {
        const progress = make('button', 'like-btn', post.progress ? '처리 경과 고치기' : '처리 경과 적기');
        progress.type = 'button';
        progress.addEventListener('click', () => progressForm(post, item));
        meta.appendChild(progress);
      }
    }
    // 정책 제안: 정부(국민제안)·국회(국민동의청원·의원 입법 건의)·국민연금공단 등 공식 경로로 보내고, 진행 경과를 남긴다.
    if (post.board === 'policy' && !post.hidden) {
      const route = make('button', 'like-btn official-btn', '🏛️ 정부·국회에 제안하기');
      route.type = 'button';
      route.title = '국민제안·국민동의청원·국회의원 입법 건의 등 공식 경로로 보내기';
      route.addEventListener('click', () => proposalPanel(post, item));
      meta.appendChild(route);
      if ((post.mine || state.user?.admin) && state.user) {
        const progress = make('button', 'like-btn', post.progress ? '진행 경과 고치기' : '진행 경과 적기');
        progress.type = 'button';
        progress.addEventListener('click', () => progressForm(post, item));
        meta.appendChild(progress);
      }
    }
    if (post.mine && !post.hidden && canWrite()) {
      const edit = make('button', 'like-btn', '수정');
      edit.type = 'button';
      edit.addEventListener('click', () => openEditor(post, item));
      meta.appendChild(edit);
    }
    if (post.board === 'policy' || post.board === 'voice') {
      const like = make('button', 'like-btn', post.board === 'voice' ? `🙋 저도 겪어요 ${post.likes}` : `추천 ${post.likes}`);
      like.type = 'button';
      like.setAttribute('aria-pressed', String(post.liked));
      like.disabled = !state.user || post.hidden;
      like.title = state.user ? (post.board === 'voice' ? '같은 불편을 겪고 있다면 눌러 주세요(공감 수는 시청 전달 때 함께 알립니다)' : '추천하기/취소') : '로그인 후 누를 수 있습니다.';
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
        // 글쓴이는 예전 내용을 수정 칸에 다시 불러와 고칠 수 있다(잘못 붙여넣은 수정을 되돌릴 때).
        if (post.mine && canWrite() && !post.hidden) {
          const row = make('div', 'post-history-restore');
          const restore = make('button', 'like-btn', '↩ 이 내용으로 되돌려 고치기');
          restore.type = 'button';
          restore.addEventListener('click', () => openEditor({ ...post, title: entry.title ?? post.title, text: entry.text }, item));
          row.append(restore, make('span', 'label', ` ${entry.text.length.toLocaleString('ko-KR')}자 · 끝부분: …${entry.text.slice(-40)}`));
          history.appendChild(row);
        }
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
    if (post.board === 'voice' || post.board === 'research' || post.board === 'community') {
      category = make('select');
      category.setAttribute('aria-label', '분류');
      const source = $(post.board === 'voice' ? 'voiceCategory' : post.board === 'research' ? 'researchType' : 'communityType');
      [...source.options].filter(item => item.value !== 'all').forEach(item => {
        const option = make('option', '', item.textContent);
        option.value = item.value;
        category.appendChild(option);
      });
      category.value = post.category || '';
      form.appendChild(category);
    }
    // 모든 게시판에서 제목을 고칠 수 있다(칼럼·학술만 필수).
    const title = make('input', 'post-title-input');
    title.type = 'text';
    title.maxLength = 120;
    title.value = post.title || '';
    title.placeholder = post.board === 'research' ? '제목 (필수)' : '제목 (선택)';
    title.setAttribute('aria-label', '글 제목');
    form.appendChild(title);
    const text = make('textarea');
    text.value = post.text;
    text.maxLength = post.board === 'research' ? 50000 : post.board === 'policy' ? 20000 : 5000;
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
    // 사진 붙여넣기 칸은 글 입력칸이 들어 있는 폼을 찾아 연결하므로, 입력칸을 먼저 폼에 넣는다.
    form.append(text);
    const editPhotos = photoPicker(post.board, text, post.images || []);
    form.append(editPhotos.element, actions, status);
    lengthCounter(text);
    const original = [...item.childNodes];
    item.replaceChildren(form);
    text.focus();
    cancel.addEventListener('click', () => item.replaceChildren(...original));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!text.value.trim() || (post.board === 'research' && !title.value.trim())) {
        status.textContent = post.board === 'research' ? '제목과 내용을 입력해 주세요.' : '내용을 입력해 주세요.';
        status.dataset.error = 'true';
        return;
      }
      save.disabled = true;
      try {
        if (editPhotos.busy()) { status.textContent = '사진을 올리는 중입니다. 잠시 뒤 다시 눌러 주세요.'; status.dataset.error = 'true'; save.disabled = false; return; }
        const result = await api('/api/board/edit', { postId: post.id, text: text.value, title: title.value, images: editPhotos.ids(), ...(category ? { category: category.value } : {}) });
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
    if (board === 'research' || board === 'community') {
      const filter = $(board === 'research' ? 'researchFilter' : 'communityFilter').value;
      if (filter !== 'all') items = items.filter(post => (post.category || '') === filter);
    }
    const target = $(board === 'community' ? 'communityPosts' : board === 'voice' ? 'voicePosts' : 'researchPosts');
    target.replaceChildren(...items.map(renderPost));
    if (!items.length) target.appendChild(make('p', 'label', '아직 등록된 글이 없습니다.'));
  }

  async function load(board) {
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
    // 비회원은 글쓰기 칸만 감추고, 글 목록·유형별 보기는 그대로 보인다.
    researchComposer.classList.toggle('read-only', !member);
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
      refreshCounters();
      loadCounts();
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
    paste.title = '복사한 글이나 사진을 이 칸에 붙여넣기';
    paste.addEventListener('click', async () => {
      try {
        // 복사한 것이 사진(PNG·JPG)이면 사진으로 붙인다.
        if (navigator.clipboard.read) {
          try {
            const files = [];
            for (const entry of await navigator.clipboard.read()) {
              const type = entry.types.find(kind => kind.startsWith('image/'));
              if (type) files.push(new File([await entry.getType(type)], `clipboard.${type.split('/')[1]}`, { type }));
            }
            if (files.length) { await pickers[board].addFiles(files); return; }
          } catch { /* fall back to text */ }
        }
        const text = await navigator.clipboard.readText();
        if (!text) { setStatus(board, '복사한 글이나 사진이 없습니다. 먼저 붙여넣을 내용을 복사해 주세요.', true); return; }
        const start = input.selectionStart ?? input.value.length;
        input.value = input.value.slice(0, start) + text + input.value.slice(input.selectionEnd ?? start);
        input.dispatchEvent(new Event('input'));
        input.focus();
        setStatus(board, '붙여넣었습니다. 내용을 확인하고 등록해 주세요.');
      } catch {
        input.focus();
        setStatus(board, '이 브라우저는 버튼 붙여넣기를 막고 있어요. 글쓰기 칸을 길게 누르거나(휴대폰) Ctrl+V(PC)로 붙여넣어 주세요.', true);
      }
    });
    input.after(paste);
  }

  // 소통·나눔, 시민의 소리, 칼럼·학술 글쓰기 칸에 사진 첨부 도구를 붙인다.
  const pickers = {};
  for (const [inputId, board] of [['communityInput', 'community'], ['voiceInput', 'voice'], ['researchInput', 'research']]) {
    const input = $(inputId);
    pickers[board] = photoPicker(board, input);
    (input.nextElementSibling?.classList.contains('paste-btn') ? input.nextElementSibling : input).after(pickers[board].element);
  }
  const withPhotos = (board, payload) => {
    if (pickers[board]?.busy()) { setStatus(board, '사진을 올리는 중입니다. 잠시 뒤 다시 눌러 주세요.', true); return null; }
    const images = pickers[board]?.ids() || [];
    return images.length ? { ...payload, images } : payload;
  };

  // 판결 평론을 쓸 때 어떤 판결에 대한 평론인지 글쓰기 칸 위에 보여 준다.
  const aboutBar = make('div', 'about-target');
  aboutBar.hidden = true;
  $('researchType').closest('.post-controls').after(aboutBar);
  function setAbout(post) {
    state.about = post || null;
    aboutBar.replaceChildren();
    aboutBar.hidden = !post;
    if (!post) return;
    aboutBar.appendChild(make('span', '', `📜 평론할 판결: ${post.title || '판결 글'}`));
    const cancel = make('button', 'like-btn', '선택 취소');
    cancel.type = 'button';
    cancel.addEventListener('click', () => setAbout(null));
    aboutBar.appendChild(cancel);
  }
  $('researchType').addEventListener('change', () => { if ($('researchType').value !== '판결 평론') setAbout(null); });

  // ---------- 글자 수: 1,000자(공백 포함) 이상이면 읽을거리가 충분한 글로 본다 ----------
  const GOOD_LENGTH = 1000;
  const counters = [];
  function lengthCounter(textarea) {
    if (!textarea || textarea.dataset.counter) return;
    textarea.dataset.counter = '1';
    const counter = make('div', 'char-count');
    const update = () => {
      const count = textarea.value.trim().length;
      const good = count >= GOOD_LENGTH;
      counter.dataset.good = String(good);
      counter.textContent = good ? `${count.toLocaleString('ko-KR')}자 ✓ 충분한 분량이에요`
        : `${count.toLocaleString('ko-KR')}자 · 1,000자 이상(A4 반 쪽 정도) 쓰면 더 좋아요`;
    };
    textarea.addEventListener('input', update);
    textarea.after(counter);
    update();
    counters.push(update);
  }
  function refreshCounters() { counters.forEach(update => update()); }
  ['communityInput', 'voiceInput', 'researchInput', 'is-form-text'].forEach(id => lengthCounter($(id)));
  categoryContainer.querySelectorAll('.policy-category textarea').forEach(lengthCounter);
  window.spaceLengthCounter = lengthCounter;

  // ---------- 아직 글이 없는 항목에 * 표시 ----------
  const EMPTY_TITLE = '아직 글이 없는 항목이에요. 첫 글을 써 주세요!';
  function markEmpty(element, empty) {
    if (!element) return;
    if (element.tagName === 'OPTION') {
      element.dataset.label ??= element.textContent;
      element.textContent = element.dataset.label + (empty ? ' *' : '');
      return;
    }
    let star = element.querySelector(':scope > .empty-mark');
    if (empty && !star) {
      star = make('span', 'empty-mark', '*');
      star.title = EMPTY_TITLE;
      star.setAttribute('aria-label', '아직 글 없음');
      element.appendChild(star);
    } else if (!empty && star) star.remove();
  }
  const legends = {};
  function legend(key, anchor, show) {
    if (!anchor) return;
    if (!legends[key]) {
      legends[key] = make('p', 'empty-legend', '* 표시는 아직 글이 없는 항목입니다.');
      anchor.after(legends[key]);
    }
    legends[key].hidden = !show;
  }
  function applyCounts(counts) {
    const total = board => counts[board]?._total || 0;
    const of = (board, key) => counts[board]?.[key] || 0;
    document.querySelectorAll('.feed-tabs [data-feed]').forEach(tab => {
      if (tab.dataset.feed !== 'all' && counts[tab.dataset.feed]) markEmpty(tab, !total(tab.dataset.feed));
    });
    let any = false;
    [...$('researchFilter').options].forEach(option => {
      if (option.value === 'all') return;
      const empty = !of('research', option.value);
      any ||= empty;
      markEmpty(option, empty);
    });
    legend('research', $('researchFilter').closest('.post-controls'), any);
    any = false;
    [...$('communityFilter').options].forEach(option => {
      if (option.value === 'all') return;
      const empty = !of('community', option.value);
      any ||= empty;
      markEmpty(option, empty);
    });
    legend('community', $('communityFilter').closest('.post-controls'), any);
    any = false;
    $('voice-section').querySelectorAll('.grid .card h3').forEach(heading => {
      const empty = !of('voice', heading.firstChild?.textContent?.trim() || '');
      any ||= empty;
      markEmpty(heading, empty);
    });
    legend('voice', $('voice-section').querySelector('.grid'), any);
    any = false;
    categoryContainer.querySelectorAll('.policy-category').forEach(card => {
      const empty = !of('policy', card.dataset.dept);
      any ||= empty;
      markEmpty(card.querySelector('h4'), empty);
    });
    const policyLegend = legends.policyTop || (legends.policyTop = make('p', 'empty-legend', '* 표시는 아직 제안이 없는 부처입니다.'));
    if (!policyLegend.isConnected) categoryContainer.before(policyLegend);
    policyLegend.hidden = !any;
  }
  async function loadCounts() {
    try { applyCounts((await api('/api/board/counts')).counts || {}); } catch { /* 표시만 못 할 뿐 */ }
  }
  loadCounts();

  // 시민의 소리 위 '① 올리기 ② 공식 민원 ③ 처리 경과' 안내를 누르면 그 단계로 바로 데려간다.
  const flash = element => { element.classList.add('civic-flash'); setTimeout(() => element.classList.remove('civic-flash'), 1600); };
  document.querySelectorAll('[data-civic-step]').forEach(button => button.addEventListener('click', () => {
    const step = button.dataset.civicStep;
    const holder = $('civic-step-panel');
    holder.replaceChildren();
    const mineLatest = (state.posts.voice || []).find(post => post.mine && !post.hidden);
    if (step === '1') {
      const title = $('voiceTitle');
      title.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => (title.value ? $('voiceInput') : title).focus(), 350);
      flash($('voiceInput').closest('.post-composer'));
      setStatus('voice', canWrite() ? '분류를 고르고 제목·내용을 적은 뒤 사진을 붙이고(📷 사진 첨부 또는 Ctrl+V) 「시민의 소리 등록」을 눌러 주세요.' : writeHint(), !canWrite());
      return;
    }
    if (step === '2') {
      // 글쓰기 칸에 적고 있는 내용이 있으면 그 내용으로, 없으면 내가 가장 최근에 올린 글로 민원 내용을 만든다.
      const text = $('voiceInput').value.trim();
      if (text) {
        officialPanel({ title: $('voiceTitle').value.trim(), text, images: pickers.voice.ids(), mine: true }, holder, holder);
        holder.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      if (mineLatest) {
        const item = $(`post-${mineLatest.id}`);
        if (item) { item.scrollIntoView({ behavior: 'smooth', block: 'center' }); flash(item); if (!item.querySelector('.official-panel')) officialPanel(mineLatest, item); return; }
      }
      holder.appendChild(make('p', 'official-lead', '먼저 ① 글쓰기 칸에 내용을 적거나 시민의 소리에 글을 올려 주세요. 그다음 이 단추를 누르면 국민신문고·안전신문고에 붙여넣을 내용을 만들어 드립니다. 다른 분의 글이라면 그 글 아래 「📮 공식 민원으로 보내기」를 누르세요.'));
      return;
    }
    if (!state.user) { window.spaceOpenAuth?.('login'); setStatus('voice', '처리 경과는 글쓴이가 로그인한 뒤 적을 수 있습니다.', true); return; }
    if (!mineLatest) {
      holder.appendChild(make('p', 'official-lead', '내가 올린 시민의 소리 글이 아직 없습니다. 글을 올리고 공식 민원으로 접수한 뒤, 여기서 접수번호와 답변을 적을 수 있어요.'));
      return;
    }
    const item = $(`post-${mineLatest.id}`);
    if (!item) return;
    item.scrollIntoView({ behavior: 'smooth', block: 'center' });
    flash(item);
    if (!item.querySelector('.progress-form')) progressForm(mineLatest, item);
  }));

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
    const title = $('communityTitle');
    if (!input.value.trim()) { setStatus('community', '내용을 입력해 주세요.', true); return; }
    const payload = withPhotos('community', { category: $('communityType').value, title: title.value, text: input.value });
    if (payload) submit('community', payload, () => { input.value = ''; title.value = ''; pickers.community.clear(); });
  });
  $('voiceSubmit').addEventListener('click', () => {
    const input = $('voiceInput');
    const title = $('voiceTitle');
    if (!input.value.trim()) { setStatus('voice', '내용을 입력해 주세요.', true); return; }
    const payload = withPhotos('voice', { category: $('voiceCategory').value, title: title.value, text: input.value });
    if (payload) submit('voice', payload, () => { input.value = ''; title.value = ''; pickers.voice.clear(); });
  });
  $('researchSubmit').addEventListener('click', () => {
    const title = $('researchTitle');
    const input = $('researchInput');
    if (!title.value.trim() || !input.value.trim()) { setStatus('research', '제목과 내용을 입력해 주세요.', true); return; }
    const category = $('researchType').value;
    const about = category === '판결 평론' && state.about ? { about: state.about.id } : {};
    const payload = withPhotos('research', { category, title: title.value, text: input.value, ...about });
    if (payload) submit('research', payload, () => { title.value = ''; input.value = ''; pickers.research.clear(); setAbout(null); });
  });
  categoryContainer.addEventListener('click', event => {
    const button = event.target.closest('button.submitPolicy');
    if (!button) return;
    // 등록 단추와 입력칸 사이에 '표 넣기' 줄이 있으므로 같은 부처 칸 안에서 입력칸을 찾는다.
    const card = button.closest('.policy-category') || button.parentElement;
    const textarea = card.querySelector('textarea');
    const titleInput = card.querySelector('.post-title-input');
    policyCard = card;
    if (!textarea.value.trim()) { setStatus('policy', '의견을 입력해 주세요.', true); return; }
    setStatus('policy', '등록하는 중입니다…');
    submit('policy', { category: button.dataset.dept, title: titleInput?.value || '', text: textarea.value }, () => { textarea.value = ''; if (titleInput) titleInput.value = ''; });
  });
  $('researchFilter').addEventListener('change', () => render('research'));
  $('communityFilter').addEventListener('change', () => render('community'));
  // 시를 고르면 본문 안내를 시에 맞게 바꾼다.
  $('communityType').addEventListener('change', () => {
    const poem = $('communityType').value === '시';
    $('communityInput').placeholder = poem ? '시를 적어 주세요. 줄바꿈과 빈 줄이 그대로 보입니다.' : '안부, 일상, 취미, 고민을 자유롭게 적어주세요.';
    $('communityTitle').placeholder = poem ? '시 제목 (선택)' : '제목 (선택)';
  });
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
    forwardAdmin();
    const current = `${state.user?.id || ''}:${state.user?.admin || false}`;
    if (previous !== current) {
      state.ready = true;
      Object.keys(sections).forEach(load);
    }
  }
  window.addEventListener('space-auth', event => applyAuth(event.detail));
  updateComposers();
  if (window.spaceAuth) applyAuth(window.spaceAuth);
  else ['community', 'voice', 'policy', 'research'].forEach(load);
})();

// 칼럼·학술 '대법원 전원합의체 판결'을 고르면 제목·개인정보 안내를 바꿔 보여 준다.
(() => {
  const type = document.getElementById('researchType');
  const hint = document.getElementById('researchHint');
  const title = document.getElementById('researchTitle');
  if (!type || !hint || !title) return;
  const base = { hint: hint.textContent, title: title.placeholder };
  // 전원합의체 판결용 요약 틀: 본문이 비어 있을 때만 채우고, 손대지 않은 채 다른 종류로 바꾸면 다시 비운다.
  const input = document.getElementById('researchInput');
  const TEMPLATE = ['■ 사건: 대법원 0000. 0. 0. 선고 0000다00000 전원합의체 판결', '■ 쟁점: ', '■ 판결요지: (대법원 종합법률정보의 판결요지)',
    '■ 변경된 종전 판례: (없으면 \'없음\')', '■ 의견 구성: 다수의견 ○명 / 반대의견 ○명', '■ 운영자 한마디: ', '---', '(판결 전문)'].join('\n');
  const update = () => {
    const judgment = type.value === '대법원 전원합의체 판결';
    if (input) {
      if (judgment && !input.value.trim()) input.value = TEMPLATE;
      else if (!judgment && input.value === TEMPLATE) input.value = '';
      input.dispatchEvent(new Event('input'));
    }
    const review = type.value === '판결 평론';
    hint.textContent = judgment ? '대법원이 공개한 전원합의체 판결 원문(비실명 처리본)을 올려 주세요. 출처: 대법원 종합법률정보'
      : review ? '판결의 쟁점·논리·사회적 의미에 대한 나의 생각을 적어 주세요. 판결 글 아래 「✍️ 이 판결 평론 쓰기」를 누르면 그 판결과 이어집니다.' : base.hint;
    title.placeholder = judgment ? '예: 대법원 2024. 5. 23. 선고 2020다12345 전원합의체 판결 — 핵심 쟁점 한 줄'
      : review ? '예: [평론] 2020다12345 판결 — 다수의견이 놓친 것' : base.title;
  };
  type.addEventListener('change', update);
  update();
})();
