# SubTranslate — Real-Time AI Subtitle Translator

A Chrome Extension (Manifest V3) that captures tab audio, transcribes and translates it to English with an AI model, and overlays live subtitles directly on any playing video — YouTube, Vimeo, Netflix, and beyond.

**100% free.** No paid APIs. You supply your own free OpenRouter API key.

---

## How It Works

1. The popup starts capture on the active tab.
2. The background service worker gets a media stream ID via `chrome.tabCapture.getMediaStreamId()`.
3. An **offscreen document** runs `MediaRecorder` (service workers can't), splitting audio into 4-second WebM chunks and converting each to base64.
4. Each chunk goes to the background worker, which sends a single call to OpenRouter's free Gemini 2.0 Flash model — transcription **and** translation in one shot.
5. The returned English text is pushed to the content script, which renders it in a Shadow DOM overlay on the video.

```
Tab audio → Offscreen (MediaRecorder, base64) → Background (OpenRouter) → Content (subtitle overlay)
```

---

## Features

- Real-time English subtitles over any HTML5 video
- Single-call pipeline (transcribe + translate together) — low latency, low quota use
- Shadow DOM overlay — never leaks styles into the host page
- Silence guard — chunks under 1 KB skip the API call to save quota
- Daily request counter shown in popup (free tier: **20 req/min, 200 req/day** ≈ 13 min of video/day)
- Settings: font size, subtitle position (top/bottom), enable/disable, chunk interval

---

## Tech Stack

| Piece | Detail |
|-------|--------|
| Extension | Chrome MV3 |
| Language | Vanilla JavaScript — no frameworks, no npm, no bundler |
| Audio | `chrome.tabCapture.getMediaStreamId()` → `MediaRecorder` in offscreen doc |
| AI model | `google/gemini-2.0-flash-exp:free` via OpenRouter |
| Endpoint | `POST https://openrouter.ai/api/v1/chat/completions` |
| Storage | `chrome.storage.local` |

---

## Install (Load Unpacked)

1. Clone or download this repo.
2. Open `chrome://extensions`.
3. Toggle **Developer mode** (top right).
4. Click **Load unpacked** and select the project folder.
5. Pin the SubTranslate icon.

---

## Setup

1. Create a free OpenRouter account at <https://openrouter.ai>.
2. Generate an API key.
3. Open the SubTranslate popup, paste the key, and save.

---

## Usage

1. Open a tab with a playing video.
2. Click the SubTranslate icon → **Start**.
3. Subtitles appear over the video within a few seconds.
4. Click **Stop** to end capture.

Watch the request counter in the popup — the free tier caps at 200 requests/day.

---

## File Structure

```
subtranslate/
├── manifest.json
├── background.js          # Service worker: capture orchestration + OpenRouter calls
├── content.js             # Shadow DOM subtitle overlay
├── content.css            # Empty (styles live in Shadow DOM)
├── offscreen/
│   ├── offscreen.html
│   └── offscreen.js       # MediaRecorder + chunking + base64
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Architecture Notes

- MV3 service workers **cannot** use `MediaRecorder` — the offscreen document is mandatory.
- Content script **only** renders subtitles; it never calls the API.
- Background worker is the **only** caller of OpenRouter.
- No hardcoded keys, model names, or endpoint URLs in source.
- No `eval()` or remote scripts (CSP-safe).

---

## Privacy

Audio chunks are sent to OpenRouter for transcription/translation only. Your API key is stored locally in `chrome.storage.local` and never leaves your browser except as the OpenRouter auth header.

---

## License

MIT
