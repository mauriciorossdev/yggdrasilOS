// Monaco is most of the renderer: the editors load the first time one is shown, not at startup.
import { lazy, Suspense, type ComponentProps } from "react";
import { useI18n } from "../i18n/index.js";

const TextEditorImpl = lazy(() => import("./TextEditor.js").then((m) => ({ default: m.TextEditor })));
const DiffViewerImpl = lazy(() => import("../repository/DiffViewer.js").then((m) => ({ default: m.DiffViewer })));

function Loading() {
  const { t } = useI18n();
  return <p className="muted workspace-loading">{t("workspace.loading")}</p>;
}

export function TextEditor(props: ComponentProps<typeof TextEditorImpl>) {
  return (
    <Suspense fallback={<Loading />}>
      <TextEditorImpl {...props} />
    </Suspense>
  );
}

export function DiffViewer(props: ComponentProps<typeof DiffViewerImpl>) {
  return (
    <Suspense fallback={<Loading />}>
      <DiffViewerImpl {...props} />
    </Suspense>
  );
}
