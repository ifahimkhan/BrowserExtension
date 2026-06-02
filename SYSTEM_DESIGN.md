# SubTranslate — System Design

Real-time AI subtitle translator as a Chrome MV3 extension. Captures tab audio, segments it on silence, sends each speech clip to the Google Gemini API for combined transcription + translation, and overlays English subtitles on the video.

---

## 1. High-Level Architecture

```
┌─────────────┐   START_CAPTURE    ┌──────────────────┐
│   Popup     │ ─────────────────▶ │  Background SW   │
│ (controls)  │ ◀───────────────── │ (orchestrator)   │
└─────────────┘     GET_STATE       └───────┬──────────┘
                                            │ creates / drives
                          START_RECORDING   ▼
                                    ┌──────────────────┐
                                    │ Offscreen Document│
                                    │ tabCapture stream │
                                    │ + VAD segmenter   │
                                    └───────┬──────────┘
                                            │ AUDIO_CHUNK (wav base64)
                                            ▼
                                    ┌──────────────────┐   HTTPS    ┌────────────────┐
                                    │  Background SW   │ ─────────▶ │  Gemini API    │
                                    │  translation queue│ ◀───────── │ generateContent│
                                    └───────┬──────────┘   English  └────────────────┘
                                            │ SUBTITLE_TEXT
                                            ▼
                                    ┌──────────────────┐
                                    │  Content Script  │
                                    │ Shadow DOM overlay│
                                    └──────────────────┘
```

### Why each component exists

| Component | Responsibility | Why it must be separate |
|-----------|----------------|-------------------------|
| **Popup** | API key entry, Start/Stop, settings, request counter | UI surface; no capture/API logic |
| **Background service worker** | Capture orchestration, offscreen lifecycle, **translation queue**, Gemini calls, badge/state | The only context allowed to call `tabCapture.getMediaStreamId` and make API calls |
| **Offscreen document** | `getUserMedia(tab)` + keep audio audible + **VAD segmentation** + WAV encode | MV3 service workers **cannot** use `MediaRecorder`/`AudioContext`/`getUserMedia` — an offscreen DOM is mandatory |
| **Content script** | Shadow DOM subtitle overlay only | Renders in the page; never calls the API |

---

## 2. Data Flow (one subtitle)

1. User clicks **Start** → popup sends `START_CAPTURE {tabId}`.
2. Background ensures an offscreen doc exists, calls `tabCapture.getMediaStreamId({targetTabId})`, sends `START_RECORDING {streamId}`.
3. Offscreen `getUserMedia` opens the tab stream, connects it to `AudioContext.destination` (keeps audio **audible** — capture otherwise mutes the tab), and taps raw PCM via a `ScriptProcessor`.
4. **VAD** accumulates PCM frames; when trailing silence ≥ `SILENCE_HANG_MS` (or `MAX_SEGMENT_MS` reached), it flushes one speech segment.
5. Segment → mono → averaging-decimate to 16 kHz → 16-bit WAV → base64 → `AUDIO_CHUNK`.
6. Background **enqueues** the clip (bounded, ordered queue) and drains it one call at a time to Gemini `generateContent` with `temperature: 0`.
7. Response text → cleaned → `SUBTITLE_TEXT {text}` → content script renders it in the Shadow DOM, auto-hiding after a duration scaled to text length.

---

## 3. Key Design Decisions & History

These were learned the hard way during development:

| Decision | Reason |
|----------|--------|
| **Offscreen document for audio** | Service workers have no `MediaRecorder`/`AudioContext` |
| **Re-route stream to `AudioContext.destination`** | `chromeMediaSource: 'tab'` steals audio from the tab; without re-routing the user hears nothing |
| **Silence-based segmentation (VAD)** instead of fixed 4 s chunks | Fixed timers cut words mid-syllable → garbled transcription. VAD cuts at natural pauses → whole phrases |
| **Re-encode to WAV** | Gemini/OpenRouter `inlineData` accept `wav`/`mp3`, **not** `webm`. Also, timesliced `MediaRecorder` chunks after the first lack headers and aren't standalone-decodable |
| **Ordered translation queue** | A single-flight guard silently dropped every segment that arrived during an in-flight call → missing sentences. The queue preserves order and never drops mid-call |
| **Bounded queue (drop oldest)** | If speech outpaces the API, keep the *freshest* clips so subtitles stay near real-time instead of drifting minutes behind |
| **`gemini-flash-latest` alias** | Dated model IDs get retired (the original `google/gemini-2.0-flash-exp:free` and `gemini-2.0-flash` both 404'd). The `-latest` alias hot-swaps |
| **Model ID in storage** | Swap models without editing code |

---

## 4. Current Tuning Parameters

**Offscreen VAD** (`offscreen/offscreen.js`):

| Constant | Value | Effect |
|----------|-------|--------|
| `TARGET_SAMPLE_RATE` | 16000 | Output WAV rate; smaller payload |
| `SILENCE_RMS` | 0.008 | Energy threshold for speech vs silence |
| `SILENCE_HANG_MS` | 400 | Trailing silence that ends a segment (↓ = less delay) |
| `MIN_SEGMENT_MS` | 600 | Ignore blips shorter than this |
| `MAX_SEGMENT_MS` | 6000 | Force a cut to bound latency |
| `PREROLL_MS` | 300 | Audio kept before speech starts (avoids clipping first word) |

**Background queue** (`background.js`):

| Constant | Value | Effect |
|----------|-------|--------|
| `MAX_QUEUE` | 4 | Backlog cap; drops oldest when exceeded |
| `MAX_CONCURRENCY` | 2 | Parallel Gemini calls (reorder buffer keeps output in order) |
| `DAILY_LIMIT` | 1500 | Gemini free-tier requests/day |

---

## 5. Bottlenecks

1. **API latency** — each clip is a full HTTP round-trip to Gemini (~0.5–2 s). This is the dominant delay.
2. **Free-tier rate limit** — Gemini free is ~15 requests/min (≈1 per 4 s). Dense dialogue produces segments faster than this → 429 → forced drops.
3. **Serial processing** — the queue drains one call at a time to preserve order; throughput is capped at 1 / round-trip.
4. **VAD trailing-silence wait** — a subtitle can't appear until the speaker pauses (or `MAX_SEGMENT_MS`), adding `SILENCE_HANG_MS` of inherent latency.
5. **Model is general-purpose** — `gemini-flash-latest` is not a dedicated speech model; accuracy on noisy/accented audio is bounded.

---

## 6. Optimization Roadmap

Ordered roughly by impact-to-effort. None of these are implemented yet.

### A. Throughput — bounded parallelism with reordering ✅ IMPLEMENTED
Each clip is tagged with a monotonic `seq`. Up to `MAX_CONCURRENCY` (=2) Gemini calls run at once; completed results are held in a reorder buffer (`results` map) and emitted only in `seq` order, so subtitles never appear out of sequence. Dropped/overflowed clips resolve as empty so the buffer never stalls.

### B. Rate-limit headroom — multi-key rotation ✅ IMPLEMENTED
The user can paste **several free Gemini keys** (one per line in the popup). Keys load into `apiKeys[]` at capture start and round-robin per request (`nextApiKey`). N keys ≈ N× the requests/min ceiling. A single rejected/429 key no longer kills the session — rotation continues on the others; only an all-keys-bad case stops capture.

### C. Latency — adaptive segmentation
- **Emit partials:** at `MAX_SEGMENT_MS`, send the clip but *keep recording*; mark it partial so the overlay updates in place rather than waiting for the pause.
- **Adaptive `SILENCE_RMS`:** track a rolling noise floor and set the threshold relative to it, so quiet dialogue and loud scenes both segment correctly without manual tuning.

### D. Quota / cost — skip redundant work
- **Energy pre-gate (already partial):** never enqueue clips that are pure silence (VAD handles most of this).
- **Hash-dedupe:** hash each WAV; if two consecutive clips are near-identical (looping music, repeated jingle), skip the second.
- **Content-hash cache:** cache `hash → text` for short repeated clips (intros, ads).

### E. Accuracy — context & prompt
- **Carry the previous subtitle** into the prompt as context (“previous line: …”) so the model keeps names/terms consistent across segments.
- **Source-language hint:** add a popup setting; pin the language in the prompt to stop the model second-guessing.
- **Two-pass option:** dedicated STT (e.g., a Whisper endpoint) → then translate, for users who want max accuracy over “free + single call”.

### F. Audio quality
- Replace `ScriptProcessor` (deprecated) with an **AudioWorklet** for lower-overhead, glitch-free PCM tapping off the main thread.
- Proper polyphase resampling via `OfflineAudioContext` instead of averaging decimation (marginal gain; only if accuracy plateaus).

### G. Robustness & UX
- **Reorder buffer** ensures subtitles never appear out of sequence once parallelism (A) lands.
- **Backpressure indicator** in the popup (queue depth, 429 count) so users see when they're rate-limited.
- **Per-site video-element heuristics** for tricky players (iframes, Netflix) in the content script.

### Recommended next step
**B (multi-key rotation)** + **A (concurrency 2 with reorder)** together attack the two biggest user-visible issues — missing sentences from rate limits and end-to-end delay — without leaving the free tier.

---

## 7. Storage Schema

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `gemini_api_keys` | string[] | [] | Google AI Studio keys (`AIza…`), rotated per request |
| `gemini_api_key` | string | "" | Legacy single key — fallback only if the array is empty |
| `model_id` | string | `gemini-flash-latest` | Override model without code change |
| `subtitle_enabled` | bool | true | |
| `font_size` | number | 20 | px |
| `subtitle_position` | string | "bottom" | "bottom" / "top" |
| `chunk_interval_ms` | number | 4000 | Legacy (VAD now drives segmentation) |
| `requests_today` | number | 0 | Daily counter |
| `requests_reset_date` | string | "" | ISO date for counter reset |

---

## 8. Message Contract

| Message | Direction | Payload |
|---------|-----------|---------|
| `START_CAPTURE` | popup → bg | `{ tabId }` |
| `STOP_CAPTURE` | popup → bg | — |
| `GET_STATE` | popup → bg | → `{ isCapturing, requestsToday }` |
| `START_RECORDING` | bg → offscreen | `{ streamId }` |
| `STOP_RECORDING` | bg → offscreen | — |
| `AUDIO_CHUNK` | offscreen → bg | `{ base64, format: "wav" }` or `{ error }` |
| `SUBTITLE_TEXT` | bg → content | `{ text }` |
| `SUBTITLE_ERROR` | bg → content | `{ reason, detail? }` |
| `SUBTITLE_HIDE` | bg → content | — |
