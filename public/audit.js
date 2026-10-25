// 「양산 주민감사청구」 화면: 제도 안내 · 제보하기 · 진행 현황 · 내 제보 · 운영자 검토
(function () {
  const root = document.getElementById('audit-section');
  if (!root) return;
  const AGENCIES = ['양산시청(본청)', '읍·면·동 행정복지센터', '양산시 사업소·출자출연기관', '양산시의회', '그 밖의 양산시 관련 기관'];
  const FIELDS = ['예산·회계', '계약·공사', '인허가·단속', '민원 처리', '보조금·복지', '인사·조직', '그 밖의 사항'];
  const PRIOR = ['아직 없음', '민원을 냈음', '정보공개청구를 했음', '민원과 정보공개청구 모두'];
  let STATUSES = ['접수', '검토 중', '자료 보완 요청', '청구 추진', '청구 제출', '종결'];
  const $ = selector => root.querySelector(selector);
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text != null) el.textContent = text; return el; };
  const auth = () => window.spaceAuth || {};
  const day = at => { const d = new Date(at); return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`; };

  async function call(url, body) {
    const response = await fetch(url, body ? {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': auth().csrfToken || '' }, body: JSON.stringify(body),
    } : { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `오류 (${response.status})`);
    return data;
  }

  // ---------- 탭 ----------
  let current = 'guide';
  function show(name) {
    current = name;
    root.querySelectorAll('[data-audit]').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.audit === name)));
    root.querySelectorAll('[data-audit-pane]').forEach(pane => { pane.hidden = pane.dataset.auditPane !== name; });
    if (name === 'cases') loadCases();
    if (name === 'mine') loadMine();
    if (name === 'admin') loadAdmin();
  }
  root.querySelectorAll('[data-audit]').forEach(tab => tab.addEventListener('click', () => show(tab.dataset.audit)));
  root.querySelectorAll('[data-audit-go]').forEach(button => button.addEventListener('click', () => { show(button.dataset.auditGo); $('.audit-tabs').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));

  // ---------- 제보 양식 ----------
  const form = document.getElementById('audit-form');
  const status = document.getElementById('audit-status');
  const fill = (select, list) => select.replaceChildren(...list.map(value => { const option = make('option', '', value); option.value = value; return option; }));
  fill(form.elements.agency, AGENCIES);
  fill(form.elements.field, FIELDS);
  fill(form.elements.prior, PRIOR);
  const count = $('[data-count-for="facts"]');
  form.elements.facts.addEventListener('input', () => { count.textContent = `${form.elements.facts.value.length.toLocaleString('ko-KR')} / 3,000자`; });

  function refreshAuth() {
    const user = auth().user;
    const ok = Boolean(user && user.emailVerified);
    $('.audit-login').hidden = ok;
    form.querySelectorAll('input, select, textarea, button').forEach(el => { el.disabled = !ok; });
    root.querySelector('[data-audit="admin"]').hidden = !(user && user.admin);
    if (!user && current === 'admin') show('guide');
  }
  window.addEventListener('space-auth', refreshAuth);
  refreshAuth();

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const el = form.elements;
    const body = {
      agency: el.agency.value, field: el.field.value, title: el.title.value, facts: el.facts.value, when: el.when.value,
      prior: el.prior.value, evidence: el.evidence.value, sign: el.sign.checked, contact: el.contact.checked,
      pledge: el.pledge.checked, privacy: el.privacy.checked,
    };
    const send = form.querySelector('button[type="submit"]');
    send.disabled = true;
    status.dataset.error = 'false';
    status.textContent = '보내는 중입니다…';
    try {
      await call('/api/audit/tips', body);
      form.reset();
      count.textContent = '0 / 3,000자';
      status.textContent = '제보가 접수되었습니다. 처리 상태는 「내 제보」에서 볼 수 있습니다. 감사합니다.';
    } catch (error) {
      status.dataset.error = 'true';
      status.textContent = error.message;
    } finally { send.disabled = false; }
  });

  // ---------- 목록 ----------
  function caseItem(item, own) {
    const li = make('li', 'audit-case');
    const head = make('div', 'audit-case-head');
    head.append(make('span', `audit-badge s${Math.max(0, STATUSES.indexOf(item.status))}`, item.status), make('span', 'audit-meta', `${item.agency} · ${item.field}`));
    li.append(head, make('strong', '', item.title));
    if (item.summary) li.appendChild(make('p', '', item.summary));
    li.appendChild(make('small', 'audit-meta', own ? `보낸 날 ${day(item.createdAt)} · 마지막 처리 ${day(item.updatedAt)}` : `업데이트 ${day(item.updatedAt)}`));
    return li;
  }
  async function loadCases() {
    const list = document.getElementById('audit-cases');
    try {
      const data = await call('/api/audit/cases');
      if (data.statuses) STATUSES = data.statuses;
      list.replaceChildren(...(data.cases.length ? data.cases.map(item => caseItem(item, false)) : [make('li', 'feed-empty', '아직 공개된 사안이 없습니다.')]));
    } catch (error) { list.replaceChildren(make('li', 'feed-empty', error.message)); }
  }
  async function loadMine() {
    const list = document.getElementById('audit-mine');
    if (!auth().user) { list.replaceChildren(make('li', 'feed-empty', '로그인하면 내가 보낸 제보와 처리 상태를 볼 수 있습니다.')); return; }
    try {
      const data = await call('/api/audit/mine');
      list.replaceChildren(...(data.tips.length ? data.tips.map(item => caseItem(item, true)) : [make('li', 'feed-empty', '아직 보낸 제보가 없습니다.')]));
    } catch (error) { list.replaceChildren(make('li', 'feed-empty', error.message)); }
  }

  // ---------- 운영자 검토 ----------
  async function loadAdmin() {
    const box = document.getElementById('audit-admin');
    box.replaceChildren(make('p', 'feed-empty', '불러오는 중입니다.'));
    let data;
    try { data = await call('/api/audit/tips'); } catch (error) { box.replaceChildren(make('p', 'feed-empty', error.message)); return; }
    STATUSES = data.statuses || STATUSES;
    if (!data.tips.length) { box.replaceChildren(make('p', 'feed-empty', '받은 제보가 없습니다.')); return; }
    box.replaceChildren(...data.tips.map(tip => {
      const card = make('details', 'audit-admin-card');
      const summary = make('summary');
      summary.append(make('span', `audit-badge s${Math.max(0, STATUSES.indexOf(tip.status))}`, tip.status), make('strong', '', tip.title),
        make('span', 'audit-meta', `${tip.authorName} · ${day(tip.createdAt)}${tip.published ? ' · 공개 중' : ''}`));
      card.appendChild(summary);
      const facts = make('dl', 'audit-dl');
      const row = (name, value) => { if (value) facts.append(make('dt', '', name), make('dd', '', value)); };
      row('대상·분야', `${tip.agency} · ${tip.field}`);
      row('발생 시기', tip.when);
      row('사실관계', tip.facts);
      row('이전 조치', tip.prior);
      row('서명 참여', tip.sign ? '참여 의사 있음' : '');
      row('연락', tip.contact ? '회원 이메일로 연락 동의' : '연락 동의 안 함');
      if (tip.evidence?.length) {
        const dd = make('dd');
        tip.evidence.forEach(url => { const a = make('a', '', url); a.href = url; a.target = '_blank'; a.rel = 'noopener nofollow'; dd.append(a, make('br')); });
        facts.append(make('dt', '', '근거 자료'), dd);
      }
      card.appendChild(facts);
      const edit = make('form', 'audit-form audit-review');
      const statusSelect = make('select'); fill(statusSelect, STATUSES); statusSelect.value = tip.status;
      const memo = make('textarea'); memo.rows = 2; memo.maxLength = 1000; memo.value = tip.memo || ''; memo.placeholder = '운영자 메모 (공개되지 않음)';
      const pub = make('input'); pub.type = 'checkbox'; pub.checked = Boolean(tip.published);
      const pubTitle = make('input'); pubTitle.maxLength = 80; pubTitle.value = tip.publicTitle || ''; pubTitle.placeholder = '공개용 제목 (사실 위주, 개인 이름 빼기)';
      const pubSummary = make('textarea'); pubSummary.rows = 3; pubSummary.maxLength = 1500; pubSummary.value = tip.publicSummary || ''; pubSummary.placeholder = '공개용 요약 (진행 상황·결과)';
      const label = (text, control) => { const l = make('label', '', text); l.appendChild(control); return l; };
      const pubLabel = make('label', 'audit-inline'); pubLabel.append(pub, make('span', '', '「진행 현황」에 공개'));
      const save = make('button', 'btn-audit gold', '저장'); save.type = 'submit';
      const note = make('p', 'form-status');
      edit.append(label('처리 상태', statusSelect), label('메모', memo), pubLabel, label('공개용 제목', pubTitle), label('공개용 요약', pubSummary), save, note);
      edit.addEventListener('submit', async event => {
        event.preventDefault();
        save.disabled = true;
        try {
          await call(`/api/audit/tips/${tip.id}`, { status: statusSelect.value, memo: memo.value, published: pub.checked, publicTitle: pubTitle.value, publicSummary: pubSummary.value });
          note.dataset.error = 'false'; note.textContent = '저장했습니다.';
        } catch (error) { note.dataset.error = 'true'; note.textContent = error.message; }
        finally { save.disabled = false; }
      });
      card.appendChild(edit);
      return card;
    }));
  }
})();
