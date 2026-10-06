const commentForm = document.getElementById('reader-comment-form');
const commentStatus = document.getElementById('reader-comment-status');
const commentList = document.getElementById('reader-comments');
const commentCount = document.getElementById('reader-comment-count');
const newsletterForm = document.getElementById('newsletter-form');
const newsletterStatus = document.getElementById('newsletter-status');
const unsubscribeForm = document.getElementById('unsubscribe-form');
const unsubscribeStatus = document.getElementById('unsubscribe-status');

function setStatus(element, message, isError = false) {
  element.textContent = message;
  element.dataset.error = String(isError);
}

async function apiRequest(url, body) {
  const response = await fetch(url, body ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } : { cache: 'no-store' });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('서버 API가 응답하지 않습니다. Node.js 서버 연결을 확인해 주세요.');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `서버 오류 (${response.status})`);
  return result;
}

function renderComment(comment) {
  const card = document.createElement('article');
  card.className = 'reader-comment';
  const meta = document.createElement('div');
  meta.className = 'reader-meta';
  const name = document.createElement('strong');
  name.textContent = comment.name;
  const time = document.createElement('time');
  time.dateTime = comment.createdAt;
  time.textContent = new Date(comment.createdAt).toLocaleString('ko-KR');
  const text = document.createElement('p');
  text.textContent = comment.text;
  meta.append(name, time);
  card.append(meta, text);
  return card;
}

async function loadComments() {
  const { comments } = await apiRequest('/api/comments');
  commentList.replaceChildren(...comments.map(renderComment));
  commentCount.textContent = `댓글 ${comments.length}개`;
}

document.getElementById('reader-comments-refresh').addEventListener('click', async () => {
  try {
    await loadComments();
    setStatus(commentStatus, '댓글을 새로 불러왔습니다.');
  } catch (error) {
    setStatus(commentStatus, error.message, true);
  }
});

commentForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = commentForm.querySelector('button');
  button.disabled = true;
  setStatus(commentStatus, '댓글을 저장하고 있습니다.');
  try {
    const { comment } = await apiRequest('/api/comments', {
      name: document.getElementById('reader-name').value,
      text: document.getElementById('reader-text').value,
    });
    commentList.prepend(renderComment(comment));
    commentCount.textContent = `댓글 ${commentList.childElementCount}개`;
    document.getElementById('reader-text').value = '';
    setStatus(commentStatus, '댓글이 등록되었습니다.');
  } catch (error) {
    setStatus(commentStatus, error.message, true);
  } finally {
    button.disabled = false;
  }
});

newsletterForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = newsletterForm.querySelector('button');
  button.disabled = true;
  setStatus(newsletterStatus, '구독 신청을 저장하고 있습니다.');
  try {
    const result = await apiRequest('/api/newsletter', {
      email: document.getElementById('newsletter-email').value,
      consent: document.getElementById('newsletter-consent').checked,
    });
    newsletterForm.reset();
    setStatus(newsletterStatus, result.message);
  } catch (error) {
    setStatus(newsletterStatus, error.message, true);
  } finally {
    button.disabled = false;
  }
});

unsubscribeForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const button = unsubscribeForm.querySelector('button');
  button.disabled = true;
  setStatus(unsubscribeStatus, '구독 해지를 처리하고 있습니다.');
  try {
    const result = await apiRequest('/api/newsletter/unsubscribe', {
      email: document.getElementById('unsubscribe-email').value,
    });
    unsubscribeForm.reset();
    setStatus(unsubscribeStatus, result.message);
  } catch (error) {
    setStatus(unsubscribeStatus, error.message, true);
  } finally {
    button.disabled = false;
  }
});

loadComments().catch(error => {
  commentCount.textContent = '댓글 로드 실패';
  setStatus(commentStatus, error.message, true);
});
