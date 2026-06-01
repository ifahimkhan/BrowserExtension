// SubTranslate — background.js (Service Worker)
// Responsibilities: tabCapture orchestration, offscreen document management,
//                  OpenRouter API calls, badge management, state tracking

let isCapturing = false;
let activeCaptureTabId = null;
let requestsToday = 0;
let isTranslating = false; // concurrency guard — skip new chunk while a call is in flight
let offscreenWatchdog = null; // restarts offscreen if audio chunks stop arriving

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
  audioQueue = [];
  console.log('[SubTranslate] Capture stopped');
}

// --- Google Gemini API integration ---
async function getApiKey() {
  const { gemini_api_key } = await chrome.storage.local.get('gemini_api_key');
  if (!gemini_api_key || gemini_api_key.trim() === '') {
    throw new Error('NO_API_KEY');
  }
  return gemini_api_key.trim();
}

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

async function translateChunk(base64, format = 'wav') {
  const apiKey = await getApiKey();

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

  await updateRequestCounter();
  checkDailyLimit();

  return text;
}

// --- Translation queue: ordered, bounded, no dropped segments mid-call ---
let audioQueue = [];
const MAX_QUEUE = 4; // cap backlog so subtitles stay near real-time

function enqueueChunk(base64, format) {
  audioQueue.push({ base64, format });
  // If we're falling behind, drop the OLDEST pending clips (keep freshest speech).
  while (audioQueue.length > MAX_QUEUE) audioQueue.shift();
  processQueue();
}

async function processQueue() {
  if (isTranslating) return;
  const item = audioQueue.shift();
  if (!item) return;

  isTranslating = true;
  try {
    const text = await translateChunk(item.base64, item.format);
    if (text && text !== '[silence]' && text.trim() !== '' && activeCaptureTabId) {
      const cleaned = cleanSubtitleText(text);
      if (cleaned) {
        chrome.tabs.sendMessage(activeCaptureTabId, { type: 'SUBTITLE_TEXT', text: cleaned }).catch(() => {});
      }
    }
  } catch (err) {
    handleTranslateError(err);
  } finally {
    isTranslating = false;
    if (audioQueue.length) processQueue(); // keep draining
  }
}

function handleTranslateError(err) {
  console.error('[SubTranslate] translateChunk error:', err);
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
    chrome.tabs.sendMessage(activeCaptureTabId, { type: 'SUBTITLE_ERROR', reason: 'invalid_key' }).catch(() => {});
    stopCapture();
  } else if (status === 429) {
    // Rate limited — pause briefly, drop stale backlog, then resume.
    console.warn('[SubTranslate] Rate limited by Gemini — backing off 5s');
    audioQueue = [];
    setTimeout(() => processQueue(), 5000);
  } else if (status === 413) {
    console.warn('[SubTranslate] Chunk too large — skipping');
  } else {
    console.error('[SubTranslate] Unhandled API error status:', status, err.detail);
    chrome.tabs.sendMessage(activeCaptureTabId, { type: 'SUBTITLE_ERROR', reason: 'api_error' }).catch(() => {});
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
