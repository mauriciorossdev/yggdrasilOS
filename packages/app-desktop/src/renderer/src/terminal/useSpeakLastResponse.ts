import { useCallback, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";

export type SpeakPhase = "idle" | "loading" | "speaking";
export type SpeakMode = "summary" | "full";

type SpeakResult = { text: string; audioBase64: string; mimeType: string };

/**
 * "Hablar última respuesta" for a terminal pane: fetches the pane's last
 * `claude` assistant reply and synthesizes it (terminals.speak, methods.ts),
 * playing the result right here on the desktop. Same "phase + action" hook
 * shape as useDictation.ts, output (TTS) instead of input (STT).
 * `mode: "summary"` has the gateway's default agent condense it first;
 * `mode: "full"` sends the raw reply straight to TTS (still clipped to
 * TTS_MAX_CHARS server-side).
 */
export function useSpeakLastResponse(paneId: string) {
  const { call } = useGateway();
  const [phase, setPhase] = useState<SpeakPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  const speak = useCallback(async (mode: SpeakMode) => {
    setError(null);
    setPhase("loading");
    try {
      // Empty voiceId lets the gateway fall back to its own default — see
      // tts.ts's DEFAULT_VOICE/REPLICATE_TTS_VOICE chain.
      const { voiceId } = await window.yggdrasil.tts.getSettings();
      const result = await call<SpeakResult>("terminals.speak", {
        id: paneId,
        voiceId: voiceId || undefined,
        mode,
      });
      if (!result.audioBase64) throw new Error("terminals.speak devolvió audio vacío");
      setPhase("speaking");
      const audio = new Audio(`data:${result.mimeType};base64,${result.audioBase64}`);
      // Deliberately NOT swallowed — a silently-resolved playback failure
      // (autoplay block, unsupported codec, decode error) looked exactly
      // like "no error, but nothing happened" from the user's side, with no
      // way to tell what actually went wrong.
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onerror = () =>
          reject(new Error(`no se pudo reproducir el audio (${audio.error?.message ?? "error desconocido"})`));
        // Only the rejection path matters here — a resolved play() just
        // means playback STARTED, not finished; onended/onerror above are
        // what actually settle this promise.
        void audio.play().catch(reject);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPhase("idle");
    }
  }, [call, paneId]);

  const dismissError = useCallback(() => setError(null), []);

  return { phase, error, speak, dismissError };
}
