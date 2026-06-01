# Prompt 2 — Audio Capture Pipeline
## SubTranslate Chrome Extension

> Read CLAUDE.md first for full project context before writing any code.

---

## Context Snapshot
- MV3 service workers CANNOT use MediaRecorder — offscreen document is mandatory
- Audio flow: chrome.tabCapture → offscreen MediaRecorder → 4s base64 chunks → background.js
- background.js creates the offscreen document, gets the stream ID via tabCapture,
  then passes that stream ID to offscreen.js via message
- offscreen.js runs MediaRecorder, converts chunks to base64, sends AUDIO_CHUNK messages
- Chunk size guard: skip if blob.size < 1000 bytes (silence/noise — saves API quota)
- Message types used here: START_RECORDING, STOP_RECORDING, AUDIO_CHUNK (see CLAUDE.md)

---

## Your Task

### Step 1 — background.js: offscreen document helper
Add these functions to background.js:

```javascript
const OFFSCREEN_URL = chrome.runtime.getURL('offscreen/offscreen.html');

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
```

### Step 2 — background.js: startCapture(tabId)
```javascript
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
```

### Step 3 — background.js: stopCapture()
```javascript
async function stopCapture() {
  if (!isCapturing) return;
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
```

### Step 4 — background.js: message listener (capture messages only)
Add `chrome.runtime.onMessage.addListener` handling:
- `START_CAPTURE` → call `startCapture(message.tabId)`
- `STOP_CAPTURE` → call `stopCapture()`
- `GET_STATE` → return `{ isCapturing, requestsToday }` using `sendResponse`
- `AUDIO_CHUNK` → placeholder `console.log('[SubTranslate] Chunk received:', message.base64.length, 'chars')` (OpenRouter call added in Prompt 3)

Remember: to use `sendResponse` asynchronously, return `true` from the listener.

### Step 5 — background.js: tab lifecycle listeners
```javascript
// Auto-stop if user reloads/closes the captured tab
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
```

### Step 6 — offscreen.js: MediaRecorder implementation
```javascript
let mediaRecorder = null;
let stream = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'START_RECORDING') {
    startRecording(message.streamId, message.chunkIntervalMs);
  }
  if (message.type === 'STOP_RECORDING') {
    stopRecording();
  }
});

async function startRecording(streamId, chunkIntervalMs) {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    mediaRecorder = new MediaRecorder(stream, { mimeType });

    mediaRecorder.ondataavailable = async (event) => {
      if (!event.data || event.data.size < 1000) return; // silence guard
      const base64 = await blobToBase64(event.data);
      chrome.runtime.sendMessage({ type: 'AUDIO_CHUNK', base64, format: 'webm' });
    };

    mediaRecorder.start(chunkIntervalMs);
    console.log('[SubTranslate] MediaRecorder started, chunk interval:', chunkIntervalMs, 'ms');
  } catch (err) {
    console.error('[SubTranslate] MediaRecorder failed:', err);
    chrome.runtime.sendMessage({ type: 'AUDIO_CHUNK', error: err.message });
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
  }
  mediaRecorder = null;
  stream = null;
  console.log('[SubTranslate] MediaRecorder stopped');
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // reader.result is "data:audio/webm;base64,XXXXXX" — strip the prefix
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
```

---

## Output Files to Modify
- `background.js` — ensureOffscreenDocument, startCapture, stopCapture, message listener, tab lifecycle
- `offscreen/offscreen.js` — full MediaRecorder implementation

## Constraints
- Do NOT implement OpenRouter API calls here — only emit AUDIO_CHUNK, handle in Prompt 3
- Do NOT touch popup or content.js files
- Do NOT add any libraries

## Success Criteria
- Play a Japanese YouTube video → click extension icon → console shows `[SubTranslate] Chunk received: XXXX chars` every 4 seconds
- Stop button (or tab reload) → no zombie streams, no errors in console

Show only changed/created files.
