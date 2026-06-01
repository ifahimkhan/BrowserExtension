# Prompt 1 — Architecture & Manifest Setup
## SubTranslate Chrome Extension

> Read CLAUDE.md first for full project context before writing any code.

---

## Context Snapshot
- Greenfield Chrome Extension, Manifest V3 only
- Vanilla JS — no npm, no TypeScript, no bundler
- Permissions needed: `tabCapture`, `offscreen`, `storage`, `activeTab`, `scripting`
- `host_permissions`: `https://openrouter.ai/*`
- MV3 requires offscreen document for MediaRecorder (service workers can't use it)
- Content script injected at `document_idle` on `<all_urls>`
- No backend server — extension talks directly to OpenRouter

---

## Your Task

### Step 1 — Create full folder structure
Create every file listed in CLAUDE.md's file structure. All files can be empty stubs
except `manifest.json`. Create placeholder 1×1 transparent PNG icons for dev.

```
subtranslate/
├── manifest.json
├── background.js
├── content.js
├── content.css
├── offscreen/
│   ├── offscreen.html
│   └── offscreen.js
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Step 2 — Write manifest.json (complete, not a stub)
```json
{
  "manifest_version": 3,
  "name": "SubTranslate — Real-Time Subtitles",
  "version": "1.0.0",
  "description": "Real-time AI subtitle translation for any video. Free via OpenRouter.",
  "permissions": ["tabCapture", "offscreen", "storage", "activeTab", "scripting"],
  "host_permissions": ["https://openrouter.ai/*"],
  "background": { "service_worker": "background.js" },
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
  },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "css": ["content.css"],
    "run_at": "document_idle"
  }],
  "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" },
  "web_accessible_resources": [{ "resources": ["content.css"], "matches": ["<all_urls>"] }]
}
```

### Step 3 — Stub background.js
```javascript
// SubTranslate — background.js (Service Worker)
// Responsibilities: tabCapture orchestration, offscreen document management,
//                  OpenRouter API calls, badge management, state tracking

let isCapturing = false;
let activeCaptureTabId = null;
let requestsToday = 0;

// TODO: chrome.runtime.onMessage listener (START_CAPTURE, STOP_CAPTURE, GET_STATE, AUDIO_CHUNK)
// TODO: startCapture(tabId) — creates offscreen doc, gets stream ID, sends START_RECORDING
// TODO: stopCapture() — sends STOP_RECORDING, closes offscreen doc, clears state
// TODO: translateChunk(base64) — calls OpenRouter, sends SUBTITLE_TEXT to content.js
// TODO: getApiKey() — reads openrouter_api_key from chrome.storage.local
// TODO: updateRequestCounter() — increments + persists requests_today, resets daily

console.log('[SubTranslate] Background service worker started');
```

### Step 4 — Stub offscreen.html
```html
<!DOCTYPE html>
<html><head><title>SubTranslate Offscreen</title></head>
<body><script src="offscreen.js"></script></body>
</html>
```

### Step 5 — Stub offscreen.js
```javascript
// SubTranslate — offscreen.js
// Responsibilities: MediaRecorder setup, audio chunking, base64 conversion
// Communicates with background.js via chrome.runtime.sendMessage

let mediaRecorder = null;
let stream = null;

// TODO: chrome.runtime.onMessage listener (START_RECORDING → setup MediaRecorder)
// TODO: chrome.runtime.onMessage listener (STOP_RECORDING → stop recorder + tracks)
// TODO: blobToBase64(blob) helper → returns Promise<string>
// TODO: ondataavailable → skip if blob.size < 1000, else send AUDIO_CHUNK

console.log('[SubTranslate] Offscreen document loaded');
```

### Step 6 — Stub content.js
```javascript
// SubTranslate — content.js
// Responsibilities: Shadow DOM subtitle overlay, message listener
// NEVER makes API calls — only renders what background.js sends

// TODO: createSubtitleOverlay() — Shadow DOM container over active video
// TODO: showSubtitle(text) — render text, auto-hide after duration
// TODO: hideSubtitle() — fade out overlay
// TODO: getActiveVideo() — find largest playing <video> on page
// TODO: chrome.runtime.onMessage → handle SUBTITLE_TEXT, SUBTITLE_ERROR, SUBTITLE_HIDE

console.log('[SubTranslate] Content script loaded');
```

### Step 7 — Stub popup files
- `popup.html`: skeleton HTML with head/body, link to popup.css, script tag for popup.js
- `popup.js`: empty with `// TODO` comments for API key save, start/stop, settings
- `popup.css`: empty

### Step 8 — Verify
Confirm folder structure matches CLAUDE.md exactly. List all created files.

---

## Output Files to Create
- `manifest.json` — complete and valid
- `background.js` — stub with TODOs
- `content.js` — stub with TODOs
- `content.css` — empty
- `offscreen/offscreen.html` — minimal HTML
- `offscreen/offscreen.js` — stub with TODOs
- `popup/popup.html` — skeleton
- `popup/popup.js` — stub
- `popup/popup.css` — empty
- `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png` — 1×1 placeholder PNGs

## Constraints
- Do NOT write implementation logic yet — stubs and TODOs only (except manifest.json)
- Do NOT add any npm dependencies or bundler config
- Do NOT use TypeScript

## Success Criteria
- Extension loads in chrome://extensions → Load unpacked with zero errors
- Popup opens without errors (blank is fine)
- No manifest validation warnings

Show only created/modified files.
