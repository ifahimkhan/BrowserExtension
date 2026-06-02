# SubTranslate — Real-Time AI Subtitle Translator

A Chrome Extension (Manifest V3) that captures tab audio, transcribes and translates it to English with an AI model, and overlays live subtitles directly on any playing video — YouTube, Vimeo, Netflix, and beyond.

**Free.** Uses the Google Gemini API free tier. You supply your own free Google AI Studio key(s).

---

## How It Works

1. The popup starts capture on the active tab.
2. The background service worker gets a media stream ID via `chrome.tabCapture.getMediaStreamId()`.
3. An **offscreen document** captures the tab audio (service workers can't), keeps it audible, and segments speech on **silence (VAD)** — not a fixed timer — so each clip holds whole words/phrases. Each segment is encoded to 16 kHz mono WAV + base64.
4. The background worker queues each clip and calls the Google Gemini API — transcription **and** translation in one shot.
5. Returned English text is pushed to the content script, which renders it in a Shadow DOM overlay on the video.

```
Tab audio → Offscreen (VAD segmenter, WAV/base64) → Background (queue → Gemini) → Content (subtitle overlay)
```

---

## Features

- Real-time English subtitles over any HTML5 video
- Single-call pipeline (transcribe + translate together)
- **Silence-based segmentation (VAD)** — cuts at speech pauses, not mid-word, for cleaner transcription
- **Multi-key rotation** — paste several free Gemini keys; round-robin per request multiplies the rate ceiling
- **Parallel, order-preserving queue** — concurrent calls (scales with key count), results emitted in order
- Shadow DOM overlay — never leaks styles into the host page; self-healing (rebuilds on demand, viewport fallback)
- Configurable model via storage (`model_id`) — swap without editing code
- Settings: font size, subtitle position (top/bottom), enable/disable

---

## Tech Stack

| Piece | Detail |
|-------|--------|
| Extension | Chrome MV3 |
| Language | Vanilla JavaScript — no frameworks, no npm, no bundler |
| Audio | `chrome.tabCapture.getMediaStreamId()` → `AudioContext` + VAD in offscreen doc |
| AI model | `gemini-flash-latest` (alias, hot-swaps to current flash) via Google Gemini API |
| Endpoint | `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent` |
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

1. Create a free key at <https://aistudio.google.com/apikey> (any prefix — `AIza…` or newer `AQ…`).
2. Open the SubTranslate popup, paste your key — **one per line** to add more for higher limits.
3. Click **Save**.

> More keys = higher throughput. Keys from different Google accounts have independent quotas.

---

## Usage

1. Open a tab with a playing video.
2. Click the SubTranslate icon → **Start**.
3. A `✅ SubTranslate active` probe appears, then subtitles as speech plays.
4. Click **Stop** to end capture.

---

## File Structure

```
subtranslate/
├── manifest.json
├── background.js          # Service worker: capture orchestration, multi-key queue, Gemini calls
├── content.js             # Shadow DOM subtitle overlay (self-healing)
├── content.css            # Empty (styles live in Shadow DOM)
├── offscreen/
│   ├── offscreen.html
│   └── offscreen.js       # tabCapture + VAD segmentation + WAV encode + base64
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

See [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) for architecture detail and the optimization roadmap, and [HOW_TO_RUN.md](HOW_TO_RUN.md) for step-by-step run + troubleshooting.

---

## Architecture Notes

- MV3 service workers **cannot** use `MediaRecorder`/`AudioContext` — the offscreen document is mandatory.
- Tab capture mutes the tab; the offscreen doc re-routes the stream to `AudioContext.destination` to keep audio audible.
- Content script **only** renders subtitles; it never calls the API.
- Background worker is the **only** caller of the Gemini API.
- No hardcoded keys in source. Model ID is configurable; endpoint is fixed to Google's API.
- No `eval()` or remote scripts (CSP-safe).

---

## Tuning

| Where | Knob | Effect |
|-------|------|--------|
| `offscreen/offscreen.js` | `SILENCE_HANG_MS` | Trailing silence that ends a segment (lower = less delay) |
| `offscreen/offscreen.js` | `MAX_SEGMENT_MS` | Force-cut length; bounds latency / call rate |
| `offscreen/offscreen.js` | `SILENCE_RMS` | Speech vs silence threshold |
| `background.js` | `MAX_CONCURRENCY` | Ceiling on parallel Gemini calls |
| `background.js` | `MAX_QUEUE` | Backlog cap before dropping oldest clips |

---

## Privacy

Audio segments are sent to the Google Gemini API for transcription/translation only. Your API key(s) are stored locally in `chrome.storage.local` and never leave your browser except as the Gemini request key.

---

## License

MIT
