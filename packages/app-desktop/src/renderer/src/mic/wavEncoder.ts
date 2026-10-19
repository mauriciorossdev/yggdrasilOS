/**
 * whisper.cpp (local and cloud alike) expects 16kHz mono 16-bit PCM WAV
 * input. MediaRecorder only produces compressed formats (webm/opus), so this
 * decodes the recorded blob back to raw samples via Web Audio, resamples to
 * 16kHz mono through an OfflineAudioContext, and hand-writes a minimal WAV
 * container — no audio-encoding dependency needed for that.
 */
const TARGET_SAMPLE_RATE = 16_000;

export async function blobToWav(blob: Blob): Promise<ArrayBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  const decodeCtx = new AudioContext();
  const decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  await decodeCtx.close();

  const frameCount = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
  const offlineCtx = new OfflineAudioContext(1, frameCount, TARGET_SAMPLE_RATE);
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start(0);
  const rendered = await offlineCtx.startRendering();

  return encodeWavPcm16(rendered.getChannelData(0), TARGET_SAMPLE_RATE);
}

function encodeWavPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample; // mono
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  return buffer;
}
