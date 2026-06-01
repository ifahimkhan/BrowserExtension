# Prompt 6 — Polish, Edge Cases & Test Plan
## SubTranslate Chrome Extension

> Read CLAUDE.md first for full project context before writing any code.

---

## Context Snapshot
- All core features complete: audio capture, Gemini free translation, subtitle overlay, popup
- This prompt: hardens edge cases, improves UX details, creates test plan
- No new features — only reliability improvements and QA
- Free tier is 200 requests/day — user should always know where they stand

---

## Your Task

### Step 1 — Rate limit warning in popup (background → popup live update)
When `requestsToday` reaches 180+ (90% of daily limit):
- In `background.js`: after `updateRequestCounter()`, if `requestsToday >= 180`:
  ```javascript
  if (activeCaptureTabId) {
    chrome.tabs.sendMessage(activeCaptureTabId, {
      type: 'SUBTITLE_TEXT',
      text: `⚠️ ${requestsToday}/200 free requests used today`
    }).catch(() => {});
  }
  ```
- At exactly 200: stop capture automatically + show subtitle "Daily free limit reached (200/200). Resets tomorrow."

### Step 2 — Handle Gemini model returning non-subtitle text
Sometimes free models return conversational preamble like "Here is the transcription: ...".
Add a `cleanSubtitleText(text)` function in background.js:
```javascript
function cleanSubtitleText(text) {
  // Strip common preamble patterns
  text = text.replace(/^(here is|here's|the transcription[:\s]+|translation[:\s]+)/i, '').trim();
  // If result is longer than 300 chars it's probably an error — truncate
  if (text.length > 300) text = text.substring(0, 297) + '...';
  // Remove markdown bold/italic artifacts
  text = text.replace(/\*+/g, '').trim();
  return text;
}
```
Call this on the returned `text` before sending `SUBTITLE_TEXT`.

### Step 3 — Popup: live request counter refresh
The counter in popup should stay fresh while popup is open.
In popup.js, add a polling interval:
```javascript
// Poll state every 5s while popup is open to update request counter
const pollInterval = setInterval(async () => {
  const { requests_today } = await chrome.storage.local.get('requests_today');
  document.getElementById('requestCounter').textContent =
    `${requests_today || 0} / 200 requests today`;
}, 5000);

window.addEventListener('unload', () => clearInterval(pollInterval));
```

### Step 4 — Multiple video handling improvement
On single-page-app sites (YouTube), the video element can change when navigating to a
new video. In content.js, add detection:
```javascript
// Watch for the active video's `src` to change (SPA navigation)
let currentVideoSrc = '';
setInterval(() => {
  const video = getActiveVideo();
  if (video && video.src !== currentVideoSrc) {
    currentVideoSrc = video.src;
    // Re-create overlay for new video
    if (shadowHost) shadowHost.remove();
    createSubtitleOverlay(video, currentPrefs);
  }
}, 2000);
```

### Step 5 — Memory cleanup in content.js
Ensure all observers and timers are cleaned up on page unload (verify this is in content.js):
```javascript
window.addEventListener('beforeunload', () => {
  clearTimeout(hideTimer);
  if (resizeObserver) resizeObserver.disconnect();
  if (shadowHost) { shadowHost.remove(); shadowHost = null; }
});
```

### Step 6 — Error recovery in background.js
If offscreen document crashes unexpectedly (rare but possible in MV3):
```javascript
chrome.runtime.onMessage.addListener((message) => {
  // Detect if offscreen died (no more AUDIO_CHUNK messages after 15s of capturing)
  if (message.type === 'AUDIO_CHUNK') {
    clearTimeout(offscreenWatchdog);
    offscreenWatchdog = setTimeout(() => {
      if (isCapturing) {
        console.warn('[SubTranslate] No audio chunks for 15s — restarting offscreen');
        stopCapture().then(() => {
          if (activeCaptureTabId) startCapture(activeCaptureTabId);
        });
      }
    }, 15000);
  }
});
let offscreenWatchdog = null;
```

### Step 7 — Create TEST_PLAN.md
Create a complete manual test checklist file:

```markdown
# SubTranslate — Manual Test Plan

## 1. Installation
- [ ] Load extension via chrome://extensions → Load unpacked → no errors
- [ ] Extension icon appears in toolbar

## 2. API Key Flow
- [ ] Open popup → warning banner visible, Start button disabled
- [ ] Enter key NOT starting with sk-or- → "Invalid key" error shown, not saved
- [ ] Enter key shorter than 20 chars → error shown
- [ ] Enter valid sk-or- key → "Key saved" confirmation, banner hides, Start enables
- [ ] Close and reopen popup → key still saved (shown as ●●●●●●●● placeholder)

## 3. Core Subtitle Flow — YouTube
- [ ] Open any Japanese YouTube video, let it play
- [ ] Click Start → badge shows green "ON"
- [ ] Within ~8 seconds → English subtitles appear on the video
- [ ] Subtitles auto-hide between speech pauses
- [ ] Click Stop → badge clears, subtitles hide, no errors in console

## 4. Multilingual Support
- [ ] Hindi YouTube video → English subtitles appear
- [ ] German YouTube video → English subtitles appear
- [ ] English video → English passthrough (same text returned)
- [ ] Silent video / music only → no subtitle flicker (silence guard working)

## 5. Multi-Site
- [ ] Works on Vimeo
- [ ] Works on Twitter/X video
- [ ] Works on a local HTML page with <video src="...">

## 6. Fullscreen
- [ ] YouTube: press F to fullscreen → subtitles still visible on top of video
- [ ] Exit fullscreen → subtitles still correctly positioned

## 7. Edge Cases
- [ ] Reload tab while capturing → capture stops cleanly, no console errors
- [ ] Close tab while capturing → no zombie processes or errors
- [ ] Navigate to new YouTube video (SPA) → overlay re-attaches to new video within 2s
- [ ] Delete API key mid-capture → subtitle error shown, capture auto-stops

## 8. Request Counter
- [ ] Start subtitle session → counter increments every ~4 seconds
- [ ] Counter shown in popup updates while popup is open (within 5s refresh)
- [ ] At 180+ requests → warning subtitle shown in video overlay
- [ ] At 200 requests → capture auto-stops, "Daily limit reached" subtitle shown

## 9. Settings
- [ ] Font size slider → subtitle text size changes live (next subtitle after change)
- [ ] Position: Top → subtitles appear at top 8% of video
- [ ] Chunk size 2s → faster subtitles (rougher), 6s → slower (more complete sentences)
- [ ] Settings are persisted after popup close/reopen

## 10. Console Hygiene
- [ ] No unhandled promise rejections
- [ ] All logs prefixed with [SubTranslate]
- [ ] No errors in chrome://extensions service worker console during normal use
```

---

## Output Files to Modify/Create
- `background.js` — rate limit auto-stop, cleanSubtitleText, offscreen watchdog
- `content.js` — SPA video change detection, verify cleanup
- `popup.js` — live counter polling
- `TEST_PLAN.md` — new file with full checklist

## Constraints
- Do NOT add new features beyond what's listed
- Do NOT change popup.html or popup.css
- Do NOT modify manifest.json

## Success Criteria
- User hitting 200 requests sees graceful stop with clear message — not a crash
- SPA navigation on YouTube (clicking new video) → overlay moves to new video
- TEST_PLAN.md is complete and runnable top to bottom

Show only changed/created files.
