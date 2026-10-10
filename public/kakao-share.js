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
  // 카카오톡 카드에는 제목과 두어 줄 요약만 보이므로, 안내문 전체를 세로 안내장 그림(3:4)으로 그려 카드 그림으로 보낸다.
  const loadImage = src => new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
  function wrap(context, text, width) {
    const lines = [];
    for (const paragraph of String(text).split('\n')) {
      if (!paragraph.trim()) { lines.push(''); continue; }
      let line = '';
      for (const char of paragraph) {
        if (context.measureText(line + char).width > width && line) { lines.push(line); line = char.trim() ? char : ''; } else line += char;
      }
      lines.push(line);
    }
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    return lines;
  }
  async function drawCard({ kindLabel, cardTitle, body, footer }) {
    const W = 1080, PAD = 72, MAX_H = 1440, MIN_H = 1080;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = MAX_H;
    let c = canvas.getContext('2d');
    const font = (size, weight = 400) => `${weight} ${size}px "Pretendard","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif`;
    // 내용이 짧으면 그림 높이를 줄인다(정사각형 1080 ~ 세로 3:4 1440).
    let H = MAX_H;
    {
      let titleSize = 66, bodySize = 46;
      c.font = font(titleSize, 800);
      const t = wrap(c, cardTitle, W - PAD * 2).length;
      c.font = font(bodySize, 400);
      const b = wrap(c, body, W - PAD * 2).length;
      const need = 260 + t * titleSize * 1.35 + 40 + b * bodySize * 1.6 + 150 + 40;
      H = Math.round(Math.min(MAX_H, Math.max(MIN_H, need)));
      canvas.height = H;
      c = canvas.getContext('2d');
    }
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, W, H);
    // 머리: 남색 띠 + 로고 + 스페이스 커뮤니티 + 종류
    c.fillStyle = '#0e1730';
    c.fillRect(0, 0, W, 200);
    const logo = await loadImage('/icons/icon-192.png');
    if (logo) {
      c.fillStyle = '#f5b941';
      c.beginPath(); c.roundRect ? c.roundRect(PAD - 6, 44, 124, 124, 30) : c.rect(PAD - 6, 44, 124, 124); c.fill();
      c.save(); c.beginPath(); c.roundRect ? c.roundRect(PAD, 50, 112, 112, 26) : c.rect(PAD, 50, 112, 112); c.clip();
      c.drawImage(logo, PAD, 50, 112, 112); c.restore();
    }
    c.fillStyle = '#ffffff';
    c.font = font(52, 800);
    c.textBaseline = 'middle';
    c.fillText('스페이스 커뮤니티', PAD + 140, 92);
    c.fillStyle = '#f5b941';
    c.font = font(38, 800);
    c.fillText(kindLabel, PAD + 140, 148);
    c.textBaseline = 'alphabetic';
    // 제목과 본문: 다 들어갈 때까지 글자를 줄인다.
    const top = 260, bottom = H - 150, width = W - PAD * 2;
    let titleSize = 66, bodySize = 46, titleLines, bodyLines;
    for (;;) {
      c.font = font(titleSize, 800);
      titleLines = wrap(c, cardTitle, width);
      c.font = font(bodySize, 400);
      bodyLines = wrap(c, body, width);
      const height = titleLines.length * titleSize * 1.35 + 40 + bodyLines.length * bodySize * 1.6;
      if (height <= bottom - top || bodySize <= 30) break;
      bodySize -= 2;
      titleSize = Math.max(48, titleSize - 2);
    }
    let y = top + titleSize;
    c.fillStyle = '#0e1730';
    c.font = font(titleSize, 800);
    for (const line of titleLines) { c.fillText(line, PAD, y); y += titleSize * 1.35; }
    c.fillStyle = '#f5b941';
    c.fillRect(PAD, y - titleSize * 0.6, 120, 8);
    y += 40;
    c.fillStyle = '#2b3550';
    c.font = font(bodySize, 400);
    const room = Math.floor((bottom - y + bodySize) / (bodySize * 1.6));
    const shown = bodyLines.length > room ? [...bodyLines.slice(0, Math.max(1, room - 1)), '… (이어지는 내용은 「자세히 보기」에서)'] : bodyLines;
    for (const line of shown) { c.fillText(line, PAD, y); y += bodySize * 1.6; }
    // 바닥: 주소
    c.fillStyle = '#f4f5f9';
    c.fillRect(0, H - 110, W, 110);
    c.fillStyle = '#5d6680';
    c.font = font(34, 700);
    c.fillText(footer || 'withpluces.com · 스페이스 커뮤니티', PAD, H - 44);
    return new Promise(resolve => canvas.toBlob(blob => { if (blob) blob.height = H; resolve(blob); }, 'image/jpeg', 0.9));
  }
  window.spaceDrawAnnouncementCard = drawCard;

  // { title, description, imageUrl, link, button, card } → 카카오톡 공유 창을 연다.
  // card: { kindLabel, cardTitle, body } 를 주면 안내문 전체를 그린 그림을 카카오 서버에 올려(100일 보관) 카드 그림으로 쓴다.
  window.spaceKakaoShare = async ({ title, description = '', imageUrl, link, button = '자세히 보기', card }) => {
    try {
      const Kakao = await load();
      if (!Kakao.isInitialized()) Kakao.init(KAKAO_JS_KEY);
      let image = { imageUrl, imageWidth: 1200, imageHeight: 630 };
      let text = { title: String(title).slice(0, 200), description: String(description).slice(0, 200) };
      if (card) {
        try {
          const blob = await drawCard(card);
          const uploaded = await Kakao.Share.uploadImage({ file: [new File([blob], 'space-card.jpg', { type: 'image/jpeg' })] });
          const url = uploaded?.infos?.original?.url;
          if (url) {
            image = { imageUrl: url, imageWidth: 1080, imageHeight: blob.height || 1440 };
            // 안내장 그림에 내용이 다 들어 있으니, 그림 아래 글은 잘린 제목·요약 대신 짧은 이름표만 둔다.
            text = { title: `${card.kindLabel} · 스페이스 커뮤니티` };
          }
        } catch (error) {
          console.error('Kakao card image failed, using the default picture:', error);
        }
      }
      const target = { mobileWebUrl: link, webUrl: link };
      Kakao.Share.sendDefault({
        objectType: 'feed',
        content: { ...text, ...image, link: target },
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
