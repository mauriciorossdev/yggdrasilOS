import { useCallback, useState } from "react";
import { ExclamationTriangleIcon, MicrophoneIcon } from "@heroicons/react/20/solid";
import { useRecorder } from "../mic/useRecorder.js";
import { transcribeWithConfiguredStt } from "../mic/transcribeWithConfiguredStt.js";

type Props = {
  disabled?: boolean;
  onTranscript: (text: string) => void;
};

// Push-to-talk, same pattern as app-avatar's chat mic button: hold to
// record, release to stop+transcribe. Settings are re-fetched fresh on
// every release rather than kept in local state — dictation is infrequent
// enough that this isn't worth the extra plumbing, and it means a Settings
// change takes effect on the very next press without this component needing
// to know it changed.
export function MicButton({ disabled, onTranscript }: Props) {
  const recorder = useRecorder();
  const [error, setError] = useState<string | null>(null);

  const onDown = useCallback(() => {
    if (disabled) return;
    setError(null);
    void recorder.start();
  }, [disabled, recorder]);

  const onUp = useCallback(async () => {
    const wav = await recorder.stop();
    if (!wav) {
      if (recorder.status !== "idle") setError("No audio captured — held for too short. Try again.");
      return;
    }
    try {
      const transcript = await transcribeWithConfiguredStt(wav);
      if (transcript) {
        setError(null);
        onTranscript(transcript);
      } else {
        setError("Heard silence — no speech detected.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [recorder, onTranscript]);

  return (
    <span className="mic-button-wrap">
      <button
        type="button"
        className={`mic-button ${recorder.status === "recording" ? "recording" : ""}`}
        title={recorder.status === "recording" ? "Release to transcribe" : "Hold to dictate"}
        disabled={disabled || recorder.status === "processing"}
        onMouseDown={onDown}
        onMouseUp={() => void onUp()}
        onMouseLeave={() => recorder.status === "recording" && void onUp()}
      >
        {recorder.status === "recording" ? (
          "●"
        ) : recorder.status === "processing" ? (
          "…"
        ) : (
          <MicrophoneIcon className="hero-icon" />
        )}
      </button>
      {error && (
        <span className="mic-error-tooltip" title={error}>
          <ExclamationTriangleIcon className="hero-icon" />
        </span>
      )}
    </span>
  );
}
