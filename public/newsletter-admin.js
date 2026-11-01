(() => {
  const $ = id => document.getElementById(id);
  let csrfToken = '';
  let summary = null;
  let previewTimer;
  let refreshTimer;
  const DRAFT_KEY = 'space-newsletter-draft';
  const templates = {
    weekly: { subject: '스페이스 레터 · 이번 주 소식', body: '# 이번 주 스페이스 소식\n\n안녕하세요, 스페이스 커뮤니티입니다. 한 주 동안 커뮤니티에서 나눈 이야기를 모아 전해 드립니다.\n\n## 이번 주 주목할 글\n\n- **글 제목** — 한 줄 소개\n- **글 제목** — 한 줄 소개\n\n## 시민의 소리\n\n이번 주 공론화된 주제를 소개합니다.\n\n[커뮤니티에서 자세히 보기](https://withpluces.com/)\n\n---\n\n다음 주에 또 찾아뵙겠습니다.' },
    notice: { subject: '[공지] 스페이스 커뮤니티 안내', body: '# 공지 안내\n\n안녕하세요, 스페이스 커뮤니티 운영진입니다.\n\n## 안내 내용\n\n변경되는 내용을 적어 주세요.\n\n## 적용 일정\n\n- 시행일: 2026년 ○월 ○일\n\n궁금한 점은 언제든 문의해 주세요.\n\n[스페이스 커뮤니티 바로가기](https://withpluces.com/)' },
    column: { subject: '스페이스 레터 · 칼럼', body: '# 칼럼 제목\n\n도입 문단을 적어 주세요.\n\n## 소제목\n\n본문을 적어 주세요.\n\n---\n\n글쓴이 소개 한 줄\n\n[학술·논문·소고·이야기에서 더 읽기](https://withpluces.com/#research-section)' },
  };

  function setStatus(id, message, isError = false) {
    $(id).textContent = message;
    $(id).dataset.error = String(isError);
  }

  async function api(url, body) {
    const response = await fetch(url, body ? {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify(body),
    } : { credentials: 'same-origin', cache: 'no-store' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `오류 (${response.status})`);
    return result;
  }

  // 발송 건별 받은 사람 명단: 이메일, 발송 결과, (뉴스레터는) 열람·클릭 여부
  async function showRecipients(campaign) {
    const box = $('campaign-recipients');
    box.hidden = false;
    box.replaceChildren(document.createTextNode('명단을 불러오는 중입니다…'));
    try {
      const data = await api(`/api/admin/newsletter/recipients?id=${encodeURIComponent(campaign.id)}`);
      const tracked = data.kind === 'newsletter';
      const resultLabel = { sent: '보냄', failed: '실패', queued: '보낼 차례', cancelled: '취소됨', processed: '보냄(이전 기록)' };
      const title = document.createElement('h3');
      title.textContent = `「${data.subject}」 받은 사람 ${data.recipients.length}명`;
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = '닫기';
      close.addEventListener('click', () => { box.hidden = true; });
      const counts = data.recipients.reduce((sum, entry) => { sum[entry.result] = (sum[entry.result] || 0) + 1; return sum; }, {});
      const note = document.createElement('p');
      note.className = 'muted';
      note.textContent = Object.entries(counts).map(([key, value]) => `${resultLabel[key] || key} ${value}명`).join(' · ') +
        (tracked ? ` · 열람 ${data.recipients.filter(entry => entry.opened).length}명 · 클릭 ${data.recipients.filter(entry => entry.clicked).length}명` : '');
      const table = document.createElement('table');
      const head = document.createElement('tr');
      ['#', '이메일', '발송 결과', ...(tracked ? ['열람', '클릭'] : [])].forEach(text => { const th = document.createElement('th'); th.textContent = text; head.appendChild(th); });
      table.appendChild(head);
      data.recipients.forEach((entry, index) => {
        const tr = document.createElement('tr');
        tr.append(cell(index + 1), cell(entry.email || '(구독 해지로 삭제됨)'), cell(resultLabel[entry.result] || entry.result),
          ...(tracked ? [cell(entry.opened ? '✓' : ''), cell(entry.clicked ? '✓' : '')] : []));
        table.appendChild(tr);
      });
      if (!data.recipients.length) { const tr = document.createElement('tr'); const td = cell('받은 사람이 없습니다.'); td.colSpan = 5; tr.appendChild(td); table.appendChild(tr); }
      box.replaceChildren(title, note, table, close);
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      box.replaceChildren(document.createTextNode(error.message));
    }
  }

  function cell(text) {
    const td = document.createElement('td');
    td.textContent = text;
    return td;
  }

  const percent = (part, total) => (total ? `${Math.round((part / total) * 1000) / 10}%` : '-');
  const date = value => (value ? new Date(value).toLocaleString('ko-KR') : '-');
  const kindLabel = { newsletter: '뉴스레터', confirm: '구독 확인', notice: '수신동의 안내' };
  const statusLabel = { sending: '발송 중', done: '완료', cancelled: '취소됨', scheduled: '예약됨' };
  const MANUAL = '[직접 작성]';
  const kstText = value => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });

  function render() {
    const s = summary.subscribers;
    const stats = [
      ['구독 확인 완료', s.confirmed], ['확인 대기', s.pending], ['기존 신청(확인 필요)', s.legacy],
      ['2년 안내 대상', s.noticeDue], ['오늘 보낸 메일', `${summary.sentToday} / ${summary.dailyLimit}`],
    ];
    $('stats').replaceChildren(...stats.map(([label, value]) => {
      const box = document.createElement('div');
      box.className = 'stat';
      const b = document.createElement('b');
      b.textContent = value;
      const span = document.createElement('span');
      span.textContent = label;
      box.append(b, span);
      return box;
    }));
    $('mail-note').textContent = summary.mailConfigured
      ? `메일은 하루 ${summary.dailyLimit}통 이내로, 1분에 20통씩 나누어 발송됩니다. 한도를 넘는 분량은 다음 날 이어서 보냅니다.`
      : '메일 발송이 설정되지 않아 발송할 수 없습니다.';
    const sending = summary.campaigns.some(c => c.status === 'sending' || c.status === 'scheduled');
    $('send').disabled = !summary.mailConfigured || sending || !s.confirmed;
    $('schedule').disabled = !summary.mailConfigured || sending;
    $('schedule').textContent = `${kstText(summary.nextMonday)} 예약 발송`;
    $('ecos-note').textContent = `자료 연결: 한국은행 ECOS ${summary.ecosKey ? '인증키 사용 ✔' : '시험용 키(정식 키 등록 권장)'} · IMF 전망 ✔ · 한국부동산원 ${summary.rebKey ? '인증키 사용 ✔' : '미연결(REB_API_KEY 등록 시 주간 아파트 동향 자동 작성)'} · 정책브리핑 ${summary.policyKey ? '인증키 사용 ✔' : '미연결(POLICY_NEWS_KEY 등록 시 이번 주 정부 정책 자동 작성)'}`;
    const draftTable = document.createElement('table');
    const draftHead = document.createElement('tr');
    ['만든 시각', '방식', '제목', ''].forEach(text => { const th = document.createElement('th'); th.textContent = text; draftHead.appendChild(th); });
    draftTable.appendChild(draftHead);
    for (const draft of summary.drafts) {
      const tr = document.createElement('tr');
      const action = document.createElement('td');
      const open = document.createElement('button');
      open.textContent = '편집기로 불러오기';
      open.addEventListener('click', () => loadDraft(draft.id));
      action.appendChild(open);
      tr.append(cell(date(draft.createdAt)), cell(draft.source === 'auto' ? '자동(일요일)' : '수동'), cell(draft.subject), action);
      draftTable.appendChild(tr);
      if (draft.notes && draft.notes.length) {
        const noteRow = document.createElement('tr');
        const noteCell = document.createElement('td');
        noteCell.colSpan = 4;
        noteCell.style.cssText = 'color:#b42318;font-size:0.9em;white-space:pre-wrap';
        noteCell.textContent = '자료 오류:\n' + draft.notes.map(note => '· ' + note).join('\n');
        noteRow.appendChild(noteCell);
        draftTable.appendChild(noteRow);
      }
    }
    if (!summary.drafts.length) { const tr = document.createElement('tr'); const td = cell('아직 초안이 없습니다. "지금 초안 만들기"로 바로 만들어 볼 수 있습니다.'); td.colSpan = 4; tr.appendChild(td); draftTable.appendChild(tr); }
    $('drafts').replaceChildren(draftTable);
    $('reconfirm').disabled = !summary.mailConfigured || sending || !(s.legacy + s.pending);
    $('notice').disabled = !summary.mailConfigured || sending || !s.noticeDue;
    $('send').textContent = `구독자 전체(${s.confirmed}명)에게 발송`;
    $('reconfirm').textContent = `기존·미확인 신청자(${s.legacy + s.pending}명)에게 구독 확인 메일 보내기`;
    $('notice').textContent = `2년 수신동의 안내 보내기 (${s.noticeDue}명)`;

    const table = document.createElement('table');
    const head = document.createElement('tr');
    ['보낸 날', '종류', '제목', '상태', '대상', '발송', '실패', '남음', '열람률', '클릭률', '수신거부', ''].forEach(text => {
      const th = document.createElement('th');
      th.textContent = text;
      head.appendChild(th);
    });
    table.appendChild(head);
    for (const campaign of summary.campaigns) {
      const tr = document.createElement('tr');
      const badge = document.createElement('span');
      badge.className = `badge ${campaign.status}`;
      badge.textContent = statusLabel[campaign.status] || campaign.status;
      const statusCell = document.createElement('td');
      statusCell.appendChild(badge);
      if (campaign.errors.length) statusCell.append(document.createElement('br'), `오류: ${campaign.errors.join(', ')}`);
      const actions = document.createElement('td');
      if (campaign.status === 'scheduled' && campaign.sendAt) statusCell.append(document.createElement('br'), kstText(campaign.sendAt));
      if (campaign.status === 'sending' || campaign.status === 'scheduled') {
        const cancel = document.createElement('button');
        cancel.className = 'danger';
        cancel.textContent = campaign.status === 'scheduled' ? '예약 취소' : '남은 발송 취소';
        cancel.addEventListener('click', async () => {
          if (!confirm('남은 발송을 취소할까요? 이미 보낸 메일은 회수되지 않습니다.')) return;
          try { setStatus('ops-status', (await api('/api/admin/newsletter/cancel', { id: campaign.id })).message); load(); } catch (error) { setStatus('ops-status', error.message, true); }
        });
        actions.appendChild(cancel);
      }
      if (campaign.status !== 'scheduled') {
        const who = document.createElement('button');
        who.type = 'button';
        who.textContent = '받은 사람 보기';
        who.addEventListener('click', () => showRecipients(campaign));
        actions.appendChild(who);
      }
      const tracked = campaign.kind === 'newsletter';
      tr.append(cell(date(campaign.createdAt)), cell(kindLabel[campaign.kind] || campaign.kind),
        cell(`${campaign.ad ? '(광고) ' : ''}${campaign.subject}`), statusCell, cell(campaign.status === 'scheduled' ? '발송 시 확정' : campaign.total), cell(campaign.sent),
        cell(campaign.failed), cell(campaign.remaining), cell(tracked ? `${percent(campaign.opens, campaign.sent)} (${campaign.opens})` : '-'),
        cell(tracked ? `${percent(campaign.clicks, campaign.sent)} (${campaign.clicks})` : '-'), cell(tracked ? campaign.unsubscribes : '-'), actions);
      table.appendChild(tr);
    }
    if (!summary.campaigns.length) {
      const tr = document.createElement('tr');
      const td = cell('아직 발송 기록이 없습니다.');
      td.colSpan = 12;
      tr.appendChild(td);
      table.appendChild(tr);
    }
    $('campaigns').replaceChildren(table);
    clearTimeout(refreshTimer);
    if (sending) refreshTimer = setTimeout(load, 15000);
  }

  async function load() {
    try {
      summary = await api('/api/admin/newsletter');
      render();
    } catch (error) {
      setStatus('ops-status', error.message, true);
    }
  }

  function content() {
    return { subject: $('subject').value, body: $('body').value, ad: $('ad').checked };
  }

  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(content())); } catch { /* storage unavailable */ }
  }

  async function loadDraft(id) {
    if (($('body').value.trim() || $('subject').value.trim()) && !confirm('편집기의 현재 내용을 이 초안으로 바꿀까요?')) return;
    try {
      const { draft } = await api('/api/admin/newsletter/draft/get', { id });
      $('subject').value = draft.subject;
      $('body').value = draft.body;
      $('ad').checked = false;
      schedulePreview();
      $('subject').scrollIntoView({ behavior: 'smooth', block: 'center' });
      setStatus('draft-status', '초안을 편집기로 불러왔습니다. 내용을 확인하고, 필요하면 맨 아래 \'운영자 한마디\'에 직접 글을 더해 주세요(쓰지 않으면 자동으로 빠집니다).');
    } catch (error) { setStatus('draft-status', error.message, true); }
  }

  function manualWarning() {
    const count = ($('body').value.match(/\[직접 작성\]/g) || []).length;
    if (count) setStatus('compose-status', `아직 채우지 않은 [직접 작성] 칸이 ${count}곳 있습니다. 채우거나 지워야 발송할 수 있습니다.`, true);
    else if ($('compose-status').dataset.error === 'true' && $('compose-status').textContent.includes(MANUAL)) setStatus('compose-status', '');
  }

  function schedulePreview() {
    saveDraft();
    manualWarning();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      const draft = content();
      if (!draft.subject.trim() || !draft.body.trim()) {
        $('preview').srcdoc = '<p style="font-family:sans-serif;color:#6b7891;padding:24px">제목과 본문을 쓰면 미리보기가 표시됩니다.</p>';
        $('preview-subject').textContent = '';
        return;
      }
      try {
        const result = await api('/api/admin/newsletter/preview', draft);
        $('preview').srcdoc = result.html;
        $('preview-subject').textContent = `— 받는 사람에게 보이는 제목: ${result.subject}`;
      } catch (error) {
        setStatus('compose-status', error.message, true);
      }
    }, 500);
  }

  function insert(kind) {
    const textarea = $('body');
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end);
    let text;
    if (kind === 'h1') text = `\n\n# ${selected || '큰 제목'}\n\n`;
    else if (kind === 'h2') text = `\n\n## ${selected || '소제목'}\n\n`;
    else if (kind === 'bold') text = `**${selected || '굵은 글자'}**`;
    else if (kind === 'link') {
      const url = prompt('연결할 주소를 입력하세요 (https://로 시작)', 'https://');
      if (!url) return;
      text = `[${selected || '링크 글자'}](${url.trim()})`;
    } else if (kind === 'image') {
      const url = prompt('이미지 주소를 입력하세요 (https://로 시작하는 공개 이미지)', 'https://');
      if (!url) return;
      text = `\n\n![${selected || '이미지 설명'}](${url.trim()})\n\n`;
    } else if (kind === 'list') text = `\n\n${(selected || '항목 1\n항목 2').split('\n').map(line => `- ${line.replace(/^- /, '')}`).join('\n')}\n\n`;
    else text = '\n\n---\n\n';
    textarea.setRangeText(text, start, end, 'end');
    textarea.focus();
    schedulePreview();
  }

  // ---------- 회원 찾기 · 비밀번호 재설정 링크 ----------
  const mailPurpose = { verify: '인증 메일', reset: '재설정 메일' };
  function mailResult(entry) {
    if (!entry) return '기록 없음';
    const when = date(entry.at);
    return `${mailPurpose[entry.purpose] || entry.purpose} ${entry.ok ? '보냄' : `실패(${entry.error || '오류'})`} · ${when}`;
  }
  async function searchMembers() {
    const q = $('member-q').value.trim();
    $('member-link').hidden = true;
    if (q.length < 2) { setStatus('member-status', '이메일이나 닉네임을 2자 이상 입력해 주세요.', true); return; }
    setStatus('member-status', '찾는 중입니다…');
    try {
      const { members } = await api('/api/auth/admin/members', { q });
      setStatus('member-status', members.length ? `${members.length}명을 찾았습니다.` : '찾는 회원이 없습니다. 가입하지 않은 주소일 수 있습니다.', !members.length);
      const table = document.createElement('table');
      const head = document.createElement('tr');
      ['이메일', '닉네임', '이메일 인증', '가입일', '최근 계정 메일', ''].forEach(text => { const th = document.createElement('th'); th.textContent = text; head.appendChild(th); });
      table.appendChild(head);
      members.forEach(member => {
        const tr = document.createElement('tr');
        const action = document.createElement('td');
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = '재설정 링크 만들기';
        button.addEventListener('click', () => makeResetLink(member, button));
        action.appendChild(button);
        tr.append(cell(member.email), cell(member.nickname), cell(member.emailVerified ? '완료' : '미인증'), cell(date(member.createdAt)), cell(mailResult(member.lastAuthMail)), action);
        table.appendChild(tr);
      });
      $('member-list').replaceChildren(...(members.length ? [table] : []));
    } catch (error) {
      setStatus('member-status', error.message, true);
    }
  }
  async function makeResetLink(member, button) {
    const verify = $('member-verify').checked;
    if (!confirm(`${member.nickname}(${member.email}) 님의 비밀번호 재설정 링크를 만들까요?${verify ? '\n이메일 인증도 함께 처리합니다.' : ''}`)) return;
    button.disabled = true;
    try {
      const result = await api('/api/auth/admin/reset-link', { userId: member.id, verify });
      $('member-link-text').value = result.link;
      $('member-link').hidden = false;
      $('member-link').dataset.nickname = member.nickname;
      setStatus('member-status', result.message);
    } catch (error) {
      setStatus('member-status', error.message, true);
    } finally {
      button.disabled = false;
    }
  }
  function shareText() {
    return `[스페이스 커뮤니티] ${$('member-link').dataset.nickname || ''}님, 아래 링크를 열어 새 비밀번호를 정해 주세요. (24시간 동안 한 번만 쓸 수 있습니다)\n${$('member-link-text').value}`;
  }
  if ($('member-search')) {
    $('member-search').addEventListener('click', searchMembers);
    $('member-q').addEventListener('keydown', event => { if (event.key === 'Enter') searchMembers(); });
    $('member-link-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(shareText()); setStatus('member-status', '안내 문구와 링크를 복사했습니다. 카톡·문자에 붙여 넣어 보내 주세요.'); }
      catch { $('member-link-text').select(); setStatus('member-status', '링크를 선택했습니다. Ctrl+C로 복사해 주세요.'); }
    });
    $('member-link-share').addEventListener('click', async () => {
      if (navigator.share) { try { await navigator.share({ text: shareText() }); } catch { /* 취소 */ } }
      else $('member-link-copy').click();
    });
  }


  // ---------- 발송승인 탭: 시장동향 브리핑을 읽고 승인하면 공개·발송 ----------
  const KIND_NAME = { weekly: '주간', monthly: '월간' };
  const when = ms => ms ? new Date(ms).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  // 메일 본문(스페이스레터 표기)을 읽기 쉬운 글로: 링크 표기·굵게 표시를 걷어 낸다.
  const plainMail = text => String(text || '').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)').replace(/\*\*/g, '').replace(/^# /gm, '');
  function showTab(name) {
    document.querySelectorAll('[data-tab]').forEach(section => { section.hidden = section.dataset.tab !== name; });
    $('tab-approval').setAttribute('aria-selected', String(name === 'approval'));
    $('tab-newsletter').setAttribute('aria-selected', String(name === 'newsletter'));
    try { history.replaceState(null, '', name === 'approval' ? '#approval' : location.pathname); } catch { /* ignore */ }
  }
  function resultText(result) {
    if (!result) return '';
    const talk = result.talk || {};
    const talkLine = talk.status === 'posted' ? `스페이스톡 게시(받는 사람 ${talk.subscribers ?? 0}명)` : talk.status === 'skipped' ? '스페이스톡: 이미 게시됨' : `스페이스톡 실패: ${talk.message || ''}`;
    const mail = result.mail || {};
    const mailLine = mail.status === 'sent' ? `메일: ${mail.message}` : mail.status === 'error' ? `메일 실패: ${mail.message}` : `메일: ${mail.message || '없음'}`;
    return `${talkLine} · ${mailLine} · 슬랙 ${result.slack === 'sent' ? '알림' : '알림 없음'}`;
  }
  function approvalCard(entry, pending, audience) {
    const card = document.createElement('article');
    card.className = 'approval-card';
    const tag = document.createElement('span');
    tag.className = `badge ${pending ? 'scheduled' : 'done'}`;
    tag.textContent = pending ? `${KIND_NAME[entry.kind]} · 승인 대기` : `${KIND_NAME[entry.kind]} · ${when(entry.approvedAt)} 승인`;
    const title = document.createElement('h3');
    title.textContent = entry.title;
    const summaryLine = document.createElement('p');
    summaryLine.className = 'muted';
    summaryLine.textContent = entry.summary || '(요약 없음)';
    card.append(tag, title, summaryLine);
    if (pending) {
      const meta = document.createElement('p');
      meta.className = 'muted';
      meta.textContent = `작성: ${when(entry.updatedAt)}`;
      card.appendChild(meta);
      const mailTitle = document.createElement('p');
      mailTitle.style.margin = '10px 0 0';
      mailTitle.innerHTML = '<b>스페이스톡·메일로 나갈 내용</b>';
      const mail = document.createElement('div');
      mail.className = 'mail';
      mail.textContent = entry.mail ? `제목: ${entry.mail.subject}\n\n${plainMail(entry.mail.body)}` : '아직 메일 내용이 저장되지 않았습니다(작성 작업이 끝나면 채워집니다). 이대로 승인하면 메일은 보내지 않고 스페이스톡·슬랙만 나갑니다.';
      card.append(mailTitle, mail);
    } else if (entry.result) {
      const done = document.createElement('p');
      done.className = 'muted';
      done.textContent = resultText(entry.result);
      card.appendChild(done);
    }
    const row = document.createElement('div');
    row.className = 'row';
    const link = document.createElement('a');
    link.href = entry.previewUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = pending ? '전문 미리보기(새 창) →' : '공개 페이지 보기 →';
    row.appendChild(link);
    if (pending) {
      const approve = document.createElement('button');
      approve.type = 'button';
      approve.className = 'primary';
      const who = audience ? (audience.audience === 'subscribers' ? `구독자 ${audience.confirmedSubscribers}명` : '운영자(시험 발송)') : '메일 대상';
      approve.textContent = '✅ 승인하고 발송';
      approve.addEventListener('click', async () => {
        if (!confirm(`'${entry.title}'을(를) 공개하고 스페이스톡·${who} 메일·슬랙으로 보냅니다. 보낸 메일은 되돌릴 수 없습니다. 승인할까요?`)) return;
        approve.disabled = true;
        setStatus('approval-status', '승인하고 보내는 중입니다…');
        try {
          const result = await api('/api/admin/briefing/approve', { kind: entry.kind, slug: entry.slug });
          setStatus('approval-status', `승인했습니다. ${resultText(result.result)}`);
          loadApprovals();
        } catch (error) { approve.disabled = false; setStatus('approval-status', error.message, true); }
      });
      row.appendChild(approve);
    }
    card.appendChild(row);
    return card;
  }
  async function loadApprovals() {
    try {
      const data = await api('/api/admin/briefing');
      const audience = data.audience;
      $('approval-note').textContent = `${data.approval ? '발송승인 사용 중' : '발송승인 꺼짐(자동 발송)'} · 메일 대상: ${audience ? (audience.audience === 'subscribers' ? `구독자 전체(현재 ${audience.confirmedSubscribers}명)` : '운영자 시험 발송') : '확인 못 함'}`;
      const empty = text => { const p = document.createElement('p'); p.className = 'muted'; p.textContent = text; return p; };
      $('approval-pending').replaceChildren(...(data.pending.length ? data.pending.map(entry => approvalCard(entry, true, audience)) : [empty('승인을 기다리는 브리핑이 없습니다.')]));
      $('approval-done').replaceChildren(...(data.done.length ? data.done.map(entry => approvalCard(entry, false, audience)) : [empty('아직 없습니다.')]));
      $('approval-count').hidden = !data.pending.length;
      $('approval-count').textContent = String(data.pending.length);
      return data.pending.length;
    } catch (error) { setStatus('approval-status', error.message, true); return 0; }
  }
  async function init() {
    try {
      const session = await api('/api/auth/session');
      csrfToken = session.csrfToken;
      if (!session.user?.admin) {
        $('gate-message').innerHTML = '';
        $('gate-message').append(session.user ? '운영자 계정만 이용할 수 있습니다.' : '운영자 계정으로 로그인해 주세요. ');
        const link = document.createElement('a');
        link.href = '/#login';
        link.textContent = '로그인하러 가기';
        link.style.color = '#5f8dff';
        if (!session.user) $('gate-message').appendChild(link);
        return;
      }
    } catch (error) {
      $('gate-message').textContent = error.message;
      return;
    }
    $('gate').hidden = true;
    $('app').hidden = false;
    $('tab-approval').addEventListener('click', () => { showTab('approval'); loadApprovals(); });
    $('tab-newsletter').addEventListener('click', () => showTab('newsletter'));
    showTab(location.hash === '#approval' ? 'approval' : 'newsletter');
    loadApprovals().then(count => { if (count && location.hash !== '#approval') showTab('approval'); });
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (draft) {
        $('subject').value = draft.subject || '';
        $('body').value = draft.body || '';
        $('ad').checked = draft.ad === true;
      }
    } catch { /* ignore */ }
    ['subject', 'body', 'ad'].forEach(id => $(id).addEventListener('input', schedulePreview));
    $('ad').addEventListener('change', schedulePreview);
    document.querySelectorAll('[data-insert]').forEach(button => button.addEventListener('click', () => insert(button.dataset.insert)));
    $('template').addEventListener('change', () => {
      const template = templates[$('template').value];
      if (!template) return;
      if (($('body').value.trim() || $('subject').value.trim()) && !confirm('지금 쓰고 있는 내용을 서식으로 바꿀까요?')) {
        $('template').value = '';
        return;
      }
      $('subject').value = template.subject;
      $('body').value = template.body;
      $('template').value = '';
      schedulePreview();
    });
    $('test').addEventListener('click', async () => {
      $('test').disabled = true;
      try { setStatus('compose-status', (await api('/api/admin/newsletter/test', content())).message); } catch (error) { setStatus('compose-status', error.message, true); }
      $('test').disabled = false;
    });
    $('send').addEventListener('click', async () => {
      const draft = content();
      if (!confirm(`구독자 ${summary.subscribers.confirmed}명에게 "${draft.ad ? '(광고) ' : ''}${draft.subject}"를 보낼까요?\n시험 발송으로 내용을 먼저 확인하셨나요? 보낸 메일은 회수할 수 없습니다.`)) return;
      $('send').disabled = true;
      try {
        setStatus('compose-status', (await api('/api/admin/newsletter/send', draft)).message);
        try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      } catch (error) { setStatus('compose-status', error.message, true); }
      load();
    });
    for (const [id, url, question] of [['reconfirm', '/api/admin/newsletter/reconfirm', '구독 확인을 하지 않은 신청자에게 확인 메일을 보낼까요? 확인 버튼을 누른 사람만 구독자가 됩니다.'],
      ['notice', '/api/admin/newsletter/notice', '수신동의 후 2년이 지난 구독자에게 수신동의 사실 안내 메일을 보낼까요?']]) {
      $(id).addEventListener('click', async () => {
        if (!confirm(question)) return;
        $(id).disabled = true;
        try { setStatus('ops-status', (await api(url, {})).message); } catch (error) { setStatus('ops-status', error.message, true); }
        load();
      });
    }
    $('refresh').addEventListener('click', load);
    $('generate').addEventListener('click', async () => {
      $('generate').disabled = true;
      setStatus('draft-status', '경제 지표와 커뮤니티 글을 모으고 있습니다.');
      try { const result = await api('/api/admin/newsletter/draft/generate', {}); setStatus('draft-status', result.message); await load(); } catch (error) { setStatus('draft-status', error.message, true); }
      $('generate').disabled = false;
    });
    $('schedule').addEventListener('click', async () => {
      const draft = content();
      if (draft.body.includes(MANUAL)) { manualWarning(); return; }
      if (!confirm(`"${draft.ad ? '(광고) ' : ''}${draft.subject}"를 ${kstText(summary.nextMonday)}에 확인된 구독자 전체에게 보내도록 예약할까요?\n시험 발송으로 내용을 먼저 확인하셨나요?`)) return;
      $('schedule').disabled = true;
      try {
        setStatus('compose-status', (await api('/api/admin/newsletter/send', { ...draft, schedule: 'monday' })).message);
        try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      } catch (error) { setStatus('compose-status', error.message, true); }
      load();
    });
    // 아무 주소로나 시험 메일 보내기(발송이 되는지, 실패하면 왜 안 되는지 바로 보여 준다)
    $('test-to-send').addEventListener('click', async () => {
      const email = $('test-to').value.trim();
      if (!email) { setStatus('ops-status', '받을 이메일 주소를 적어 주세요.', true); return; }
      $('test-to-send').disabled = true;
      try {
        const result = await api('/api/admin/newsletter/test-to', { email });
        setStatus('ops-status', result.message, !result.ok);
      } catch (error) { setStatus('ops-status', error.message, true); }
      $('test-to-send').disabled = false;
    });
    $('show-subscribers').addEventListener('click', async () => {
      const box = $('subscriber-list');
      if (!box.hidden) { box.hidden = true; return; }
      try {
        const { subscribers } = await api('/api/admin/newsletter/subscribers');
        const table = document.createElement('table');
        const head = document.createElement('tr');
        ['이메일', '상태', '신청일', '수신동의일', '확인 메일 발송'].forEach(text => { const th = document.createElement('th'); th.textContent = text; head.appendChild(th); });
        table.appendChild(head);
        const label = { confirmed: '구독 중', pending: '확인 대기', legacy: '기존 신청' };
        subscribers.forEach(entry => {
          const tr = document.createElement('tr');
          const mail = entry.lastMailAt ? `${date(entry.lastMailAt)} ${entry.lastMailOk ? '보냄' : `실패 — ${entry.lastMailError || ''}`}` : '기록 없음';
          tr.append(cell(entry.email), cell(label[entry.status] || entry.status), cell(date(entry.requestedAt)), cell(date(entry.consentAt)), cell(mail));
          table.appendChild(tr);
        });
        box.replaceChildren(table);
        box.hidden = false;
      } catch (error) { setStatus('ops-status', error.message, true); }
    });
    schedulePreview();
    load();
  }
  init();
})();
