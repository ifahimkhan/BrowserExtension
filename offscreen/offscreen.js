// SubTranslate — offscreen.js
// Responsibilities: MediaRecorder setup, audio chunking, base64 conversion
// Communicates with background.js via chrome.runtime.sendMessage

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

console.log('[SubTranslate] Offscreen document loaded');
