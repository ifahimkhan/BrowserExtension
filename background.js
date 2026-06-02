// SubTranslate — background.js (Service Worker)
// Responsibilities: tabCapture orchestration, offscreen document management,
//                  Gemini API calls, translation queue, badge management, state

let isCapturing = false;
let activeCaptureTabId = null;
let requestsToday = 0;
let offscreenWatchdog = null; // restarts offscreen if audio chunks stop arriving

// --- Multi-key rotation: N free keys ≈ N× the requests/min ceiling ---
let apiKeys = [];   // loaded at startCapture
let keyIndex = 0;
function nextApiKey() {
  if (apiKeys.length === 0) throw new Error('NO_API_KEY');
  const key = apiKeys[keyIndex % apiKeys.length];
  keyIndex++;
  return key;
}
async function loadApiKeys() {
  const { gemini_api_keys, gemini_api_key } = await chrome.storage.local.get(['gemini_api_keys', 'gemini_api_key']);
  let keys = Array.isArray(gemini_api_keys) ? gemini_api_keys : [];
  if (keys.length === 0 && gemini_api_key) keys = [gemini_api_key]; // legacy single-key fallback
  apiKeys = keys.map(k => (k || '').trim()).filter(Boolean);
  keyIndex = 0;
}

const OFFSCREEN_URL = chrome.runtime.getURL('offscreen/offscreen.html');

// Restore today's request count on service worker startup
chrome.storage.local.get(['requests_today', 'requests_reset_date']).then(stored => {
  const today = new Date().toISOString().split('T')[0];
  if (stored.requests_reset_date === today) {
    requestsToday = stored.requests_today || 0;
  }
});

// --- Offscreen document lifecycle ---
async function ensureOffscreenDocument() {
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['USER_MEDIA'],
      justification: 'Recording tab audio for real-time subtitle translation'
    });
  }
}

async function closeOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) {
    await chrome.offscreen.closeDocument();
  }
}

// --- Capture control ---
async function startCapture(tabId) {
  if (isCapturing) return;
  try {
    // tabCapture only works on real web pages — reject chrome://, the Web Store, etc.
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || '';
    const capturable = /^https?:\/\//i.test(url) || /^file:\/\//i.test(url);
    const blocked = /^https:\/\/chrome\.google\.com\/webstore/i.test(url)
      || /^https:\/\/chromewebstore\.google\.com/i.test(url);
    if (!capturable || blocked) {
      console.error('[SubTranslate] Tab not capturable:', url);
      chrome.tabs.sendMessage(tabId, { type: 'SUBTITLE_ERROR', reason: 'restricted_page' }).catch(() => {});
      return;
    }

    // Load all API keys for this session (enables rotation across the rate limit).
    await loadApiKeys();
    if (apiKeys.length === 0) {
      chrome.tabs.sendMessage(tabId, { type: 'SUBTITLE_ERROR', reason: 'no_api_key' }).catch(() => {});
      return;
    }
    resetQueue();

    await ensureOffscreenDocument();

    // Get a stream ID the offscreen doc can use with getUserMedia.
    // NOTE: requires the user to have invoked the extension on THIS active tab (activeTab grant).
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

    // Read chunk interval from storage
    const { chunk_interval_ms = 4000 } = await chrome.storage.local.get('chunk_interval_ms');

    // Tell offscreen doc to start recording
    await chrome.runtime.sendMessage({
      type: 'START_RECORDING',
      streamId,
      chunkIntervalMs: chunk_interval_ms
    });

    isCapturing = true;
    activeCaptureTabId = tabId;

    // Update badge
    chrome.action.setBadgeText({ text: 'ON', tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e', tabId });

    console.log('[SubTranslate] Capture started for tab', tabId);

    // Probe: confirms the content script + overlay are alive. If you DON'T see this
    // on the video, the content script isn't loaded — reload the video tab.
    chrome.tabs.sendMessage(tabId, {
      type: 'SUBTITLE_TEXT',
      text: '✅ SubTranslate active — listening for speech…'
    }).catch(() => {
      console.warn('[SubTranslate] Content script not reachable — the tab needs a reload');
    });
  } catch (err) {
    const msg = (err && err.message) || String(err);
    console.error('[SubTranslate] startCapture failed:', msg, err);
    const reason = /active stream|already being captured/i.test(msg)
      ? 'tab_busy'
      : 'capture_failed';
    // Pass the raw Chrome error to the overlay so the exact cause is visible on screen.
    chrome.tabs.sendMessage(tabId, { type: 'SUBTITLE_ERROR', reason, detail: msg }).catch(() => {});
  }
}

async function stopCapture() {
  if (!isCapturing) return;
  clearTimeout(offscreenWatchdog);
  try {
    await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
  } catch (_) { /* offscreen may already be gone */ }
  await closeOffscreenDocument();

  if (activeCaptureTabId) {
    chrome.action.setBadgeText({ text: '', tabId: activeCaptureTabId });
    chrome.tabs.sendMessage(activeCaptureTabId, { type: 'SUBTITLE_HIDE' }).catch(() => {});
  }

  isCapturing = false;
  activeCaptureTabId = null;
  resetQueue();
  console.log('[SubTranslate] Capture stopped');
}

// --- Google Gemini API integration ---
function cleanSubtitleText(text) {
  // Strip common preamble patterns
  text = text.replace(/^(here is|here's|the transcription[:\s]+|translation[:\s]+)/i, '').trim();
  // If result is longer than 300 chars it's probably an error — truncate
  if (text.length > 300) text = text.substring(0, 297) + '...';
  // Remove markdown bold/italic artifacts
  text = text.replace(/\*+/g, '').trim();
  return text;
}

// Warn / auto-stop as the free daily quota is approached
const DAILY_LIMIT = 1500; // Google Gemini free-tier requests/day (gemini-2.0-flash)

function checkDailyLimit() {
  if (!activeCaptureTabId) return;
  if (requestsToday >= DAILY_LIMIT) {
    chrome.tabs.sendMessage(activeCaptureTabId, {
      type: 'SUBTITLE_TEXT',
      text: `Daily free limit reached (${DAILY_LIMIT}/${DAILY_LIMIT}). Resets tomorrow.`
    }).catch(() => {});
    stopCapture();
  } else if (requestsToday >= DAILY_LIMIT - 20) {
    chrome.tabs.sendMessage(activeCaptureTabId, {
      type: 'SUBTITLE_TEXT',
      text: `⚠️ ${requestsToday}/${DAILY_LIMIT} free requests used today`
    }).catch(() => {});
  }
}

async function updateRequestCounter() {
  const today = new Date().toISOString().split('T')[0]; // "2025-06-01"
  const stored = await chrome.storage.local.get(['requests_today', 'requests_reset_date']);

  let count = stored.requests_today || 0;
  const resetDate = stored.requests_reset_date || '';

  if (resetDate !== today) {
    // New day — reset counter
    count = 0;
  }

  count += 1;
  requestsToday = count;

  await chrome.storage.local.set({
    requests_today: count,
    requests_reset_date: today
  });

  return count;
}

async function translateChunk(base64, format, apiKey) {
  // Model is configurable via storage so it can be swapped without code edits.
  // Default: "latest" flash alias — hot-swaps to the current model, avoids 404s
  // when a dated model (e.g. gemini-2.0-flash) is retired. Accepts inline audio.
  const { model_id = 'gemini-flash-latest' } =
    await chrome.storage.local.get('model_id');

  const mimeType = `audio/${format || 'wav'}`;
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${model_id}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inlineData: { mimeType, data: base64 } },
            { text: 'You are a subtitle engine. Transcribe the speech in this audio clip and translate it into natural, concise English. Output ONLY the final English subtitle line — no quotes, no speaker labels, no notes, no romanization. Do NOT guess or invent words that are not clearly spoken. If there is no clear, intelligible speech, output exactly: [silence]' }
          ]
        }
      ],
      generationConfig: { maxOutputTokens: 200, temperature: 0 }
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    console.error('[SubTranslate] Gemini error', response.status, err);
    throw Object.assign(new Error('API_ERROR'), { status: response.status, detail: err });
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  if (!text) console.warn('[SubTranslate] Parsed empty text. Raw response:', JSON.stringify(data));
  else console.log('[SubTranslate] Parsed text:', text);

  await updateRequestCounter();
  checkDailyLimit();

  return text;
}

// --- Translation queue: bounded, parallel, order-preserving ---
// Each clip gets a sequence number. Up to MAX_CONCURRENCY calls run at once
// (each on a rotated key); results are buffered and emitted in seq order so
// subtitles never appear out of sequence.
const MAX_QUEUE = 4;        // backlog cap — drop oldest to stay real-time
const MAX_CONCURRENCY = 3;  // hard ceiling on parallel Gemini calls

let audioQueue = [];        // [{ seq, base64, format }]
let inFlight = 0;
let seqCounter = 0;         // next seq to assign
let nextEmit = 0;          // next seq to render
let results = new Map();    // seq -> { text: string|null }  (null = nothing to show / dropped)
let cooldownUntil = 0;      // pause sending until this timestamp (set on 429)

// One key → serial (avoids self-inflicted 429). More keys → more parallelism.
function concurrencyLimit() {
  return Math.min(MAX_CONCURRENCY, Math.max(1, apiKeys.length));
}

function resetQueue() {
  audioQueue = [];
  inFlight = 0;
  seqCounter = 0;
  nextEmit = 0;
  results = new Map();
  cooldownUntil = 0;
}

function enqueueChunk(base64, format) {
  const seq = seqCounter++;
  audioQueue.push({ seq, base64, format });
  // Falling behind: drop the OLDEST pending clips, but record them as resolved-empty
  // so the reorder buffer doesn't stall waiting on a seq that never completes.
  while (audioQueue.length > MAX_QUEUE) {
    const dropped = audioQueue.shift();
    resolveSeq(dropped.seq, null);
  }
  pump();
}

function pump() {
  // Respect a rate-limit cooldown before sending again.
  const now = Date.now();
  if (now < cooldownUntil) {
    setTimeout(pump, cooldownUntil - now);
    return;
  }
  while (inFlight < concurrencyLimit() && audioQueue.length > 0) {
    const item = audioQueue.shift();
    inFlight++;
    processItem(item);
  }
}

async function processItem(item) {
  let apiKey;
  try {
    apiKey = nextApiKey();
  } catch (_) {
    handleTranslateError(new Error('NO_API_KEY'));
    inFlight--;
    resolveSeq(item.seq, null);
    return;
  }

  try {
    const text = await translateChunk(item.base64, item.format, apiKey);
    const usable = text && text !== '[silence]' && text.trim() !== '';
    resolveSeq(item.seq, usable ? (cleanSubtitleText(text) || null) : null);
  } catch (err) {
    handleTranslateError(err);
    resolveSeq(item.seq, null);
  } finally {
    inFlight--;
    pump();
  }
}

// Record a result and flush any contiguous, completed seqs in order.
function resolveSeq(seq, text) {
  results.set(seq, { text });
  while (results.has(nextEmit)) {
    const { text: t } = results.get(nextEmit);
    results.delete(nextEmit);
    if (t && activeCaptureTabId) {
      console.log('[SubTranslate] Emitting subtitle →', t);
      chrome.tabs.sendMessage(activeCaptureTabId, { type: 'SUBTITLE_TEXT', text: t })
        .catch(e => console.warn('[SubTranslate] send to content failed:', e?.message));
    }
    nextEmit++;
  }
}

function handleTranslateError(err) {
  console.error('[SubTranslate] translateChunk error:', err && err.message);
  if (!activeCaptureTabId) return;

  if (err.message === 'NO_API_KEY') {
    chrome.tabs.sendMessage(activeCaptureTabId, { type: 'SUBTITLE_ERROR', reason: 'no_api_key' }).catch(() => {});
    stopCapture();
    return;
  }

  const status = err.status;
  const detailMsg = err.detail?.error?.message || '';
  const keyInvalid = status === 401 || status === 403
    || (status === 400 && /api key not valid|invalid.*key/i.test(detailMsg));

  if (keyInvalid) {
    // Surface the exact key error on screen so the cause is unambiguous.
    chrome.tabs.sendMessage(activeCaptureTabId, { type: 'SUBTITLE_ERROR', reason: 'invalid_key', detail: detailMsg }).catch(() => {});
    if (apiKeys.length <= 1) stopCapture();
  } else if (status === 429) {
    const backoff = apiKeys.length > 1 ? 1500 : 4000;
    cooldownUntil = Date.now() + backoff;
    console.warn(`[SubTranslate] 429 — cooling down ${backoff}ms`);
    chrome.tabs.sendMessage(activeCaptureTabId, { type: 'SUBTITLE_TEXT', text: '⏳ Rate limited — waiting…' }).catch(() => {});
  } else if (status === 413) {
    console.warn('[SubTranslate] Chunk too large — skipping');
  } else {
    console.error('[SubTranslate] Unhandled API error status:', status, err.detail);
    chrome.tabs.sendMessage(activeCaptureTabId, { type: 'SUBTITLE_ERROR', reason: 'api_error', detail: detailMsg || ('HTTP ' + status) }).catch(() => {});
  }
}

// --- Message listener ---
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'START_CAPTURE':
      startCapture(message.tabId);
      break;

    case 'STOP_CAPTURE':
      stopCapture();
      break;

    case 'GET_STATE':
      sendResponse({ isCapturing, requestsToday });
      return true; // async response

    case 'AUDIO_CHUNK': {
      if (message.error) {
        console.error('[SubTranslate] Audio chunk error:', message.error);
        break;
      }
      if (!activeCaptureTabId) break;

      // Watchdog: with silence-based segmentation, long gaps are NORMAL (quiet
      // scenes, music). Only restart after a very long dry spell that implies a
      // genuinely stalled recorder, not just silence.
      clearTimeout(offscreenWatchdog);
      offscreenWatchdog = setTimeout(() => {
        if (isCapturing) {
          console.warn('[SubTranslate] No audio chunks for 120s — restarting offscreen');
          const tabId = activeCaptureTabId;
          stopCapture().then(() => { if (tabId) startCapture(tabId); });
        }
      }, 120000);

      // Queue the clip — never drop mid-flight; the queue preserves order.
      enqueueChunk(message.base64, message.format);

      break; // don't block the listener
    }
  }
});

// --- Tab lifecycle: auto-stop on reload/close of captured tab ---
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === activeCaptureTabId && changeInfo.status === 'loading') {
    stopCapture();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeCaptureTabId) {
    stopCapture();
  }
});

console.log('[SubTranslate] Background service worker started');
