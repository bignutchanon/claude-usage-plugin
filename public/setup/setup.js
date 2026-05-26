// Setup wizard client. Validates input, POSTs to /api/setup/save, redirects
// to the dashboard on success.

const form = document.getElementById('setupForm');
const btn = document.getElementById('saveBtn');
const status = document.getElementById('status');

// v3: native sign-in shortcut
const quickPanel = document.getElementById('quickSignin');
const quickBtn = document.getElementById('quickSigninBtn');
const quickStatus = document.getElementById('quickStatus');

(async function checkLoginApp() {
  try {
    const s = await fetch('/api/setup/status').then((r) => r.json());
    if (s.loginAppAvailable) quickPanel.hidden = false;
  } catch {}
})();

function setQuickStatus(text, kind) {
  quickStatus.hidden = !text;
  quickStatus.textContent = text || '';
  quickStatus.className = 'status' + (kind ? ' ' + kind : '');
}

let pollHandle = null;
function startPolling() {
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = setInterval(async () => {
    try {
      const s = await fetch('/api/setup/status').then((r) => r.json());
      if (s.configured) {
        clearInterval(pollHandle);
        setQuickStatus('[+] Connected. Redirecting to dashboard…', 'ok');
        setTimeout(() => { window.location.href = '/'; }, 800);
      }
    } catch {}
  }, 1500);
}

quickBtn.addEventListener('click', async () => {
  setQuickStatus('Launching sign-in window…', 'busy');
  quickBtn.disabled = true;
  try {
    const r = await fetch('/api/setup/launch-login', { method: 'POST' });
    const body = await r.json();
    if (!r.ok || !body.ok) throw new Error(body.error || `HTTP ${r.status}`);
    setQuickStatus('Sign in to claude.ai in the window that just opened. We\'ll detect when you\'re done.', 'busy');
    startPolling();
  } catch (err) {
    quickBtn.disabled = false;
    setQuickStatus(`couldn't launch sign-in app: ${err.message}`, 'error');
  }
});

function setStatus(text, kind) {
  status.hidden = !text;
  status.textContent = text || '';
  status.className = 'status' + (kind ? ' ' + kind : '');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  // Trim everything client-side to catch the most common copy-paste mistake.
  for (const k of Object.keys(data)) data[k] = String(data[k] || '').trim();

  if (!data.sessionKey || !data.orgId) {
    setStatus('sessionKey and orgId are both required', 'error');
    return;
  }

  btn.disabled = true;
  setStatus('verifying against claude.ai …', 'busy');

  let resp, body;
  try {
    resp = await fetch('/api/setup/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    body = await resp.json();
  } catch (err) {
    btn.disabled = false;
    setStatus(`network error: ${err.message}`, 'error');
    return;
  }

  if (!resp.ok) {
    btn.disabled = false;
    setStatus(body.error || `error: HTTP ${resp.status}`, 'error');
    return;
  }

  const org = body.org || {};
  setStatus(
    [
      '[+] credentials verified · stored in Keychain',
      org.email ? `    account : ${org.email}` : '',
      org.tier  ? `    tier    : ${org.tier}`  : '',
      org.name  ? `    org     : ${org.name}`  : '',
      '',
      '→ redirecting to dashboard …',
    ].filter(Boolean).join('\n'),
    'ok',
  );
  setTimeout(() => { window.location.href = '/'; }, 1500);
});

// Trim the sessionKey textarea inline so users see it normalize as they paste.
form.sessionKey.addEventListener('input', () => {
  form.sessionKey.value = form.sessionKey.value.trim();
});
