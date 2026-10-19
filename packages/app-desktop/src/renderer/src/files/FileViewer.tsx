import { lazy, Suspense, useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import type { FsReadBinaryResult } from "../types.js";
import { imageMimeType, isBlenderFile, type PreviewKind } from "./filePreviewKind.js";
import { AudioViewer } from "./AudioViewer.js";

// three.js is large — only pulled in when a 3D file is actually opened.
const ModelViewer = lazy(() => import("./ModelViewer.js"));

type Props = {
  relativePath: string;
  kind: Exclude<PreviewKind, "text">;
};

// Handles the non-text preview kinds (image/pdf/binary) — the "text" kind is
// still handled by the caller (FileContentPanel/DocumentsView), which owns
// the editable fs.read/fs.write flow. This component is read-only.
export function FileViewer({ relativePath, kind }: Props) {
  const { call } = useGateway();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    setDataUrl(null);
    setError(null);
    if (kind === "binary" || kind === "audio" || kind === "model3d") return;
    (async () => {
      try {
        const res = await call<FsReadBinaryResult>("fs.readBinary", { relativePath });
        if (res.truncated) {
          setError(`Too large to preview (${(res.totalBytes / 1_000_000).toFixed(1)} MB).`);
          return;
        }
        const mime = kind === "pdf" ? "application/pdf" : imageMimeType(relativePath);
        setDataUrl(`data:${mime};base64,${res.base64}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [call, relativePath, kind]);

  const openExternal = async () => {
    setOpening(true);
    try {
      await window.yggdrasil.files.openExternal(relativePath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpening(false);
    }
  };

  if (kind === "audio") return <AudioViewer relativePath={relativePath} />;

  if (kind === "model3d") {
    return (
      <Suspense fallback={<p className="muted file-viewer-fallback">Loading viewer…</p>}>
        <ModelViewer relativePath={relativePath} />
      </Suspense>
    );
  }

  if (kind === "binary") {
    const blender = isBlenderFile(relativePath);
    return (
      <div className="file-viewer-fallback">
        <p className="muted">No preview available for this file type.</p>
        {error && <p className="error">{error}</p>}
        {blender && (
          <button
            type="button"
            className="new-chat"
            onClick={async () => {
              const res = await window.yggdrasil.ide.openInBlender(relativePath);
              if (!res.opened) setError(res.error ?? "Could not open Blender.");
            }}
          >
            Open in Blender
          </button>
        )}
        <button type="button" className="new-chat" onClick={() => void openExternal()} disabled={opening}>
          {opening ? "Opening…" : "Open with default app"}
        </button>
      </div>
    );
  }

  if (error) return <p className="error file-viewer-fallback">{error}</p>;
  if (!dataUrl) return <p className="muted file-viewer-fallback">Loading…</p>;

  if (kind === "pdf") {
    return <embed className="file-viewer-pdf" src={dataUrl} type="application/pdf" />;
  }

  return (
    <div className="file-viewer-image">
      <img src={dataUrl} alt={relativePath} />
    </div>
  );
}
