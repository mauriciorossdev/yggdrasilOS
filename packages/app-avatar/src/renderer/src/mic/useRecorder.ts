import { useCallback, useRef, useState } from "react";
import { blobToWav } from "./wavEncoder.js";

export type RecorderStatus = "idle" | "recording" | "processing" | "error";

export function useRecorder() {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // getUserMedia + MediaRecorder construction is async — on a quick
  // press-release, stop() could otherwise run before start() finishes
  // setting mediaRecorderRef, silently producing no audio at all (no error,
  // just nothing recorded). stop() awaits this so it always waits for any
  // in-flight start to settle first, whether it succeeded or failed.
  const startingRef = useRef<Promise<void> | null>(null);

  const start = useCallback(async (deviceId?: string) => {
    setError(null);
    const promise = (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        });
        streamRef.current = stream;
        chunksRef.current = [];
        const recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        mediaRecorderRef.current = recorder;
        recorder.start();
        setStatus("recording");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    })();
    startingRef.current = promise;
    await promise;
    startingRef.current = null;
  }, []);

  /** Resolves with a 16kHz mono PCM16 WAV buffer, or null if recording never started / produced no audio. */
  const stop = useCallback(async (): Promise<ArrayBuffer | null> => {
    if (startingRef.current) await startingRef.current;
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return null;

    setStatus("processing");
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: recorder.mimeType }));
      recorder.stop();
    });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;

    if (blob.size === 0) {
      setStatus("idle");
      return null;
    }

    try {
      const wav = await blobToWav(blob);
      setStatus("idle");
      return wav;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
      return null;
    }
  }, []);

  const cancel = useCallback(() => {
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
    setStatus("idle");
  }, []);

  return { status, error, start, stop, cancel };
}
