# Prompt 5 — Popup Settings UI
## SubTranslate Chrome Extension

> Read CLAUDE.md first for full project context before writing any code.

---

## Context Snapshot
- Popup files: popup/popup.html, popup/popup.js, popup/popup.css
- Storage key for API key: `openrouter_api_key` (not openai key — OpenRouter key)
- OpenRouter keys start with `sk-or-` prefix
- Request counter: `requests_today` from storage — free limit is 200/day
- Popup sends to background: `START_CAPTURE { tabId }`, `STOP_CAPTURE`
- Popup queries background: `GET_STATE` → `{ isCapturing, requestsToday }`
- Settings keys: `font_size` (12–36), `subtitle_position` ("bottom"/"top"), `chunk_interval_ms`
- Popup is 320px wide — keep it compact and clean

---

## Your Task

### Step 1 — popup.html structure
Build a complete, styled HTML file (links popup.css, loads popup.js at bottom of body):

**Section 1 — Header:**
```html
<div class="header">
  <div class="logo">▶ SubTranslate</div>
  <div class="tagline">Real-time AI subtitles · Free</div>
</div>
```

**Section 2 — API Key:**
```html
<div class="section" id="api-key-section">
  <label class="label">OpenRouter API Key <span class="hint">(free at openrouter.ai)</span></label>
  <div class="key-row">
    <input type="password" id="apiKeyInput" placeholder="sk-or-..." autocomplete="off" />
    <button id="saveKeyBtn">Save</button>
  </div>
  <div class="key-status" id="keyStatus"></div>
  <!-- Warning banner shown when key is missing -->
  <div class="warning-banner" id="noKeyWarning">
    ⚠️ Enter your free OpenRouter API key to start
  </div>
</div>
```

**Section 3 — Controls:**
```html
<div class="section">
  <button class="main-btn start" id="toggleBtn" disabled>▶ Start Subtitles</button>
  <div class="status-row">
    <span class="status-dot" id="statusDot"></span>
    <span id="statusText">No API key</span>
  </div>
  <!-- Request counter for free tier awareness -->
  <div class="counter-row">
    <span id="requestCounter">0 / 200 requests today</span>
    <span class="counter-hint">Free daily limit</span>
  </div>
</div>
```

**Section 4 — Settings (collapsible):**
```html
<div class="section">
  <button class="collapse-toggle" id="settingsToggle">⚙ Settings ▾</button>
  <div class="settings-panel" id="settingsPanel">
    <label class="label">Font Size: <span id="fontSizeLabel">20px</span></label>
    <input type="range" id="fontSizeSlider" min="12" max="36" value="20" />

    <label class="label">Subtitle Position</label>
    <div class="radio-row">
      <label><input type="radio" name="position" value="bottom" checked /> Bottom</label>
      <label><input type="radio" name="position" value="top" /> Top</label>
    </div>

    <label class="label">Chunk Size (accuracy vs speed)</label>
    <select id="chunkSelect">
      <option value="2000">2s — faster, rougher</option>
      <option value="4000" selected>4s — balanced (recommended)</option>
      <option value="6000">6s — slower, more accurate</option>
    </select>
  </div>
</div>
```

**Section 5 — Footer:**
```html
<div class="footer">
  Powered by <a href="https://openrouter.ai" target="_blank">OpenRouter</a> · Gemini 2.0 Flash (free)
</div>
```

### Step 2 — popup.js logic

**On load:**
```javascript
document.addEventListener('DOMContentLoaded', async () => {
  await loadStoredPrefs();
  await refreshState();
});
```

**loadStoredPrefs():**
- Load `openrouter_api_key` — if non-empty, mask input (show placeholder "••••••••" don't show key)
  and hide the warning banner, show "Key saved ✓" in keyStatus
- Load `font_size` → set slider value + label
- Load `subtitle_position` → set radio button
- Load `chunk_interval_ms` → set select value
- Load `requests_today` → update counter display

**refreshState():**
- Send `GET_STATE` to background → update toggle button (Start/Stop), statusDot, statusText
- If `isCapturing`: button text "⏹ Stop Subtitles", button class "stop", statusDot green, statusText "Translating..."
- If not capturing: button text "▶ Start Subtitles", button class "start", statusDot grey, statusText "Ready"
- Disable toggle button if no API key saved

**Save API key:**
```javascript
document.getElementById('saveKeyBtn').addEventListener('click', async () => {
  const key = document.getElementById('apiKeyInput').value.trim();
  if (!key.startsWith('sk-or-') || key.length < 20) {
    showKeyStatus('Invalid key — must start with sk-or-', 'error');
    return;
  }
  await chrome.storage.local.set({ openrouter_api_key: key });
  document.getElementById('apiKeyInput').value = '';
  document.getElementById('apiKeyInput').placeholder = '••••••••';
  document.getElementById('noKeyWarning').style.display = 'none';
  document.getElementById('toggleBtn').disabled = false;
  showKeyStatus('✓ Key saved securely', 'success');
});
```

**Toggle Start/Stop:**
```javascript
document.getElementById('toggleBtn').addEventListener('click', async () => {
  const state = await sendMessage({ type: 'GET_STATE' });
  if (state.isCapturing) {
    await sendMessage({ type: 'STOP_CAPTURE' });
  } else {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await sendMessage({ type: 'START_CAPTURE', tabId: tab.id });
  }
  setTimeout(refreshState, 400); // give background time to update
});
```

**Settings — auto-save on change:**
```javascript
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
```

**Settings collapse toggle:**
```javascript
document.getElementById('settingsToggle').addEventListener('click', () => {
  const panel = document.getElementById('settingsPanel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
});
```

**Helper: sendMessage()**
```javascript
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
```

### Step 3 — popup.css
Dark theme, 320px width, clean layout:
- Background: `#0f0f1a`, text: `#e2e8f0`
- Accent: `#6366f1` (indigo) for header, links, slider thumb
- `.main-btn.start`: `background: #22c55e` (green), full width, 48px height, bold, rounded
- `.main-btn.stop`: `background: #ef4444` (red), same sizing
- `.main-btn:disabled`: `background: #374151`, cursor not-allowed
- `.warning-banner`: `background: #7c2d12`, `color: #fca5a5`, rounded, padding 8px, margin top 8px
- `.key-status.success`: `color: #4ade80`; `.key-status.error`: `color: #f87171`
- `.status-dot`: 10px circle, green (`#22c55e`) when active, `#6b7280` when idle
- `.counter-row`: small text, `#9ca3af`, flex space-between
- `.settings-panel`: hidden by default (start collapsed), `display: none`
- Input, select: dark background `#1e1e2e`, border `#374151`, full width
- `.footer`: centered, small, `#4b5563`, padding-top 8px, border-top

---

## Output Files to Modify
- `popup/popup.html` — complete
- `popup/popup.js` — complete
- `popup/popup.css` — complete

## Constraints
- Do NOT use `<form>` tags — use button onClick / addEventListener only
- Do NOT display the raw API key — always use type="password" and clear after save
- Do NOT make OpenRouter API calls from popup — only background.js does that

## Success Criteria
- Fresh install → warning banner visible, toggle button disabled
- User enters valid `sk-or-` key → saves, banner hides, toggle enables
- Start button → badge on extension icon turns green "ON"
- Request counter shows live `requests_today` value from storage
- Settings collapsed by default, expand on click, auto-save on change

Show only changed/created files.
