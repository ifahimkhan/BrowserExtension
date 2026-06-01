// SubTranslate — offscreen.js
// Captures tab audio, keeps it audible, and segments speech on SILENCE (VAD)
// rather than a fixed timer — so each clip holds whole words/sentences. Each
// segment is encoded to 16 kHz mono WAV, base64'd, and sent to background.js.

const TARGET_SAMPLE_RATE = 16000; // Gemini-friendly, small payload
const FRAME_SIZE = 4096;          // ~85 ms per frame at 48 kHz

// VAD tuning — adjust if segments cut too early/late.
const SILENCE_RMS = 0.008;        // below this = silence
const SILENCE_HANG_MS = 400;      // trailing silence that ends a segment (lower = less delay)
const MIN_SEGMENT_MS = 600;       // ignore blips shorter than this
const MAX_SEGMENT_MS = 6000;      // force a cut so latency stays bounded
const PREROLL_MS = 300;           // audio kept before speech starts (avoid clipping first word)

let captureStream = null;
let audioContext = null;
let processor = null;
let sourceNode = null;

// segment state
let inSpeech = false;
let segment = [];        // Float32Array frames of current speech
let segmentMs = 0;
let silenceMs = 0;
let preroll = [];        // rolling buffer of recent frames (for pre-roll)
let prerollMs = 0;
let sampleRate = 48000;

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'START_RECORDING') startRecording(message.streamId);
  if (message.type === 'STOP_RECORDING') stopRecording();
});

async function startRecording(streamId) {
  try {
    captureStream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      video: false
    });

    audioContext = new AudioContext();
    sampleRate = audioContext.sampleRate;

    sourceNode = audioContext.createMediaStreamSource(captureStream);
    // Keep the tab audible (tab capture otherwise mutes it).
    sourceNode.connect(audioContext.destination);

    // Tap raw PCM for VAD. ScriptProcessor is deprecated but reliable in offscreen.
    processor = audioContext.createScriptProcessor(FRAME_SIZE, 1, 1);
    processor.onaudioprocess = onAudio;
    sourceNode.connect(processor);
    processor.connect(audioContext.destination); // needed to keep the node running

    resetSegment();
    console.log('[SubTranslate] VAD capture started @', sampleRate, 'Hz');
  } catch (err) {
    console.error('[SubTranslate] startRecording failed:', err);
    chrome.runtime.sendMessage({ type: 'AUDIO_CHUNK', error: err.message });
  }
}

function onAudio(e) {
  const input = e.inputBuffer.getChannelData(0);
  const frame = Float32Array.from(input); // copy — the source buffer is reused
  const frameMs = (frame.length / sampleRate) * 1000;
  const rms = computeRMS(frame);

  // maintain pre-roll ring
  preroll.push(frame);
  prerollMs += frameMs;
  while (prerollMs > PREROLL_MS && preroll.length > 1) {
    prerollMs -= (preroll.shift().length / sampleRate) * 1000;
  }

  if (rms > SILENCE_RMS) {
    if (!inSpeech) {
      inSpeech = true;
      segment = preroll.slice();            // prepend recent pre-roll
      segmentMs = prerollMs;
    } else {
      segment.push(frame);
      segmentMs += frameMs;
    }
    silenceMs = 0;
  } else if (inSpeech) {
    segment.push(frame);
    segmentMs += frameMs;
    silenceMs += frameMs;
    if (silenceMs >= SILENCE_HANG_MS) flushSegment();
  }

  if (inSpeech && segmentMs >= MAX_SEGMENT_MS) flushSegment();
}

function flushSegment() {
  const frames = segment;
  const totalMs = segmentMs;
  resetSegment();

  if (totalMs < MIN_SEGMENT_MS) return;

  const merged = mergeFrames(frames);
  const mono16k = downsample(merged, sampleRate, TARGET_SAMPLE_RATE);
  const wav = encodeWav(mono16k, TARGET_SAMPLE_RATE);
  const base64 = arrayBufferToBase64(wav);
  chrome.runtime.sendMessage({ type: 'AUDIO_CHUNK', base64, format: 'wav' });
}

function resetSegment() {
  inSpeech = false;
  segment = [];
  segmentMs = 0;
  silenceMs = 0;
}

function stopRecording() {
  if (inSpeech) flushSegment();
  if (processor) { processor.disconnect(); processor.onaudioprocess = null; }
  if (sourceNode) sourceNode.disconnect();
  if (captureStream) captureStream.getTracks().forEach(t => t.stop());
  if (audioContext) audioContext.close().catch(() => {});
  processor = null; sourceNode = null; captureStream = null; audioContext = null;
  preroll = []; prerollMs = 0;
  console.log('[SubTranslate] capture stopped');
}

// --- DSP helpers ---
function computeRMS(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

function mergeFrames(frames) {
  let len = 0;
  for (const f of frames) len += f.length;
  const out = new Float32Array(len);
  let offset = 0;
  for (const f of frames) { out.set(f, offset); offset += f.length; }
  return out;
}

// Averaging decimation — mild anti-aliasing, better than nearest-neighbor.
function downsample(samples, srcRate, dstRate) {
  if (srcRate === dstRate) return samples;
  const ratio = srcRate / dstRate;
  const dstLength = Math.floor(samples.length / ratio);
  const out = new Float32Array(dstLength);
  for (let i = 0; i < dstLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

function encodeWav(samples, rate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

console.log('[SubTranslate] Offscreen document loaded');
