import { useCallback, useRef, useState } from "react";
import type { PiperSettings, TtsSettings } from "../types.js";

export function useSpeaker() {
  const [settings, setSettings] = useState<PiperSettings | null>(null);
  const [ttsSettings, setTtsSettings] = useState<TtsSettings | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const release = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    audioRef.current = null;
    setIsSpeaking(false);
    setIsPaused(false);
  }, []);

  const loadSettings = useCallback(async () => {
    const [piper, tts] = await Promise.all([window.yggdrasil.piper.getSettings(), window.yggdrasil.tts.getSettings()]);
    setSettings(piper);
    setTtsSettings(tts);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!settings?.enabled || !text.trim()) return;
      const useCloud = ttsSettings?.source === "cloud";
      // Neither TTS path is actually usable — no local Piper binary set, or
      // "cloud" selected but never filled in — so just skip speaking instead
      // of firing a doomed request that only surfaces as an error toast.
      if (!useCloud && !settings.binaryPath) return;
      if (useCloud && (!ttsSettings?.cloud.apiKey.trim() || !ttsSettings.cloud.voiceId.trim())) return;
      // A new reply arriving mid-speech takes over — don't let two utterances overlap.
      audioRef.current?.pause();
      release();
      setError(null);
      try {
        const { audio: audioBytes, mimeType } = useCloud
          ? await window.yggdrasil.tts.synthesizeCloud(text, ttsSettings!.cloud)
          : { audio: await window.yggdrasil.piper.synthesize(text, settings), mimeType: "audio/wav" };
        const url = URL.createObjectURL(new Blob([audioBytes], { type: mimeType }));
        urlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = release;
        audio.onerror = release;
        setIsPaused(false);
        setIsSpeaking(true);
        await audio.play();
      } catch (err) {
        release();
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [settings, ttsSettings, release],
  );

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setIsPaused(true);
  }, []);

  const resume = useCallback(() => {
    void audioRef.current?.play();
    setIsPaused(false);
  }, []);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    release();
  }, [release]);

  return { settings, loadSettings, isSpeaking, isPaused, error, speak, pause, resume, stop };
}
