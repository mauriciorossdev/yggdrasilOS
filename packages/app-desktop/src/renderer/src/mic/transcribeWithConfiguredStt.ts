/** Transcribes a 16 kHz mono WAV with whichever STT the user picked in Settings → STT. */
export async function transcribeWithConfiguredStt(wav: ArrayBuffer): Promise<string> {
  const [whisperSettings, sttSettings] = await Promise.all([
    window.yggdrasil.whisper.getSettings(),
    window.yggdrasil.stt.getSettings(),
  ]);
  if (sttSettings.source === "cloud") {
    return window.yggdrasil.stt.transcribeCloud(wav, sttSettings.cloud);
  }
  if (!whisperSettings.binaryPath) {
    throw new Error("No whisper.cpp binary configured — set one in Settings → STT.");
  }
  return window.yggdrasil.whisper.transcribe(wav, whisperSettings);
}
