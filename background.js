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
    await ensureOffscreenDocument();

    // Get a stream ID the offscreen doc can use with getUserMedia
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
    console.error('[SubTranslate] startCapture failed:', err);
    chrome.tabs.sendMessage(tabId, { type: 'SUBTITLE_ERROR', reason: 'capture_failed' });
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
  console.log('[SubTranslate] Capture stopped');
}

// --- OpenRouter integration ---
async function getApiKey() {
  const { openrouter_api_key } = await chrome.storage.local.get('openrouter_api_key');
  if (!openrouter_api_key || openrouter_api_key.trim() === '') {
    throw new Error('NO_API_KEY');
  }
  return openrouter_api_key.trim();
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
function checkDailyLimit() {
  if (!activeCaptureTabId) return;
  if (requestsToday >= 200) {
    chrome.tabs.sendMessage(activeCaptureTabId, {
      type: 'SUBTITLE_TEXT',
      text: 'Daily free limit reached (200/200). Resets tomorrow.'
    }).catch(() => {});
    stopCapture();
  } else if (requestsToday >= 180) {
    chrome.tabs.sendMessage(activeCaptureTabId, {
      type: 'SUBTITLE_TEXT',
      text: `⚠️ ${requestsToday}/200 free requests used today`
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

async function translateChunk(base64, format = 'webm') {
  if (isTranslating) {
    console.log('[SubTranslate] Skipping chunk — previous call still in flight');
    return;
  }

  isTranslating = true;

  try {
    const apiKey = await getApiKey();

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/subtranslate',  // required by OpenRouter
        'X-Title': 'SubTranslate Extension'                  // shown in OpenRouter dashboard
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-exp:free',
        max_tokens: 200,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: { data: base64, format: format }
              },
              {
                type: 'text',
                text: 'Transcribe this audio and translate it to English. Return ONLY the English subtitle text, no explanations. If there is silence or no speech, return exactly: [silence]'
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw Object.assign(new Error('API_ERROR'), { status: response.status, detail: err });
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || '';

    await updateRequestCounter();
    checkDailyLimit();

    return text;

  } finally {
    isTranslating = false;
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

      // Watchdog: if no chunks arrive for 15s while capturing, restart offscreen
      clearTimeout(offscreenWatchdog);
      offscreenWatchdog = setTimeout(() => {
        if (isCapturing) {
          console.warn('[SubTranslate] No audio chunks for 15s — restarting offscreen');
          const tabId = activeCaptureTabId;
          stopCapture().then(() => { if (tabId) startCapture(tabId); });
        }
      }, 15000);

      translateChunk(message.base64, message.format)
        .then(text => {
          if (!text || text === '[silence]' || text.trim() === '') return;
          const cleaned = cleanSubtitleText(text);
          if (!cleaned) return;
          chrome.tabs.sendMessage(activeCaptureTabId, { type: 'SUBTITLE_TEXT', text: cleaned })
            .catch(() => {}); // tab may have closed
        })
        .catch(err => {
          console.error('[SubTranslate] translateChunk error:', err);

          if (err.message === 'NO_API_KEY') {
            chrome.tabs.sendMessage(activeCaptureTabId, {
              type: 'SUBTITLE_ERROR',
              reason: 'no_api_key'
            }).catch(() => {});
            stopCapture(); // stop so user goes back to popup
            return;
          }

          // HTTP error handling
          const status = err.status;
          if (status === 401) {
            chrome.tabs.sendMessage(activeCaptureTabId, { type: 'SUBTITLE_ERROR', reason: 'invalid_key' }).catch(() => {});
            stopCapture();
          } else if (status === 429) {
            console.warn('[SubTranslate] Rate limited by OpenRouter — waiting 10s');
            setTimeout(() => { isTranslating = false; }, 10000);
          } else if (status === 413) {
            console.warn('[SubTranslate] Chunk too large — skipping');
          } else {
            console.error('[SubTranslate] Unhandled API error status:', status);
          }
        });

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
