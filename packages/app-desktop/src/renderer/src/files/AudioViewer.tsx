import { useEffect, useRef, useState } from "react";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

// Native <audio controls> gives play/pause, seek and volume/mute; the extras
// (loop, speed) are the controls it doesn't have. The ygg-file:// URL streams
// with Range support, so big files seek instantly and aren't capped at 20 MB.
export function AudioViewer({ relativePath }: { relativePath: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [loop, setLoop] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [relativePath]);

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = speed;
  }, [speed, relativePath]);

  const name = relativePath.split(/[\\/]/).pop() ?? relativePath;

  return (
    <div className="file-viewer-audio">
      <div className="file-viewer-audio-name" title={relativePath}>
        {name}
      </div>
      <audio
        ref={ref}
        key={relativePath}
        controls
        preload="metadata"
        loop={loop}
        src={window.yggdrasil.files.fileUrl(relativePath)}
        onLoadedMetadata={() => {
          if (ref.current) ref.current.playbackRate = speed;
        }}
        onError={() => setError("Could not play this audio file (unsupported codec?).")}
      />
      <div className="file-viewer-audio-options">
        <label>
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop
        </label>
        <label>
          Speed{" "}
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
