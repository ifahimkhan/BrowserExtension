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
    'gemini_api_key', 'font_size', 'subtitle_position',
    'chunk_interval_ms', 'requests_today'
  ]);

  const hasKey = stored.gemini_api_key && stored.gemini_api_key.trim() !== '';
  if (hasKey) {
    document.getElementById('apiKeyInput').placeholder = '••••••••';
    document.getElementById('noKeyWarning').style.display = 'none';
    document.getElementById('toggleBtn').disabled = false;
    showKeyStatus('Key saved ✓', 'success');
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
  const { gemini_api_key } = await chrome.storage.local.get('gemini_api_key');
  const hasKey = gemini_api_key && gemini_api_key.trim() !== '';

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
  const key = document.getElementById('apiKeyInput').value.trim();
  if (!key.startsWith('AIza') || key.length < 20) {
    showKeyStatus('Invalid key — Google AI Studio key starts with AIza', 'error');
    return;
  }
  await chrome.storage.local.set({ gemini_api_key: key });
  document.getElementById('apiKeyInput').value = '';
  document.getElementById('apiKeyInput').placeholder = '••••••••';
  document.getElementById('noKeyWarning').style.display = 'none';
  document.getElementById('toggleBtn').disabled = false;
  showKeyStatus('✓ Key saved securely', 'success');
  await refreshState();
});

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
