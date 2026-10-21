// 조문 바로 보기: 글 속 「기초연금법 제8조」, 「헌법 제26조」 같은 표현을 누르면 법제처의 현행 조문 원문을 창으로 보여 준다.
(function () {
  var NOT_LAW = ['방법', '위법', '불법', '편법', '문법', '입법', '사법', '해법', '동법', '같은법', '이법', '본법', '현행법', '개정법', '해당법', '관련법', '특별법', '기본법'];
  var RE = /(헌법|[가-힣]{2,30}법(?:\s?시행령|\s?시행규칙)?)」?\s?제(\d{1,4})조(?:의(\d{1,2}))?/g;
  function lawName(raw) {
    var name = raw.replace(/\s+/g, ' ').trim();
    var base = name.replace(/\s?(시행령|시행규칙)$/, '');
    if (NOT_LAW.indexOf(base) >= 0) return '';
    return name;
  }
  function linkify(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!/제\d{1,4}조/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        if (node.parentNode.closest && node.parentNode.closest('a, button, script, style, .law-ref')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      var text = node.nodeValue, last = 0, match, frag = document.createDocumentFragment(), changed = false;
      RE.lastIndex = 0;
      while ((match = RE.exec(text))) {
        var name = lawName(match[1]);
        if (!name) continue;
        changed = true;
        frag.appendChild(document.createTextNode(text.slice(last, match.index)));
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'law-ref';
        button.textContent = match[0];
        button.title = '조문 원문 보기';
        button.dataset.name = name;
        button.dataset.jo = match[2];
        button.dataset.sub = match[3] || '0';
        frag.appendChild(button);
        last = match.index + match[0].length;
      }
      if (!changed) return;
      frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function openBox(button) {
    var old = document.querySelector('.law-box-wrap');
    if (old) old.remove();
    var wrap = el('div', 'law-box-wrap'), box = el('div', 'law-box');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    var head = el('div', 'law-box-head'), title = el('strong', '', button.dataset.name + ' ' + button.textContent.replace(/^.*?(제\d)/, '$1'));
    var close = el('button', 'law-box-close', '닫기');
    close.type = 'button';
    head.appendChild(title); head.appendChild(close);
    var body = el('div', 'law-box-body', '조문을 불러오는 중입니다…');
    box.appendChild(head); box.appendChild(body); wrap.appendChild(box);
    document.body.appendChild(wrap);
    function done() { wrap.remove(); document.removeEventListener('keydown', onKey); button.focus(); }
    function onKey(e) { if (e.key === 'Escape') done(); }
    close.addEventListener('click', done);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) done(); });
    document.addEventListener('keydown', onKey);
    close.focus();
    var url = '/api/portal/law?name=' + encodeURIComponent(button.dataset.name) + '&jo=' + button.dataset.jo + '&sub=' + button.dataset.sub;
    fetch(url, { credentials: 'same-origin' }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); }).then(function (res) {
      body.textContent = '';
      if (!res.ok) { body.appendChild(el('p', 'law-box-error', res.d.error || '조문을 불러오지 못했습니다.')); return; }
      var d = res.d;
      title.textContent = d.name + ' ' + d.label + (d.title ? '(' + d.title + ')' : '');
      d.lines.forEach(function (line) {
        var p = el('p', /^\s{4}/.test(line) ? 'law-sub2' : /^\s{2}/.test(line) ? 'law-sub' : '', line.trim());
        body.appendChild(p);
      });
      var foot = el('p', 'law-box-foot');
      foot.appendChild(document.createTextNode('현행 시행 ' + (d.effective || '') + ' · 출처: 법제처 국가법령정보센터 '));
      var a = el('a', '', '원문 사이트에서 보기');
      a.href = d.link; a.target = '_blank'; a.rel = 'noopener';
      foot.appendChild(a);
      body.appendChild(foot);
    }).catch(function () { body.textContent = '조문을 불러오지 못했습니다. 잠시 후 다시 눌러 주세요.'; });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.law-ref');
    if (b) { e.preventDefault(); openBox(b); }
  });
  var css = el('style');
  css.textContent = '.law-ref{display:inline;padding:0 2px;margin:0;border:0;border-bottom:2px dotted #1d4ed8;background:#eef3ff;color:#1d3b8a;font:inherit;font-weight:700;cursor:pointer;border-radius:3px}' +
    '.law-ref:hover{background:#dbe5ff}' +
    '.law-box-wrap{position:fixed;inset:0;z-index:1000;background:rgba(14,23,48,.55);display:flex;align-items:flex-end;justify-content:center;padding:0}' +
    '@media(min-width:700px){.law-box-wrap{align-items:center;padding:24px}}' +
    '.law-box{width:100%;max-width:680px;max-height:85vh;display:flex;flex-direction:column;background:#fff;border-radius:16px 16px 0 0;box-shadow:0 10px 40px rgba(0,0,0,.3)}' +
    '@media(min-width:700px){.law-box{border-radius:16px}}' +
    '.law-box-head{display:flex;align-items:center;gap:10px;padding:14px 16px;background:#0e1730;color:#fff;border-radius:16px 16px 0 0}' +
    '.law-box-head strong{flex:1;font-size:calc(18px * var(--fs, 1));line-height:1.4}' +
    '.law-box-close{min-width:64px;min-height:40px;border:0;border-radius:10px;background:#f5b941;color:#0e1730;font-weight:800;font-size:16px;cursor:pointer}' +
    '.law-box-body{overflow:auto;padding:14px 18px 18px;font-size:calc(17px * var(--fs, 1));line-height:1.75;color:#2b3550;word-break:keep-all}' +
    '.law-box-body p{margin:0 0 10px}.law-box-body .law-sub{padding-left:1.2em}.law-box-body .law-sub2{padding-left:2.4em}' +
    '.law-box-foot{margin-top:14px!important;padding-top:10px;border-top:1px solid #e3e6ef;font-size:14px;color:#5d6680}.law-box-foot a{color:#1d4ed8}' +
    '.law-box-error{color:#b42318}';
  document.head.appendChild(css);
  function start() { document.querySelectorAll('.post-body, .card .body').forEach(linkify); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
