// SubTranslate — popup.js
// Responsibilities: popup controls + settings UI
// NEVER calls OpenRouter — only background.js does that.

document.addEventListener('DOMContentLoaded', async () => {
  await loadStoredPrefs();
  await refreshState();
});

// --- Load persisted prefs into the UI ---
async function loadStoredPrefs() {
  const stored = await chrome.storage.local.get([
    'gemini_api_keys', 'gemini_api_key', 'font_size', 'subtitle_position',
    'chunk_interval_ms', 'requests_today'
  ]);

  const keys = getStoredKeys(stored);
  const hasKey = keys.length > 0;
  if (hasKey) {
    document.getElementById('apiKeyInput').placeholder =
      `${keys.length} key${keys.length > 1 ? 's' : ''} saved ••••••••`;
    document.getElementById('noKeyWarning').style.display = 'none';
    document.getElementById('toggleBtn').disabled = false;
    showKeyStatus(`${keys.length} key${keys.length > 1 ? 's' : ''} saved ✓`, 'success');
  } else {
    document.getElementById('noKeyWarning').style.display = 'block';
    document.getElementById('toggleBtn').disabled = true;
  }

  const fontSize = stored.font_size || 20;
  document.getElementById('fontSizeSlider').value = fontSize;
  document.getElementById('fontSizeLabel').textContent = fontSize + 'px';

  const position = stored.subtitle_position || 'bottom';
  const radio = document.querySelector(`input[name="position"][value="${position}"]`);
  if (radio) radio.checked = true;

  const chunk = stored.chunk_interval_ms || 4000;
  document.getElementById('chunkSelect').value = String(chunk);

  updateCounter(stored.requests_today || 0);
}

// --- Reflect capture state from background ---
async function refreshState() {
  const state = await sendMessage({ type: 'GET_STATE' });
  if (!state) return;

  const btn = document.getElementById('toggleBtn');
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  const stored = await chrome.storage.local.get(['gemini_api_keys', 'gemini_api_key']);
  const hasKey = getStoredKeys(stored).length > 0;

  if (state.isCapturing) {
    btn.textContent = '⏹ Stop Subtitles';
    btn.className = 'main-btn stop';
    dot.classList.add('active');
    text.textContent = 'Translating...';
  } else {
    btn.textContent = '▶ Start Subtitles';
    btn.className = 'main-btn start';
    dot.classList.remove('active');
    text.textContent = hasKey ? 'Ready' : 'No API key';
  }

  btn.disabled = !hasKey;
  updateCounter(state.requestsToday || 0);
}

function updateCounter(count) {
  document.getElementById('requestCounter').textContent = `${count} / 1500 requests today`;
}

// --- Save API key ---
document.getElementById('saveKeyBtn').addEventListener('click', async () => {
  const raw = document.getElementById('apiKeyInput').value;
  const keys = raw.split(/[\s,]+/).map(k => k.trim()).filter(Boolean);

  if (keys.length === 0) {
    showKeyStatus('Enter at least one key', 'error');
    return;
  }
  // Google AI Studio keys vary in prefix (AIza…, AQ…). Validate length only.
  const bad = keys.find(k => k.length < 20);
  if (bad) {
    showKeyStatus('Key looks too short — paste the full Google AI Studio key', 'error');
    return;
  }

  // Store as array; clear the legacy single-key field to avoid stale fallbacks.
  await chrome.storage.local.set({ gemini_api_keys: keys, gemini_api_key: '' });
  document.getElementById('apiKeyInput').value = '';
  document.getElementById('apiKeyInput').placeholder =
    `${keys.length} key${keys.length > 1 ? 's' : ''} saved ••••••••`;
  document.getElementById('noKeyWarning').style.display = 'none';
  document.getElementById('toggleBtn').disabled = false;
  showKeyStatus(`✓ ${keys.length} key${keys.length > 1 ? 's' : ''} saved`, 'success');
  await refreshState();
});

// Read keys from storage: prefer the array, fall back to the legacy single key.
function getStoredKeys(stored) {
  let keys = Array.isArray(stored.gemini_api_keys) ? stored.gemini_api_keys : [];
  if (keys.length === 0 && stored.gemini_api_key) keys = [stored.gemini_api_key];
  return keys.map(k => (k || '').trim()).filter(Boolean);
}

// --- Toggle Start/Stop ---
document.getElementById('toggleBtn').addEventListener('click', async () => {
  const state = await sendMessage({ type: 'GET_STATE' });
  if (state && state.isCapturing) {
    await sendMessage({ type: 'STOP_CAPTURE' });
  } else {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await sendMessage({ type: 'START_CAPTURE', tabId: tab.id });
  }
  setTimeout(refreshState, 400); // give background time to update
});

// --- Settings: auto-save on change ---
document.getElementById('fontSizeSlider').addEventListener('input', debounce(async (e) => {
  document.getElementById('fontSizeLabel').textContent = e.target.value + 'px';
  await chrome.storage.local.set({ font_size: parseInt(e.target.value) });
}, 300));

document.querySelectorAll('input[name="position"]').forEach(radio => {
  radio.addEventListener('change', async (e) => {
    await chrome.storage.local.set({ subtitle_position: e.target.value });
  });
});

document.getElementById('chunkSelect').addEventListener('change', async (e) => {
  await chrome.storage.local.set({ chunk_interval_ms: parseInt(e.target.value) });
});

// --- Settings collapse toggle ---
document.getElementById('settingsToggle').addEventListener('click', () => {
  const panel = document.getElementById('settingsPanel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
});

// --- Helpers ---
function sendMessage(msg) {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, resolve));
}

function debounce(fn, delay) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

function showKeyStatus(msg, type) {
  const el = document.getElementById('keyStatus');
  el.textContent = msg;
  el.className = 'key-status ' + type;
  setTimeout(() => { el.textContent = ''; el.className = 'key-status'; }, 3000);
}

// Poll state every 5s while popup is open to keep the request counter fresh
const pollInterval = setInterval(async () => {
  const { requests_today } = await chrome.storage.local.get('requests_today');
  document.getElementById('requestCounter').textContent =
    `${requests_today || 0} / 200 requests today`;
}, 5000);

window.addEventListener('unload', () => clearInterval(pollInterval));

console.log('[SubTranslate] Popup loaded');
