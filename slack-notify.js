// 운영자 슬랙 알림 (Slack Incoming Webhook)
// SLACK_WEBHOOK_URL(https://hooks.slack.com/services/…)이 있을 때만 보내고, 없으면 아무 일도 하지 않는다.
// 알림은 운영자 한 사람만 보는 채널로 가지만, 이메일은 가려서 보내고 글은 앞부분만 보낸다.

const BOARD_NAMES = { community: '소통·나눔', voice: '시민의 소리', policy: '정책 제안', research: '칼럼·학술', issue: '오늘의 이슈' };

// 슬랙 글자에서 특별한 뜻이 있는 &, <, > 를 바꾼다(사용자 글이 링크·멘션으로 바뀌지 않게).
const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clip = (value, length) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length)}…` : text;
};
function maskEmail(email) {
  const [name, domain] = String(email || '').split('@');
  if (!name || !domain) return '';
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(1, Math.min(6, name.length - 2)))}@${domain}`;
}
const isWebhook = url => /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(String(url || ''));

function createSlackNotifier({ webhookUrl: rawUrl = '', siteUrl = 'https://withpluces.com', fetchImpl = (...args) => fetch(...args) } = {}) {
  // 붙여 넣을 때 앞뒤에 섞여 들어간 빈칸·줄바꿈·따옴표는 떼어 낸다
  const webhookUrl = String(rawUrl || '').trim().replace(/^["']|["']$/g, '').trim();
  const ready = isWebhook(webhookUrl);
  const site = String(siteUrl || 'https://withpluces.com').replace(/\/+$/, '');
  async function send(text) {
    if (!ready) return false;
    const response = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }),
    });
    if (!response.ok) throw new Error(`슬랙 알림 실패 (HTTP ${response.status})`);
    return true;
  }
  return {
    ready,
    send,
    signup: user => send(`🙋 *새 회원가입* · ${escape(clip(user?.nickname, 40))}${user?.email ? ` (${escape(maskEmail(user.email))})` : ''}`),
    comment: comment => send(`💬 *새 댓글* · 독자 소통 공간\n*${escape(clip(comment?.name, 40))}*: ${escape(clip(comment?.text, 200))}\n<${site}/#reader-section|댓글 보러 가기>`),
    post: post => {
      const title = clip(post?.title || String(post?.text || '').split('\n')[0], 80);
      const link = post?.no ? `${site}/post/${post.no}` : `${site}/#latest-section`;
      return send(`📝 *새 글* · ${escape(BOARD_NAMES[post?.board] || '게시판')}\n*${escape(title)}* — ${escape(clip(post?.authorName, 40))}\n<${link}|글 보러 가기>`);
    },
    talkRoom: (user, room) => send(`🗨️ *스페이스 톡 새 대화방* · ${escape(clip(room?.name, 60))} — 만든 사람 ${escape(clip(user?.nickname, 40))}`),
    talkJoin: (user, room, { guest = false } = {}) => send(`➕ *스페이스 톡 입장* · ${escape(clip(user?.nickname, 40))}${guest ? ' (손님)' : ''} → ${escape(clip(room?.name, 60))} (초대 링크)`),
    share: ({ title, url } = {}) => {
      const link = String(url || '');
      if (!link.startsWith(site)) return Promise.resolve(false);
      return send(`🔗 *카카오톡 공유* · ${escape(clip(title, 80) || '스페이스 커뮤니티')}\n<${link}|공유한 페이지 열기>`);
    },
  };
}

module.exports = { createSlackNotifier, maskEmail, isWebhook };
