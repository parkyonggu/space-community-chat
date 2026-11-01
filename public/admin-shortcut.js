// 운영자 바로가기: 운영자 계정으로 로그인하면 화면 오른쪽 아래에 '⚙️ 운영자 · 발송승인' 단추가 뜬다.
// 승인을 기다리는 시장동향 브리핑이 있으면 개수를 빨간 표시로 보여 준다. 운영자가 아니면 아무것도 하지 않는다.
(() => {
  if (window.spaceAdminShortcut) return;
  let button = null;
  async function pendingCount() {
    try {
      const response = await fetch('/api/admin/briefing', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return 0;
      const data = await response.json();
      return Array.isArray(data.pending) ? data.pending.length : 0;
    } catch { return 0; }
  }
  async function show(isAdmin) {
    if (!isAdmin) { if (button) button.hidden = true; return; }
    if (!button) {
      button = document.createElement('a');
      button.href = '/newsletter-admin#approval';
      button.className = 'admin-shortcut';
      button.setAttribute('aria-label', '운영자 관리 화면 · 발송승인');
      // 스페이스 톡은 아래쪽에 글 입력칸이 있으므로 위쪽에 작게 띄운다.
      const talk = location.pathname.startsWith('/chat');
      const place = talk ? 'top:calc(8px + env(safe-area-inset-top,0px));right:8px;padding:6px 10px;font-size:13px;' : 'bottom:calc(16px + env(safe-area-inset-bottom,0px));right:16px;padding:12px 16px;font-size:15px;';
      button.style.cssText = place + 'position:fixed;z-index:9999;display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:#0e1730;color:#f5b941;border:2px solid #f5b941;font-weight:800;text-decoration:none;box-shadow:0 6px 18px rgba(0,0,0,.28);font-family:inherit';
      button.innerHTML = '⚙️ 운영자 · 발송승인<span data-count style="display:none;min-width:22px;padding:1px 7px;border-radius:999px;background:#d63031;color:#fff;font-size:13px;text-align:center"></span>';
      document.body.appendChild(button);
    }
    button.hidden = false;
    const count = await pendingCount();
    const badge = button.querySelector('[data-count]');
    badge.textContent = String(count);
    badge.style.display = count ? 'inline-block' : 'none';
    button.title = count ? `승인을 기다리는 브리핑 ${count}건` : '운영자 관리 화면';
  }
  window.spaceAdminShortcut = { show };
  // 홈 화면: 로그인 상태가 바뀔 때마다(signup.js가 알려 줌)
  window.addEventListener('space-auth', event => show(Boolean(event.detail?.user?.admin)));
  if (window.spaceAuth) show(Boolean(window.spaceAuth.user?.admin));
  if (window.spaceTalkAdmin) show(true);
})();
