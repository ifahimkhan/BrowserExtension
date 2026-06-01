# How to Run SubTranslate

Step-by-step guide to install, configure, and run the SubTranslate Chrome Extension locally.

---

## Prerequisites

- **Google Chrome** (or any Chromium browser: Edge, Brave, Opera) — version 116+ recommended for the offscreen + tabCapture APIs.
- A **free OpenRouter account** — <https://openrouter.ai>.
- The project files on your machine (this folder). No npm, no build step, no dependencies.

---

## Step 1 — Get an OpenRouter API Key

1. Go to <https://openrouter.ai> and sign up (free).
2. Open **Keys** → **Create Key**.
3. Copy the key (starts with `sk-or-...`). You'll paste it into the extension later.

> The extension uses the free model `google/gemini-2.0-flash-exp:free`. No payment or credits required.

---

## Step 2 — Load the Extension (Unpacked)

1. Open Chrome and navigate to `chrome://extensions`.
2. Turn on **Developer mode** (toggle, top-right corner).
3. Click **Load unpacked**.
4. Select this project folder (the one containing `manifest.json`).
5. SubTranslate appears in the list. Confirm there are **no errors** shown on its card.
6. Click the puzzle-piece (Extensions) icon in the toolbar → **pin** SubTranslate for quick access.

If you see an error, click **Errors** on the extension card to read it, then see [Troubleshooting](#troubleshooting).

---

## Step 3 — Add Your API Key

1. Click the SubTranslate icon to open the popup.
2. Paste your OpenRouter API key into the key field.
3. Click **Save**. The key is stored in `chrome.storage.local` (local to your browser only).

---

## Step 4 — Run It on a Video

1. Open a tab with a playing video (YouTube, Vimeo, Netflix, etc.).
2. Start playback.
3. Click the SubTranslate icon → **Start**.
4. Grant the tab-capture permission if prompted.
5. Within ~4–6 seconds, English subtitles overlay on the video.
6. Click **Stop** to end capture.

---

## What Happens Under the Hood

```
[1] Popup "Start"
      │
      ▼
[2] background.js  ── getMediaStreamId() ──▶ creates offscreen document
      │
      ▼
[3] offscreen.js   ── MediaRecorder records 4s WebM chunk ──▶ base64
      │  (AUDIO_CHUNK)
      ▼
[4] background.js  ── POST to OpenRouter (Gemini 2.0 Flash) ──▶ English text
      │  (SUBTITLE_TEXT)
      ▼
[5] content.js     ── renders text in Shadow DOM overlay on the video
```

- Audio chunks under 1 KB are skipped (silence guard) to save quota.
- Returned `[silence]` or empty text is not displayed.

---

## Quota & Limits (Free Tier)

| Limit | Value |
|-------|-------|
| Requests / minute | 20 |
| Requests / day | 200 |
| Approx. video / day | ~13 minutes (4s chunks) |

The popup shows a **daily request counter**. It resets each day automatically. When you hit 200, capture stops returning subtitles until the next day.

---

## Settings (in Popup)

| Setting | Default | Notes |
|---------|---------|-------|
| Subtitles enabled | on | Toggle overlay on/off |
| Font size | 20 px | Subtitle text size |
| Position | bottom | `bottom` or `top` of video |
| Chunk interval | 4000 ms | Audio chunk length |

---

## Updating the Code

After editing any source file:

1. Go to `chrome://extensions`.
2. Click the **reload** (↻) icon on the SubTranslate card.
3. Reopen the popup / reload the video tab to pick up changes.

Content-script changes also require **reloading the video page** itself.

---

## Troubleshooting

| Symptom | Cause / Fix |
|---------|-------------|
| "Service worker registration failed" | Open the extension's **service worker** console (link on the card) and read the error. Usually a syntax error in `background.js`. |
| No subtitles appear | Confirm API key saved; check video is actually producing audio; open the service worker console for OpenRouter errors. |
| `401 Unauthorized` | Bad or missing API key. Re-paste it in the popup. |
| `429 Too Many Requests` | Hit the 20/min or 200/day free limit. Wait and retry. |
| Subtitles lag video | Normal — 4s chunk + network round-trip. Lower `chunk_interval_ms` for faster (but more quota-hungry) updates. |
| Capture won't start | Some pages (e.g. `chrome://`, the Web Store) block capture. Use a normal site. |
| Overlay missing on fullscreen | Exit fullscreen or use the page's own player controls; overlay lives in the page DOM. |

### Where to See Logs

- **Background / API errors:** `chrome://extensions` → SubTranslate → **Inspect views: service worker**.
- **Content / overlay errors:** open DevTools (F12) on the video tab → Console.
- **Popup errors:** right-click the popup → **Inspect**.

---

## Uninstall / Reset

- **Reset settings & key:** remove and re-add the extension, or clear via DevTools: `chrome.storage.local.clear()` in the service worker console.
- **Uninstall:** `chrome://extensions` → SubTranslate → **Remove**.
