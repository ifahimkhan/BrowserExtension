# SubTranslate — Chrome Extension
## Real-Time AI Subtitle Translator (Completely Free)

---

## App Summary
Chrome Extension (Manifest V3) that captures tab audio, sends 4-second chunks as base64
to OpenRouter's free Gemini 2.0 Flash model via chat completions, and overlays the
returned English subtitles directly on any playing video (YouTube, Vimeo, Netflix, etc.).
100% free — no paid APIs. Users supply their own OpenRouter API key (free to create).

---

## Tech Stack
- **Extension Type:** Chrome Extension, Manifest V3 (MV3)
- **Language:** Vanilla JavaScript only — no frameworks, no npm, no bundler
- **Audio Capture:** `chrome.tabCapture.getMediaStreamId()` → MediaRecorder in offscreen doc
- **AI Model:** `google/gemini-2.0-flash-exp:free` via OpenRouter chat completions
- **API Endpoint:** `POST https://openrouter.ai/api/v1/chat/completions`
- **Single-call pipeline:** audio base64 → Gemini → English subtitle (transcribe + translate in one shot)
- **Storage:** `chrome.storage.local` for API key and user prefs
- **UI:** Content script injects Shadow DOM subtitle overlay; Popup = controls + settings

---

## Critical Architecture Facts
- MV3 service workers CANNOT use MediaRecorder — offscreen document is MANDATORY
- Offscreen document handles all audio recording and base64 conversion
- Background service worker handles all OpenRouter API calls
- Content script ONLY renders subtitles — never makes API calls
- OpenRouter free tier: 20 requests/minute, 200 requests/day — show counter in popup
- Audio chunks: 4 seconds each. At 200/day limit = ~13 min of video/day on free tier

---

## File Structure
```
subtranslate/
├── manifest.json
├── background.js              # Service worker: orchestrates capture + API calls
├── content.js                 # Injected into pages: Shadow DOM subtitle overlay
├── content.css                # Empty (styles live inside Shadow DOM)
├── offscreen/
│   ├── offscreen.html         # Minimal HTML — loads offscreen.js
│   └── offscreen.js           # MediaRecorder + audio chunking + base64 output
├── popup/
│   ├── popup.html             # API key input, start/stop, request counter, settings
│   ├── popup.js               # Popup logic
│   └── popup.css              # Dark theme popup styles
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## OpenRouter API Call (Single Call — Transcription + Translation)
```javascript
POST https://openrouter.ai/api/v1/chat/completions
Authorization: Bearer <user_openrouter_key>
Content-Type: application/json

{
  "model": "google/gemini-2.0-flash-exp:free",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "input_audio",
          "input_audio": { "data": "<base64_audio>", "format": "webm" }
        },
        {
          "type": "text",
          "text": "Transcribe this audio and translate it to English. Return ONLY the English subtitle text. If there is silence or no speech, return exactly: [silence]"
        }
      ]
    }
  ],
  "max_tokens": 200
}

Response: { choices: [{ message: { content: "English subtitle text" } }] }
```

---

## Message Types (chrome.runtime.sendMessage)
All SCREAMING_SNAKE_CASE strings:
| Message | Direction | Payload |
|---------|-----------|---------|
| `START_CAPTURE` | popup → background | `{ tabId }` |
| `STOP_CAPTURE` | popup → background | none |
| `GET_STATE` | popup → background | none → returns `{ isCapturing, requestsToday }` |
| `AUDIO_CHUNK` | offscreen → background | `{ base64, format: "webm" }` |
| `SUBTITLE_TEXT` | background → content | `{ text }` |
| `SUBTITLE_ERROR` | background → content | `{ reason }` |
| `SUBTITLE_HIDE` | background → content | none |
| `START_RECORDING` | background → offscreen | `{ streamId, chunkIntervalMs }` |
| `STOP_RECORDING` | background → offscreen | none |

---

## Storage Keys (chrome.storage.local)
| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `openrouter_api_key` | string | "" | User's OpenRouter API key |
| `subtitle_enabled` | bool | true | Show/hide subtitles |
| `font_size` | number | 20 | Subtitle font size px |
| `subtitle_position` | string | "bottom" | "bottom" or "top" |
| `chunk_interval_ms` | number | 4000 | Audio chunk size in ms |
| `requests_today` | number | 0 | Daily request counter |
| `requests_reset_date` | string | "" | ISO date string for counter reset |

---

## Naming Conventions
- Files: camelCase JS, kebab-case CSS classes
- CSS classes: `.st-` prefix (SubTranslate) — all inside Shadow DOM
- Message types: SCREAMING_SNAKE_CASE
- Storage keys: snake_case

---

## Do / Don't Rules
- DO use Shadow DOM for subtitle overlay — never inject bare styles into host page
- DO check `openrouter_api_key` from storage before every API call
- DO skip API call if returned base64 chunk is < 1KB (silence guard)
- DO show request counter in popup (200/day is the free limit)
- DO reset request counter daily based on `requests_reset_date`
- DON'T hardcode any API key, model name, or endpoint URL in source
- DON'T use eval() or remote scripts (CSP violation)
- DON'T make API calls from content.js — only background.js calls OpenRouter
- DON'T use FormData/multipart — OpenRouter STT uses JSON + base64
- DON'T block the service worker — all ops must be async/non-blocking
- DON'T use manifest_version 2

---

## Silence Detection (skip API call entirely)
Check BEFORE calling OpenRouter — saves free quota:
- Chunk blob size < 1000 bytes → skip (pure silence/noise)
- Returned text === "[silence]" or "" → don't send SUBTITLE_TEXT

---

## Domain Ownership
| Domain | Owner Files |
|--------|-------------|
| Architecture | manifest.json, folder structure |
| Audio Pipeline | offscreen/offscreen.js, offscreen/offscreen.html |
| OpenRouter Integration | background.js |
| Subtitle UI | content.js, content.css |
| Settings UI | popup/popup.html, popup/popup.js, popup/popup.css |
| Polish + QA | background.js (tab events, badge), TEST_PLAN.md |
