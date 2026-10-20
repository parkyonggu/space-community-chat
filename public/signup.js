const signupDialog = document.getElementById('signup-dialog');
const loginDialog = document.getElementById('login-dialog');
const signupForm = document.getElementById('signup-form');
const loginForm = document.getElementById('login-form');
const signupStatus = document.getElementById('signup-status');
const loginStatus = document.getElementById('login-status');
const forgotDialog = document.getElementById('forgot-dialog');
const verifyDialog = document.getElementById('verify-dialog');
const resetDialog = document.getElementById('reset-dialog');
const forgotForm = document.getElementById('forgot-form');
const verifyForm = document.getElementById('verify-form');
const resetForm = document.getElementById('reset-form');
const forgotStatus = document.getElementById('forgot-status');
const verifyStatus = document.getElementById('verify-status');
const resetStatus = document.getElementById('reset-status');
const deleteDialog = document.getElementById('delete-dialog');
const deleteForm = document.getElementById('delete-form');
const deleteStatus = document.getElementById('delete-status');
const deletePassword = document.getElementById('delete-password');
const resetPassword = document.getElementById('reset-password');
const resetConfirmation = document.getElementById('reset-password-confirm');
const dialogs = { signup: signupDialog, login: loginDialog, forgot: forgotDialog, verify: verifyDialog, reset: resetDialog, delete: deleteDialog };
const forms = [signupForm, loginForm, forgotForm, verifyForm, resetForm, deleteForm];
const linkParameters = new URLSearchParams(window.location.hash.slice(1));
let verificationToken = linkParameters.get('verify');
let resetToken = linkParameters.get('reset');
if (verificationToken || resetToken) {
  history.replaceState(null, '', window.location.pathname + window.location.search);
}
const signupNickname = document.getElementById('signup-nickname');
const signupPassword = document.getElementById('signup-password');
const signupConfirmation = document.getElementById('signup-password-confirm');
const passwordFields = [signupPassword, signupConfirmation, document.getElementById('login-password'), resetPassword, resetConfirmation, deletePassword];
const authChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('space-auth') : null;
let authUser = null;
let csrfToken = null;
let authBusy = false;
let refreshPromise;
let dialogOpener;
let mailConfigured = false;
let lastSessionState = null;
const accountControls = [];

function hidePasswords(form) {
  passwordFields.filter(input => form.contains(input)).forEach(input => {
    input.type = 'password';
    const button = input.parentElement.querySelector('.password-toggle');
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', `${input.labels[0].textContent} 보기`);
    button.title = button.getAttribute('aria-label');
  });
}

passwordFields.forEach(input => {
  const wrapper = document.createElement('div');
  wrapper.className = 'password-input-wrap';
  input.before(wrapper);
  wrapper.appendChild(input);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'password-toggle';
  button.setAttribute('aria-controls', input.id);
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-label', `${input.labels[0].textContent} 보기`);
  button.title = button.getAttribute('aria-label');
  button.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="password-eye-slash" d="m3 3 18 18"/></svg>';
  button.addEventListener('click', () => {
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.setAttribute('aria-pressed', String(visible));
    button.setAttribute('aria-label', `${input.labels[0].textContent} ${visible ? '숨기기' : '보기'}`);
    button.title = button.getAttribute('aria-label');
  });
  wrapper.appendChild(button);
});

function authStatus(element, message, error = false) {
  element.textContent = message;
  element.dataset.error = String(error);
}

async function authRequest(action, input) {
  const response = await fetch(`/api/auth/${action}`, input ? {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken || '' },
    body: JSON.stringify(input),
  } : { cache: 'no-store', credentials: 'same-origin' });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('계정 서버가 응답하지 않습니다. 서버 연결을 확인해 주세요.');
  }
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || `계정 서버 오류 (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return result;
}

function updateControls() {
  accountControls.forEach(control => {
    control.signup.hidden = Boolean(authUser);
    control.login.hidden = Boolean(authUser);
    control.logout.hidden = !authUser;
    control.name.hidden = !authUser;
    control.name.textContent = authUser ? `${authUser.nickname} 님` : '';
    control.verify.hidden = !authUser || authUser.emailVerified;
    control.verify.disabled = authBusy || !csrfToken;
    control.logout.disabled = authBusy || !csrfToken;
    control.remove.hidden = !authUser;
    control.rename.hidden = !authUser;
    control.rename.disabled = authBusy || !csrfToken;
    control.admin.hidden = !authUser?.admin;
    control.remove.disabled = authBusy || !csrfToken;
  });
  forms.forEach(form => {
    form.querySelector('[type="submit"]').disabled = authBusy || !csrfToken ||
      (form === verifyForm && !verificationToken) || (form === resetForm && !resetToken) || (form === deleteForm && !authUser);
  });
}

function applySession(result) {
  authUser = result.user;
  csrfToken = result.csrfToken;
  mailConfigured = result.mailConfigured === true;
  document.getElementById('signup-account-notice').textContent = mailConfigured ?
    '회원가입 후 자동 로그인되며, 이메일로 인증 링크를 보냅니다. 링크는 24시간 유효합니다. 휴대전화 본인인증은 제공하지 않습니다.' :
    '회원가입과 로그인은 가능합니다. 이메일 인증·비밀번호 재설정 메일은 메일 발송 서비스 연결 후 제공됩니다.';
  updateControls();
  window.spaceAuth = { user: authUser, csrfToken, mailConfigured };
  window.dispatchEvent(new CustomEvent('space-auth', { detail: window.spaceAuth }));
}

function refreshSession() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = authRequest('session').then(result => {
    applySession(result);
    const state = result.user ? `${result.user.id}:${result.user.emailVerified}` : 'guest';
    if (state !== lastSessionState) {
      lastSessionState = state;
      if (result.user) {
        accountControls.forEach(control => {
          authStatus(control.status, result.user.emailVerified ? '로그인됨 · 이메일 인증 완료' : '로그인됨 · 이메일 미인증');
        });
      }
    }
  }).catch(error => {
    csrfToken = null;
    updateControls();
    accountControls.forEach(control => authStatus(control.status, error.message, true));
    throw error;
  }).finally(() => { refreshPromise = null; });
  return refreshPromise;
}

function openAuth(dialog, opener) {
  if (opener) dialogOpener = opener;
  Object.values(dialogs).forEach(openDialog => { if (openDialog.open) openDialog.close(); });
  dialog.showModal();
  document.body.classList.add('signup-open');
  if (!csrfToken) refreshSession().catch(error => {
    authStatus(dialog.querySelector('[role="status"]'), error.message, true);
  });
}

function addAccountControls(parent, isGuide = false) {
  const group = document.createElement('div');
  group.className = `auth-controls${isGuide ? ' auth-guide-controls' : ''}`;
  const name = document.createElement('span');
  name.className = 'auth-name';
  const signup = document.createElement('button');
  signup.type = 'button';
  signup.className = 'signup-open-button';
  signup.textContent = '회원가입';
  signup.setAttribute('aria-haspopup', 'dialog');
  signup.setAttribute('aria-controls', 'signup-dialog');
  signup.addEventListener('click', event => openAuth(signupDialog, event.currentTarget));
  const login = document.createElement('button');
  login.type = 'button';
  login.className = 'auth-secondary';
  login.textContent = '로그인';
  login.setAttribute('aria-haspopup', 'dialog');
  login.setAttribute('aria-controls', 'login-dialog');
  login.addEventListener('click', event => openAuth(loginDialog, event.currentTarget));
  const logout = document.createElement('button');
  logout.type = 'button';
  logout.className = 'auth-secondary';
  logout.textContent = '로그아웃';
  const status = document.createElement('span');
  status.className = 'auth-control-status';
  status.setAttribute('role', 'status');
  const verify = document.createElement('button');
  verify.type = 'button';
  verify.className = 'auth-secondary';
  verify.textContent = '인증 메일 보내기';
  verify.addEventListener('click', async () => {
    authBusy = true;
    updateControls();
    try {
      const result = await authRequest('verify/request', {});
      accountControls.forEach(control => authStatus(control.status, result.message));
    } catch (error) {
      authStatus(status, error.message, true);
    } finally {
      authBusy = false;
      updateControls();
    }
  });
  logout.addEventListener('click', async () => {
    authBusy = true;
    updateControls();
    try {
      await authRequest('logout', {});
      authUser = null;
      csrfToken = null;
      authChannel?.postMessage('changed');
      await refreshSession();
      accountControls.forEach(control => authStatus(control.status, '로그아웃되었습니다.'));
    } catch (error) {
      if (error.status === 403) {
        try {
          await refreshSession();
        } catch (refreshError) {
          authStatus(status, refreshError.message, true);
          return;
        }
      }
      authStatus(status, error.message, true);
    } finally {
      authBusy = false;
      updateControls();
    }
  });
  const admin = document.createElement('a');
  admin.className = 'auth-secondary';
  admin.href = '/newsletter-admin';
  admin.textContent = '뉴스레터 관리';
  admin.hidden = true;
  admin.style.textDecoration = 'none';
  const rename = document.createElement('button');
  rename.type = 'button';
  rename.className = 'auth-secondary';
  rename.textContent = '닉네임 변경';
  rename.hidden = true;
  rename.addEventListener('click', async () => {
    if (!authUser || authBusy) return;
    const next = window.prompt('새 닉네임을 입력해 주세요 (2~25자). 이미 쓴 글·댓글의 작성자 이름도 함께 바뀝니다.', authUser.nickname);
    if (next === null) return;
    const nickname = next.trim();
    if (nickname === authUser.nickname) return;
    if (nickname.length < 2 || nickname.length > 25) { authStatus(status, '닉네임은 2~25자로 입력해 주세요.', true); return; }
    authBusy = true;
    updateControls();
    try {
      const result = await authRequest('account/nickname', { nickname });
      authUser = result.user;
      authStatus(status, result.message);
    } catch (error) {
      authStatus(status, error.message, true);
    } finally {
      authBusy = false;
      updateControls();
    }
  });
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'auth-secondary';
  remove.textContent = '회원 탈퇴';
  remove.setAttribute('aria-haspopup', 'dialog');
  remove.setAttribute('aria-controls', 'delete-dialog');
  remove.addEventListener('click', event => openAuth(deleteDialog, event.currentTarget));
  group.append(name, login, signup, verify, rename, logout, admin, remove, status);
  parent.appendChild(group);
  accountControls.push({ name, login, signup, verify, rename, logout, admin, remove, status });
}

addAccountControls(document.querySelector('header .brand'));
addAccountControls(document.getElementById('guide-section'), true);
updateControls();

for (const [dialog, form, status, closeId] of [
  [signupDialog, signupForm, signupStatus, 'signup-close'],
  [loginDialog, loginForm, loginStatus, 'login-close'],
  [forgotDialog, forgotForm, forgotStatus, 'forgot-close'],
  [verifyDialog, verifyForm, verifyStatus, 'verify-close'],
  [resetDialog, resetForm, resetStatus, 'reset-close'],
  [deleteDialog, deleteForm, deleteStatus, 'delete-close'],
]) {
  document.getElementById(closeId).addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    form.reset();
    hidePasswords(form);
    form.querySelectorAll('input').forEach(input => input.setCustomValidity(''));
    status.textContent = '';
    if (!Object.values(dialogs).some(openDialog => openDialog.open)) {
      document.body.classList.remove('signup-open');
      dialogOpener?.focus();
    }
  });
  form.addEventListener('invalid', () => authStatus(status, '입력 내용과 필수 항목을 확인해 주세요.', true), true);
}

document.querySelectorAll('[data-auth-switch]').forEach(button => {
  button.addEventListener('click', () => openAuth(dialogs[button.dataset.authSwitch]));
});

function validateSignupFields() {
  const length = signupNickname.value.trim().length;
  signupNickname.setCustomValidity(length < 2 || length > signupNickname.maxLength ? '닉네임은 앞뒤 공백을 제외한 2~25자로 입력해 주세요.' : '');
  signupPassword.setCustomValidity(signupPassword.value.length < 5 || signupPassword.value.length > 128 ? '비밀번호는 5~128자로 입력해 주세요.' : '');
  signupConfirmation.setCustomValidity(signupConfirmation.value !== signupPassword.value ? '비밀번호가 일치하지 않습니다.' : '');
}

signupForm.addEventListener('input', () => {
  validateSignupFields();
  signupStatus.textContent = '';
});
loginForm.addEventListener('input', () => { loginStatus.textContent = ''; });

async function submitAuth(event, action, form, dialog, status, input) {
  event.preventDefault();
  if (authBusy || !csrfToken || !form.reportValidity()) return;
  authBusy = true;
  updateControls();
  authStatus(status, action === 'register' ? '회원가입을 처리하고 있습니다.' : '로그인하고 있습니다.');
  try {
    const result = await authRequest(action, input);
    applySession(result);
    dialog.close();
    accountControls.forEach(control => authStatus(control.status,
      result.verificationError ? `${result.message} 단, 인증 메일 발송 실패: ${result.verificationError}` :
        action === 'register' ? `${result.message} 이메일 인증 메일을 확인해 주세요.` : result.message, Boolean(result.verificationError)));
    authChannel?.postMessage('changed');
  } catch (error) {
    if (error.status === 403) {
      try {
        await refreshSession();
      } catch (refreshError) {
        authStatus(status, refreshError.message, true);
        return;
      }
    }
    authStatus(status, error.message, true);
  } finally {
    passwordFields.filter(input => form.contains(input)).forEach(input => { input.value = ''; });
    hidePasswords(form);
    authBusy = false;
    updateControls();
  }
}

signupForm.addEventListener('submit', event => {
  validateSignupFields();
  submitAuth(event, 'register', signupForm, signupDialog, signupStatus, {
    email: document.getElementById('signup-email').value,
    nickname: signupNickname.value,
    password: signupPassword.value,
    terms: document.getElementById('signup-terms').checked,
    privacy: document.getElementById('signup-privacy').checked,
    remember: document.getElementById('signup-remember').checked,
  });
});
loginForm.addEventListener('submit', event => submitAuth(event, 'login', loginForm, loginDialog, loginStatus, {
  email: document.getElementById('login-email').value,
  password: document.getElementById('login-password').value,
  remember: document.getElementById('login-remember').checked,
}));

resetForm.addEventListener('input', () => {
  resetPassword.setCustomValidity(resetPassword.value.length < 5 || resetPassword.value.length > 128 ? '비밀번호는 5~128자로 입력해 주세요.' : '');
  resetConfirmation.setCustomValidity(resetConfirmation.value !== resetPassword.value ? '비밀번호가 일치하지 않습니다.' : '');
  resetStatus.textContent = '';
});

async function recoveryAction(event, action, form, status, input) {
  event.preventDefault();
  if (authBusy || !csrfToken || !form.reportValidity()) return;
  authBusy = true;
  updateControls();
  authStatus(status, '요청을 처리하고 있습니다.');
  try {
    const result = await authRequest(action, input);
    if (action === 'verify/confirm') verificationToken = null;
    if (action === 'password/reset') resetToken = null;
    authStatus(status, result.message);
    if (action !== 'password/request') {
      await refreshSession();
      authChannel?.postMessage('changed');
    }
    if (action === 'verify/confirm') {
      setTimeout(() => {
        if (verifyDialog.open) verifyDialog.close();
        accountControls.forEach(control => authStatus(control.status, result.message));
      }, 2000);
    }
    if (action === 'password/reset') {
      setTimeout(() => {
        openAuth(loginDialog);
        authStatus(loginStatus, result.message);
      }, 2000);
    }
  } catch (error) {
    authStatus(status, error.message, true);
    if (error.status === 403) {
      try { await refreshSession(); } catch (refreshError) { authStatus(status, refreshError.message, true); }
    }
  } finally {
    passwordFields.filter(input => form.contains(input)).forEach(input => { input.value = ''; });
    hidePasswords(form);
    authBusy = false;
    updateControls();
  }
}

forgotForm.addEventListener('submit', event => recoveryAction(event, 'password/request', forgotForm, forgotStatus, {
  email: document.getElementById('forgot-email').value,
}));
// 닉네임으로 가입 이메일 찾기: 가린 주소(예: dr*****@gmail.com)만 보여 준다.
const findForm = document.getElementById('find-form');
if (findForm) {
  findForm.addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.getElementById('find-status');
    const result = document.getElementById('find-result');
    if (!findForm.reportValidity()) return;
    if (!csrfToken) { try { await refreshSession(); } catch { /* 아래에서 오류 표시 */ } }
    authStatus(status, '찾고 있습니다.');
    result.hidden = true;
    try {
      const data = await authRequest('account/find', { nickname: document.getElementById('find-nickname').value });
      authStatus(status, data.message, !data.accounts.length);
      result.replaceChildren(...data.accounts.map(account => {
        const li = document.createElement('li');
        li.textContent = account.email;
        return li;
      }));
      result.hidden = !data.accounts.length;
    } catch (error) {
      authStatus(status, error.message, true);
    }
  });
}
verifyForm.addEventListener('submit', event => recoveryAction(event, 'verify/confirm', verifyForm, verifyStatus, {
  token: verificationToken,
}));
resetForm.addEventListener('submit', event => recoveryAction(event, 'password/reset', resetForm, resetStatus, {
  token: resetToken, password: resetPassword.value,
}));

deleteForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (authBusy || !csrfToken || !authUser || !deleteForm.reportValidity()) return;
  authBusy = true;
  updateControls();
  authStatus(deleteStatus, '탈퇴를 처리하고 있습니다.');
  try {
    const result = await authRequest('account/delete', { password: deletePassword.value });
    authUser = null;
    csrfToken = null;
    deleteDialog.close();
    authChannel?.postMessage('changed');
    await refreshSession();
    accountControls.forEach(control => authStatus(control.status, result.message));
  } catch (error) {
    authStatus(deleteStatus, error.message, true);
    if (error.status === 403) {
      try { await refreshSession(); } catch (refreshError) { authStatus(deleteStatus, refreshError.message, true); }
    }
  } finally {
    deletePassword.value = '';
    hidePasswords(deleteForm);
    authBusy = false;
    updateControls();
  }
});

function refreshVisibleSession() {
  if (!authBusy && document.visibilityState === 'visible') {
    refreshSession().catch(error => authStatus(signupDialog.open ? signupStatus : loginStatus, error.message, true));
  }
}
authChannel?.addEventListener('message', () => {
  if (!authBusy) refreshSession().catch(error => authStatus(signupDialog.open ? signupStatus : loginStatus, error.message, true));
});
window.addEventListener('focus', refreshVisibleSession);
document.addEventListener('visibilitychange', refreshVisibleSession);
setInterval(refreshVisibleSession, 60000);
refreshVisibleSession();
window.spaceOpenAuth = name => { if (dialogs[name]) openAuth(dialogs[name]); };
if (window.location.hash === '#login') openAuth(loginDialog);
if (window.location.hash === '#signup') openAuth(signupDialog);
if (verificationToken) openAuth(verifyDialog);
if (resetToken) openAuth(resetDialog);
