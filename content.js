// SubTranslate — content.js
// Responsibilities: Shadow DOM subtitle overlay, message listener
// NEVER makes API calls — only renders what background.js sends

let shadowHost = null;
let shadowRoot = null;
let subtitleEl = null;
let hideTimer = null;
let resizeObserver = null;
let currentPrefs = {};

// --- Find the most relevant video on the page ---
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

// --- Overlay creation ---
function buildShadow(host, prefs) {
  shadowRoot = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = getSubtitleCSS(prefs);
  shadowRoot.appendChild(style);

  subtitleEl = document.createElement('div');
  subtitleEl.className = 'st-subtitle st-hidden';
  shadowRoot.appendChild(subtitleEl);
}

function createSubtitleOverlay(video, prefs) {
  if (shadowHost) shadowHost.remove();

  shadowHost = document.createElement('div');
  shadowHost.id = 'subtranslate-host';
  applyHostStyles(shadowHost, video, prefs);

  // Insert host right after the video in the DOM
  video.insertAdjacentElement('afterend', shadowHost);
  buildShadow(shadowHost, prefs);

  // Keep overlay synced with video position
  attachResizeObserver(video);
}

// Fallback overlay covering the whole viewport when no <video> is detected.
function createViewportOverlay(prefs) {
  if (shadowHost) shadowHost.remove();

  shadowHost = document.createElement('div');
  shadowHost.id = 'subtranslate-host';
  Object.assign(shadowHost.style, {
    position: 'fixed', top: '0', left: '0',
    width: '100vw', height: '100vh',
    pointerEvents: 'none', zIndex: '2147483647', overflow: 'hidden'
  });
  document.body.appendChild(shadowHost);
  buildShadow(shadowHost, prefs);
}

// Guarantee a live overlay exists before rendering text.
function ensureOverlay() {
  if (subtitleEl && shadowHost && document.documentElement.contains(shadowHost)) return true;
  const video = getActiveVideo();
  if (video) createSubtitleOverlay(video, currentPrefs);
  else createViewportOverlay(currentPrefs);
  return !!subtitleEl;
}

function applyHostStyles(host, video, prefs) {
  if (!host || !video) return;
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

// --- Shadow DOM styles ---
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

// --- Show / hide ---
function showSubtitle(text) {
  if (!ensureOverlay() || !subtitleEl) {
    console.warn('[SubTranslate] No overlay target; dropping subtitle:', text);
    return;
  }
  const host = shadowHost?.getBoundingClientRect();
  console.log('[SubTranslate] rendering subtitle; host rect:', host && `${Math.round(host.width)}x${Math.round(host.height)} @${Math.round(host.left)},${Math.round(host.top)}`);
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

// --- Keep overlay synced to video size/position ---
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

// --- Fullscreen handling ---
document.addEventListener('fullscreenchange', () => {
  if (!shadowHost) return;
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

// --- Message listener ---
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SUBTITLE_TEXT') {
    console.log('[SubTranslate] content received SUBTITLE_TEXT:', message.text);
    showSubtitle(message.text);
  }
  if (message.type === 'SUBTITLE_ERROR') {
    const errorMessages = {
      no_api_key: '⚠️ SubTranslate: Add your Google Gemini API key in the extension popup',
      invalid_key: '⚠️ SubTranslate: Invalid API key — check the extension popup',
      capture_failed: '⚠️ SubTranslate: Could not capture tab audio',
      restricted_page: '⚠️ SubTranslate: This page can\'t be captured — open a normal http(s) video page',
      tab_busy: '⚠️ SubTranslate: Tab audio already captured — reload the tab and try again',
      api_error: '⚠️ SubTranslate: Translation API error — see service worker console'
    };
    let text = errorMessages[message.reason] || '⚠️ SubTranslate error';
    if (message.detail) text += ` — [${message.detail}]`;
    showSubtitle(text);
  }
  if (message.type === 'SUBTITLE_HIDE') {
    hideSubtitle();
    if (shadowHost) { shadowHost.remove(); shadowHost = null; }
  }
});

// --- Init ---
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

// Watch for the active video's `src` to change (SPA navigation, e.g. YouTube)
let currentVideoSrc = '';
setInterval(() => {
  const video = getActiveVideo();
  if (video && video.src !== currentVideoSrc) {
    currentVideoSrc = video.src;
    // Re-create overlay for the new video
    if (shadowHost) shadowHost.remove();
    createSubtitleOverlay(video, currentPrefs);
  }
}, 2000);

initSubtitleOverlay();

console.log('[SubTranslate] Content script loaded');
