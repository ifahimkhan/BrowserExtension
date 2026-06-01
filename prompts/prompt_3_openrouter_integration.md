# Prompt 3 — OpenRouter API Integration (Free Gemini Model)
## SubTranslate Chrome Extension

> Read CLAUDE.md first for full project context before writing any code.

---

## Context Snapshot
- Model: `google/gemini-2.0-flash-exp:free` — completely free, no cost per call
- Endpoint: `POST https://openrouter.ai/api/v1/chat/completions`
- Request format: JSON body with base64 audio inside `input_audio` content block
- ONE call does BOTH transcription + translation to English (no second call needed)
- API key: user's OpenRouter key stored at `openrouter_api_key` in chrome.storage.local
- Rate limit: 200 requests/day free — track in storage key `requests_today`
- Response: `data.choices[0].message.content` → English subtitle string
- Silence signal: if model returns "[silence]" or empty string → skip, don't show subtitle
- Concurrency guard: skip new chunk if previous API call is still in flight

---

## Your Task

### Step 1 — getApiKey() helper
```javascript
async function getApiKey() {
  const { openrouter_api_key } = await chrome.storage.local.get('openrouter_api_key');
  if (!openrouter_api_key || openrouter_api_key.trim() === '') {
    throw new Error('NO_API_KEY');
  }
  return openrouter_api_key.trim();
}
```

### Step 2 — updateRequestCounter() helper
```javascript
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
```

### Step 3 — translateChunk(base64, format) — the core function
```javascript
let isTranslating = false; // concurrency guard

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

    return text;

  } finally {
    isTranslating = false;
  }
}
```

### Step 4 — Wire AUDIO_CHUNK handler in message listener
Replace the placeholder `console.log` from Prompt 2's AUDIO_CHUNK handler with:

```javascript
if (message.type === 'AUDIO_CHUNK') {
  if (!activeCaptureTabId) return;

  translateChunk(message.base64, message.format)
    .then(text => {
      if (!text || text === '[silence]' || text.trim() === '') return;
      chrome.tabs.sendMessage(activeCaptureTabId, { type: 'SUBTITLE_TEXT', text })
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

  return; // don't block the listener
}
```

### Step 5 — Update GET_STATE to include requestsToday
In the `GET_STATE` message handler, make sure it returns:
```javascript
sendResponse({ isCapturing, requestsToday });
```
Load `requestsToday` from storage on service worker startup:
```javascript
// At top of background.js, after variable declarations:
chrome.storage.local.get(['requests_today', 'requests_reset_date']).then(stored => {
  const today = new Date().toISOString().split('T')[0];
  if (stored.requests_reset_date === today) {
    requestsToday = stored.requests_today || 0;
  }
});
```

---

## Output Files to Modify
- `background.js` only — add getApiKey, updateRequestCounter, translateChunk, wire AUDIO_CHUNK handler, update GET_STATE

## Constraints
- Do NOT use FormData or multipart — request body is JSON with base64
- Do NOT hardcode the API key, model name, or endpoint URL as constants
- Do NOT call OpenRouter from offscreen.js or content.js — only background.js
- Do NOT remove the `isTranslating` concurrency guard

## Success Criteria
- Playing a Japanese video → English subtitles appear in console logs within 8 seconds
- Missing API key → capture auto-stops, SUBTITLE_ERROR sent to content script
- `requestsToday` increments correctly in chrome.storage.local
- Rate limit 429 → waits 10s then resumes instead of crashing

Show only changed/created files.
