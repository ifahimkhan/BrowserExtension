# Prompt 4 — Subtitle Overlay UI (Content Script)
## SubTranslate Chrome Extension

> Read CLAUDE.md first for full project context before writing any code.

---

## Context Snapshot
- content.js is injected at `document_idle` into every page — must be defensive
- Uses Shadow DOM to fully isolate subtitle styles from host page CSS
- All CSS class names prefixed with `.st-` inside the shadow root
- Receives messages: `SUBTITLE_TEXT { text }`, `SUBTITLE_ERROR { reason }`, `SUBTITLE_HIDE`
- NEVER makes API calls — only renders what background.js sends
- Must handle: dynamic video load, fullscreen changes, video resize, page SPA navigation
- Subtitle position from storage: `subtitle_position` ("bottom" | "top"), `font_size` (px)

---

## Your Task

### Step 1 — getActiveVideo()
```javascript
function getActiveVideo() {
  const videos = Array.from(document.querySelectorAll('video'))
    .filter(v => {
      const rect = v.getBoundingClientRect();
      return rect.width > 100 && rect.height > 100; // must be visible
    })
    .sort((a, b) => {
      // Prioritise playing videos, then largest area
      const aPlaying = !a.paused && !a.ended ? 1 : 0;
      const bPlaying = !b.paused && !b.ended ? 1 : 0;
      if (bPlaying !== aPlaying) return bPlaying - aPlaying;
      const aArea = a.getBoundingClientRect().width * a.getBoundingClientRect().height;
      const bArea = b.getBoundingClientRect().width * b.getBoundingClientRect().height;
      return bArea - aArea;
    });
  return videos[0] || null;
}
```

### Step 2 — createSubtitleOverlay(video, prefs)
Create a host `<div>` absolutely positioned over the video, attach Shadow DOM,
inject styles, and add the subtitle element inside:

```javascript
let shadowHost = null;
let shadowRoot = null;
let subtitleEl = null;
let hideTimer = null;

function createSubtitleOverlay(video, prefs) {
  // Remove any existing overlay
  if (shadowHost) shadowHost.remove();

  shadowHost = document.createElement('div');
  shadowHost.id = 'subtranslate-host';
  applyHostStyles(shadowHost, video, prefs);

  // Insert host right after the video in the DOM
  video.insertAdjacentElement('afterend', shadowHost);

  shadowRoot = shadowHost.attachShadow({ mode: 'open' });

  // Inject styles into shadow root
  const style = document.createElement('style');
  style.textContent = getSubtitleCSS(prefs);
  shadowRoot.appendChild(style);

  // Subtitle element
  subtitleEl = document.createElement('div');
  subtitleEl.className = 'st-subtitle st-hidden';
  shadowRoot.appendChild(subtitleEl);

  // Keep overlay synced with video position
  attachResizeObserver(video);
}

function applyHostStyles(host, video, prefs) {
  const rect = video.getBoundingClientRect();
  Object.assign(host.style, {
    position: 'fixed',
    top: rect.top + 'px',
    left: rect.left + 'px',
    width: rect.width + 'px',
    height: rect.height + 'px',
    pointerEvents: 'none',
    zIndex: '2147483647',
    overflow: 'hidden'
  });
}
```

### Step 3 — getSubtitleCSS(prefs) — styles inside Shadow DOM
```javascript
function getSubtitleCSS(prefs) {
  const position = prefs?.subtitle_position === 'top' ? 'top: 8%' : 'bottom: 8%';
  const fontSize = (prefs?.font_size || 20) + 'px';
  return `
    .st-subtitle {
      position: absolute;
      ${position};
      left: 10%;
      right: 10%;
      text-align: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: ${fontSize};
      font-weight: 600;
      color: #ffffff;
      text-shadow: 1px 1px 3px #000, -1px -1px 3px #000, 0 0 8px #000;
      background: rgba(0, 0, 0, 0.65);
      border-radius: 6px;
      padding: 6px 16px;
      max-width: 80%;
      margin: 0 auto;
      word-wrap: break-word;
      opacity: 1;
      transition: opacity 0.3s ease;
      pointer-events: none;
      line-height: 1.4;
    }
    .st-hidden {
      opacity: 0;
    }
  `;
}
```

### Step 4 — showSubtitle(text) and hideSubtitle()
```javascript
function showSubtitle(text) {
  if (!subtitleEl) return;
  clearTimeout(hideTimer);
  subtitleEl.textContent = text;
  subtitleEl.classList.remove('st-hidden');

  // Auto-hide: 3s minimum, longer for longer text
  const duration = Math.max(3000, text.length * 55);
  hideTimer = setTimeout(hideSubtitle, duration);
}

function hideSubtitle() {
  if (!subtitleEl) return;
  subtitleEl.classList.add('st-hidden');
}
```

### Step 5 — ResizeObserver (keep overlay synced to video)
```javascript
let resizeObserver = null;

function attachResizeObserver(video) {
  if (resizeObserver) resizeObserver.disconnect();
  resizeObserver = new ResizeObserver(() => {
    if (shadowHost) applyHostStyles(shadowHost, video, currentPrefs);
  });
  resizeObserver.observe(video);
  // Also track scroll/resize for fixed positioning
  window.addEventListener('resize', () => applyHostStyles(shadowHost, video, currentPrefs));
  window.addEventListener('scroll', () => applyHostStyles(shadowHost, video, currentPrefs), { passive: true });
}
```

### Step 6 — Fullscreen handling
```javascript
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement) {
    // Move host into fullscreen element so it renders on top
    const fsEl = document.fullscreenElement;
    fsEl.appendChild(shadowHost);
    Object.assign(shadowHost.style, {
      position: 'absolute', top: '0', left: '0',
      width: '100%', height: '100%'
    });
  } else {
    // Move back to normal position after fullscreen
    const video = getActiveVideo();
    if (video && shadowHost) {
      video.insertAdjacentElement('afterend', shadowHost);
      applyHostStyles(shadowHost, video, currentPrefs);
    }
  }
});
```

### Step 7 — Message listener
```javascript
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SUBTITLE_TEXT') {
    showSubtitle(message.text);
  }
  if (message.type === 'SUBTITLE_ERROR') {
    const errorMessages = {
      no_api_key: '⚠️ SubTranslate: Add your OpenRouter API key in the extension popup',
      invalid_key: '⚠️ SubTranslate: Invalid API key — check the extension popup',
      capture_failed: '⚠️ SubTranslate: Could not capture tab audio'
    };
    showSubtitle(errorMessages[message.reason] || '⚠️ SubTranslate error');
  }
  if (message.type === 'SUBTITLE_HIDE') {
    hideSubtitle();
    if (shadowHost) { shadowHost.remove(); shadowHost = null; }
  }
});
```

### Step 8 — Init on script load
```javascript
let currentPrefs = {};

async function initSubtitleOverlay() {
  currentPrefs = await chrome.storage.local.get(['subtitle_position', 'font_size']);
  const video = getActiveVideo();
  if (video) createSubtitleOverlay(video, currentPrefs);

  // Watch for videos added dynamically (SPAs like YouTube)
  const observer = new MutationObserver(() => {
    if (!shadowHost || !document.body.contains(shadowHost)) {
      const v = getActiveVideo();
      if (v) createSubtitleOverlay(v, currentPrefs);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (resizeObserver) resizeObserver.disconnect();
  if (shadowHost) shadowHost.remove();
  clearTimeout(hideTimer);
});

initSubtitleOverlay();
```

---

## Output Files to Modify
- `content.js` — full implementation as described above

## Constraints
- Do NOT make any fetch() or chrome API calls except `chrome.storage.local.get` and `chrome.runtime.onMessage`
- Do NOT inject styles into `document.head` — all CSS must live inside Shadow DOM
- Do NOT use `innerHTML` — use `textContent` for subtitle text (XSS safety)

## Success Criteria
- Subtitle text appears visually centered over the video on YouTube
- Subtitle fades out after the auto-hide timer
- Fullscreen mode (YouTube 'f' key) → subtitles stay visible
- Missing API key → error message shows in the subtitle bar (not an alert)
- Page reload → no orphaned DOM elements

Show only changed/created files.
