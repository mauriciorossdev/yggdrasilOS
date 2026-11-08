import * as monaco from "monaco-editor";
import { getEditorPrefs } from "./editorPrefs.js";
import { formatForSave } from "./formatOnSave.js";
import { fixAllOnSave, modelPathFor } from "./lsp/service.js";

/**
 * What to write when the user saves `path`: formatted if that preference is on and the file is showing
 * in an editor (formatting runs through the editor, so a background tab is saved as it is).
 */
export async function contentToSave(path: string, content: string): Promise<string> {
  const { formatOnSave, fixOnSave } = getEditorPrefs();
  if (!formatOnSave && !fixOnSave) return content;
  const uri = monaco.Uri.parse(modelPathFor(path)).toString();
  const editor = monaco.editor.getEditors().find((e) => e.getModel()?.uri.toString() === uri);
  const model = editor?.getModel();
  if (!editor || !model || editor.getOption(monaco.editor.EditorOption.readOnly)) return content;
  const action = formatOnSave ? editor.getAction("editor.action.formatDocument") : null;
  const canFormat = action?.isSupported() === true;
  return formatForSave(
    {
      getValue: () => model.getValue(),
      format:
        fixOnSave || canFormat
          ? async () => {
              if (fixOnSave) await fixAllOnSave(model);
              if (canFormat) await action!.run();
            }
          : undefined,
    },
    content,
  );
}
