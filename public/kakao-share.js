// 카카오톡 공식 공유(카카오 JavaScript SDK): 로고 이미지·제목·'자세히 보기' 단추가 있는 카드로 보낸다.
// 카드 아래에는 카카오 개발자 앱 이름(스페이스 커뮤니티)과 아이콘이 표시된다. 실패하면 false를 돌려주고, 부르는 쪽이 다른 공유 방법을 쓴다.
(() => {
  const KAKAO_JS_KEY = '9f26d2766e3adc5910be03c5c157e5df';
  const SDK = 'https://t1.kakaocdn.net/kakao_js_sdk/2.8.2/kakao.min.js';
  const SDK_INTEGRITY = 'sha384-zt/G7/KfaRQ9dT/QIkS0ujMtzouJqzuSJcXVQu50x0rl/+mD1dc70AeOejVbMD9E';
  let loading;
  function load() {
    if (window.Kakao) return Promise.resolve(window.Kakao);
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = SDK;
        script.integrity = SDK_INTEGRITY;
        script.crossOrigin = 'anonymous';
        script.onload = () => (window.Kakao ? resolve(window.Kakao) : reject(new Error('Kakao SDK missing')));
        script.onerror = () => { loading = null; reject(new Error('Kakao SDK load failed')); };
        document.head.appendChild(script);
      });
    }
    return loading;
  }
  // { title, description, imageUrl, link, button } → 카카오톡 공유 창을 연다.
  window.spaceKakaoShare = async ({ title, description = '', imageUrl, link, button = '자세히 보기' }) => {
    try {
      const Kakao = await load();
      if (!Kakao.isInitialized()) Kakao.init(KAKAO_JS_KEY);
      const target = { mobileWebUrl: link, webUrl: link };
      Kakao.Share.sendDefault({
        objectType: 'feed',
        content: { title: String(title).slice(0, 200), description: String(description).slice(0, 200), imageUrl, imageWidth: 1200, imageHeight: 630, link: target },
        buttons: [{ title: button, link: target }],
      });
      return true;
    } catch (error) {
      console.error('Kakao share failed:', error);
      return false;
    }
  };
  // 공유 단추를 누르기 전에 미리 불러 두면 첫 공유가 빨라진다.
  if (document.readyState === 'complete') setTimeout(() => load().catch(() => {}), 1500);
  else window.addEventListener('load', () => setTimeout(() => load().catch(() => {}), 1500));
})();
