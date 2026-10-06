const previewMessage = '준비 중 · 무료 미리보기에서는 등록하거나 저장하지 않습니다.';
document.querySelectorAll('textarea, input:not(#searchInput), .submitPolicy, #sendBtn').forEach(control => {
  control.disabled = true;
  control.title = previewMessage;
});
document.querySelectorAll('form').forEach(form => {
  form.addEventListener('submit', event => event.preventDefault());
});
for (const id of ['chatBox', 'reader-comment-status', 'newsletter-status']) {
  document.getElementById(id).textContent = previewMessage;
}
document.getElementById('reader-comment-count').textContent = '댓글 준비 중';
document.querySelector('#newsletter-section .intro').textContent =
  '뉴스레터 서비스는 준비 중입니다. 무료 미리보기에서는 이메일을 수집하거나 구독 신청을 접수하지 않습니다.';
document.querySelectorAll('.submitPolicy, #sendBtn').forEach(button => {
  button.textContent = '준비 중';
});
for (const target of [document.querySelector('header .brand'), document.getElementById('guide-section')]) {
  const group = document.createElement('div');
  group.className = 'auth-controls';
  for (const label of ['회원가입 준비 중', '로그인 준비 중']) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'signup-open-button';
    button.textContent = label;
    button.disabled = true;
    button.title = previewMessage;
    group.appendChild(button);
  }
  target.appendChild(group);
}
const articleLink = document.querySelector('.home-link');
articleLink.href = '/';
articleLink.textContent = '스페이스 커뮤니티 홈';
