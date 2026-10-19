import { useCallback, useEffect, useRef, useState } from "react";
import { useRecorder } from "../mic/useRecorder.js";
import { transcribeWithConfiguredStt } from "../mic/transcribeWithConfiguredStt.js";

export type DictationPhase = "idle" | "recording" | "transcribing";

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Click-to-dictate for a terminal pane. Unmounting mid-recording (expand or
 * split moves the pane in the tree) still finishes the transcription, so the
 * audio isn't dropped and the mic is released.
 */
export function useDictation(onTranscript: (text: string) => void) {
  const recorder = useRecorder();
  const { start: recStart, stop: recStop, cancel: recCancel } = recorder;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const statusRef = useRef(recorder.status);
  statusRef.current = recorder.status;

  const stopAndTranscribe = useCallback(async () => {
    setBusy(true);
    try {
      const wav = await recStop();
      if (!wav) return;
      const text = await transcribeWithConfiguredStt(wav);
      if (text) onTranscriptRef.current(text);
      else setError("No se detectó voz.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [recStop]);

  useEffect(
    () => () => {
      if (statusRef.current === "recording") void stopAndTranscribe();
    },
    [stopAndTranscribe],
  );

  useEffect(() => {
    if (recorder.status !== "recording") {
      setElapsedMs(0);
      return;
    }
    const startedAt = Date.now();
    const id = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
    return () => window.clearInterval(id);
  }, [recorder.status]);

  const phase: DictationPhase =
    recorder.status === "recording" ? "recording" : busy || recorder.status === "processing" ? "transcribing" : "idle";

  const start = useCallback(() => {
    setError(null);
    void recStart();
  }, [recStart]);

  const toggle = useCallback(() => {
    if (phase === "recording") void stopAndTranscribe();
    else if (phase === "idle") start();
  }, [phase, start, stopAndTranscribe]);

  const dismissError = useCallback(() => {
    setError(null);
    recCancel();
  }, [recCancel]);

  return {
    phase,
    elapsedMs,
    error: error ?? (recorder.status === "error" ? recorder.error : null),
    toggle,
    dismissError,
  };
}
