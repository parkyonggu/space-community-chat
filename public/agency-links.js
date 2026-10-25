// 「자주 찾는 기관 바로가기」 띠: 사이트 맨 아래 정보(푸터) 바로 위에 넣는다.
// ★ 기관을 더하거나 빼려면 아래 SITES 목록에 한 줄만 고치면 된다. (순서대로 보인다)
//   { icon: '그림 기호', name: '기관 이름', desc: '한 줄 설명', url: 'https://공식 주소', group: '분야' },
//   group(분야)에 따라 카드 색이 정해진다: 복지(파랑) · 일(청록) · 지역(초록) · 참여(금색) · 단체(주황)
// 기관 로고는 쓰지 않는다(제휴로 오해받지 않도록). 누르면 새 창으로 열린다.
var SITES = [
  { icon: '🏦', name: '국민연금공단', desc: '내 연금 조회·신청', url: 'https://www.nps.or.kr/', group: '복지' },
  { icon: '🏥', name: '국민건강보험공단', desc: '건강보험·장기요양', url: 'https://www.nhis.or.kr/', group: '복지' },
  { icon: '🏛️', name: '보건복지부', desc: '기초연금·복지 정책', url: 'https://www.mohw.go.kr/', group: '복지' },
  { icon: '🤝', name: '복지로', desc: '복지서비스 찾기·신청', url: 'https://www.bokjiro.go.kr/', group: '복지' },
  { icon: '💼', name: '고용노동부', desc: '일자리·노동 정책', url: 'https://www.moel.go.kr/', group: '일' },
  { icon: '🏞️', name: '경상남도', desc: '경남 도정 소식', url: 'https://www.gyeongnam.go.kr/index.gyeong', group: '지역' },
  { icon: '🗳️', name: '경상남도 도민참여', desc: '도민제안·참여 플랫폼', url: 'https://www.gyeongnam.go.kr/gn1st/index.gyeong?contentsSid=3769', group: '지역' },
  { icon: '🌉', name: '양산시', desc: '양산 시정·민원', url: 'https://www.yangsan.go.kr/', group: '지역' },
  { icon: '🏛️', name: '대한민국 국회', desc: '법률안·국회의원·회의 정보', url: 'https://www.assembly.go.kr/', group: '참여' },
  { icon: '✍️', name: '국회 국민동의청원', desc: '청원 찬성·등록', url: 'https://petitions.assembly.go.kr/', group: '참여' },
  { icon: '🔍', name: '주민e직접', desc: '주민감사청구·조례청구 전자서명', url: 'https://www.juminegov.go.kr/', group: '참여' },
  { icon: '📮', name: '국민신문고', desc: '민원·제안 신청', url: 'https://www.epeople.go.kr/', group: '참여' },
  { icon: '⚖️', name: '국민참여입법센터', desc: '입법예고 의견 내기', url: 'https://opinion.lawmaking.go.kr/', group: '참여' },
  { icon: '👴', name: '대한노인회', desc: '어르신 단체 소식', url: 'https://koreapeople.or.kr/', group: '단체' },
];

(function () {
  if (document.querySelector('.agency-strip')) return;
  var footer = document.querySelector('footer.site-footer');
  if (!footer) return;
  var css = document.createElement('style');
  css.textContent =
    '.agency-strip{background:linear-gradient(135deg,#16224a 0%,#1d3b8a 100%);border-top:4px solid #f5b941;padding:8px 0 6px}' +
    '.agency-strip .agency-in{max-width:1180px;margin:0 auto;padding:0 16px}' +
    '.agency-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:5px}' +
    '.agency-head h2{margin:0;font-size:15px;line-height:1.3;font-weight:800;color:#fff}' +
    '.agency-head h2::before{content:"";display:inline-block;width:5px;height:15px;margin-right:8px;border-radius:3px;background:#f5b941;vertical-align:-2px}' +
    '.agency-view{overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:none}' +
    '.agency-view::-webkit-scrollbar{display:none}' +
    '.agency-track{display:flex;gap:12px;width:max-content;padding:2px 2px 4px}' +
    '.agency-card{--c:#1d3b8a;--t:#eaf0ff;display:flex;align-items:center;gap:9px;min-width:200px;max-width:250px;padding:7px 12px;border-radius:12px;background:#fff;color:#0e1730;text-decoration:none;border-top:4px solid var(--c);box-shadow:0 4px 12px rgba(0,0,0,.18);transition:transform .15s}' +
    '.agency-card:hover,.agency-card:focus-visible{transform:translateY(-2px);outline:3px solid #f5b941;outline-offset:2px}' +
    '.agency-card .ic{flex:none;width:34px;height:34px;border-radius:10px;background:var(--t);display:grid;place-items:center;font-size:19px}' +
    '.agency-card strong{display:block;font-size:15px;line-height:1.25;color:#0e1730}' +
    '.agency-card small{display:block;margin-top:1px;font-size:13px;line-height:1.3;color:var(--c);font-weight:700}' +
    '.agency-card.g-복지{--c:#1d4ed8;--t:#e3ecff}.agency-card.g-일{--c:#0f766e;--t:#dcf5f1}.agency-card.g-지역{--c:#15803d;--t:#e1f6e6}' +
    '.agency-card.g-참여{--c:#b7791f;--t:#fff3d6}.agency-card.g-단체{--c:#c2410c;--t:#ffe9dc}' +
    '.agency-note{margin:2px 0 0;font-size:12px;color:#c9d0e3}' ;
  document.head.appendChild(css);

  var section = document.createElement('section');
  section.className = 'agency-strip';
  section.setAttribute('aria-label', '자주 찾는 기관 바로가기');
  var inner = document.createElement('div');
  inner.className = 'agency-in';
  var head = document.createElement('div');
  head.className = 'agency-head';
  var h2 = document.createElement('h2');
  h2.textContent = '자주 찾는 기관 바로가기';
  head.appendChild(h2);
  var view = document.createElement('div');
  view.className = 'agency-view';
  var track = document.createElement('div');
  track.className = 'agency-track';
  function card(site, copy) {
    var a = document.createElement('a');
    a.className = 'agency-card' + (site.group ? ' g-' + site.group : '');
    a.href = site.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = site.name + ' 누리집 (새 창)';
    if (copy) { a.setAttribute('aria-hidden', 'true'); a.tabIndex = -1; }
    var ic = document.createElement('span'); ic.className = 'ic'; ic.textContent = site.icon;
    var text = document.createElement('span');
    var s = document.createElement('strong'); s.textContent = site.name;
    var m = document.createElement('small'); m.textContent = site.desc;
    text.appendChild(s); text.appendChild(m);
    a.appendChild(ic); a.appendChild(text);
    return a;
  }
  SITES.forEach(function (site) { track.appendChild(card(site, false)); });
  // 끊김 없이 돌도록 같은 목록을 한 번 더 붙인다(화면 읽기 프로그램에는 숨김).
  SITES.forEach(function (site) { track.appendChild(card(site, true)); });
  view.appendChild(track);
  var note = document.createElement('p');
  note.className = 'agency-note';
  note.textContent = '누르면 해당 기관 누리집이 새 창으로 열립니다. 스페이스커뮤니티와 제휴 관계는 아닙니다.';
  inner.appendChild(head); inner.appendChild(view); inner.appendChild(note);
  section.appendChild(inner);
  footer.parentNode.insertBefore(section, footer);

  // 천천히 옆으로 흐르기. 마우스·손가락을 올리면 멈춘다. 손가락으로 밀어 넘길 수도 있다.
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var paused = reduce, hover = false, touchUntil = 0, pos = 0, last = 0;
  view.addEventListener('mouseenter', function () { hover = true; });
  view.addEventListener('mouseleave', function () { hover = false; });
  view.addEventListener('focusin', function () { hover = true; });
  view.addEventListener('focusout', function () { hover = false; });
  ['touchstart', 'wheel', 'pointerdown'].forEach(function (type) {
    view.addEventListener(type, function () { touchUntil = Date.now() + 4000; }, { passive: true });
  });
  view.addEventListener('scroll', function () { if (Date.now() < touchUntil) pos = view.scrollLeft; }, { passive: true });
  function step(t) {
    var dt = last ? Math.min(64, t - last) : 16;
    last = t;
    if (!paused && !hover && Date.now() > touchUntil && document.visibilityState === 'visible') {
      var half = track.scrollWidth / 2;
      pos += dt * 0.03; // 1초에 약 30px
      if (pos >= half) pos -= half;
      view.scrollLeft = pos;
    } else {
      pos = view.scrollLeft;
      var half2 = track.scrollWidth / 2;
      if (half2 && pos >= half2) { pos -= half2; view.scrollLeft = pos; }
    }
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
})();
