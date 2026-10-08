const communityMenus = [
  ['chat-section', '실시간 채팅'],
  ['community-section', '소통·나눔'],
  ['voice-section', '시민의 소리'],
  ['policy-section', '정책 제안'],
  ['research-section', '칼럼·학술'],
];

const homeHeader = document.querySelector('body > header');
const homeNavigation = homeHeader.querySelector('nav');
const navigationLinks = homeNavigation.querySelectorAll('a');
navigationLinks[0].href = '/';

communityMenus.forEach(([sectionId, label], index) => {
  const link = navigationLinks[index + 1] || navigationLinks[1].cloneNode(true);
  link.href = `/community.html#${sectionId}`;
  link.textContent = label;
  link.removeAttribute('data-path');
  link.removeAttribute('aria-current');
  if (!link.parentElement) homeNavigation.appendChild(link);
});

homeHeader.querySelector('[data-path="home"]').href = '/';
homeHeader.querySelector('[data-path="write-article"]').href = '/community.html#research-section';
const accountLink = homeHeader.querySelector('[data-path="my-profile"]');
accountLink.href = '/community.html#login';
accountLink.setAttribute('aria-label', '로그인 · 회원가입');
accountLink.title = '로그인 · 회원가입';

const originalLoginButton = document.getElementById('login-toggle-btn');
const actualLoginButton = originalLoginButton.cloneNode(true);
let homeAccountPath = '/community.html#login';
actualLoginButton.textContent = '로그인 · 회원가입';
actualLoginButton.addEventListener('click', () => { window.location.href = homeAccountPath; });
originalLoginButton.replaceWith(actualLoginButton);

async function refreshHomeAccount() {
  try {
    const response = await fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error('로그인 상태를 확인할 수 없습니다.');
    const { user } = await response.json();
    homeAccountPath = user ? '/community.html#guide-section' : '/community.html#login';
    accountLink.href = homeAccountPath;
    accountLink.title = user ? `${user.nickname} 님 · 계정 관리` : '로그인 · 회원가입';
    accountLink.setAttribute('aria-label', accountLink.title);
    actualLoginButton.textContent = accountLink.title;
  } catch (error) {
    actualLoginButton.textContent = '로그인 상태 확인 실패 · 로그인 페이지로 이동';
    console.error('Home authentication state failed:', error);
  }
}
const homeAuthChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('space-auth') : null;
homeAuthChannel?.addEventListener('message', refreshHomeAccount);
window.addEventListener('focus', refreshHomeAccount);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshHomeAccount();
});
refreshHomeAccount();

const mobileNavigation = homeNavigation.cloneNode(true);
mobileNavigation.className = 'community-mobile-navigation';
mobileNavigation.setAttribute('aria-label', '커뮤니티 메뉴');
homeHeader.appendChild(mobileNavigation);
