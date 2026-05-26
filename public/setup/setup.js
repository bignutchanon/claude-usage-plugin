// Setup wizard client. Validates input, POSTs to /api/setup/save, redirects
// to the dashboard on success.

const form = document.getElementById('setupForm');
const btn = document.getElementById('saveBtn');
const status = document.getElementById('status');

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
