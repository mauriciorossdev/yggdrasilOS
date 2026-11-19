import { useEffect, useRef, useState } from "react";
import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import enUS from "@univerjs/preset-sheets-core/locales/en-US";
import esES from "@univerjs/preset-sheets-core/locales/es-ES";
import "@univerjs/preset-sheets-core/lib/index.css";
import type { WorkbookSnapshot } from "@yggdrasil/tool-office/browser";
import { useI18n } from "../i18n/index.js";
import { failSheetOpen, registerSheetController, type SheetController } from "./sheetRegistry.js";
import { assertReadable, readResult, shapeOf, toCellWrites } from "./sheetOps.js";
import { contentSignature } from "./sheetSignature.js";
import { openWorkspaceTab } from "./workspaceStore.js";
import { lossyNames } from "./lossyNames.js";

type Props = { path: string; active: boolean };
type SaveState = "saved" | "unsaved" | "saving" | "error";
type Univer = ReturnType<typeof createUniver>;

const SAVE_DEBOUNCE_MS = 800;
/** CommandType.MUTATION: only these change the document (selection moves and the like are operations). */
const MUTATION = 2;

function isDarkBackground(): boolean {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(document.body).backgroundColor);
  if (!m) return true;
  return (0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])) / 255 < 0.5;
}

const CALCULATION_WAIT_MS = 2000;

/** A promise for the next end of a formula calculation (subscribe BEFORE making the change), capped so a missed signal can't hang a tool call. */
function nextCalculation(univerAPI: Univer["univerAPI"]): Promise<void> {
  return new Promise((resolve) => {
    let watcher: { dispose: () => void } | undefined;
    const done = () => {
      clearTimeout(timer);
      watcher?.dispose();
      resolve();
    };
    const timer = setTimeout(done, CALCULATION_WAIT_MS);
    try {
      watcher = univerAPI.getFormula().calculationEnd(done);
    } catch {
      done();
    }
  });
}

function controllerFor(univerAPI: Univer["univerAPI"], lossy: string[]): SheetController {
  const workbook = () => {
    const wb = univerAPI.getActiveWorkbook();
    if (!wb) throw new Error("No spreadsheet is open");
    return wb;
  };
  const sheetOf = (name?: string) => {
    const wb = workbook();
    const sheet = name ? wb.getSheetByName(name) : wb.getActiveSheet();
    if (!sheet) throw new Error(`There is no sheet named "${name}"`);
    return sheet;
  };
  return {
    info() {
      const wb = workbook();
      const active = wb.getActiveSheet();
      return { sheets: wb.getSheets().map((s) => s.getSheetName()), activeSheet: active.getSheetName(), usedRange: active.getDataRange().getA1Notation() };
    },
    readRange(range, sheet) {
      const r = sheetOf(sheet).getRange(range);
      assertReadable(r.getHeight(), r.getWidth());
      return readResult(r.getA1Notation(), r.getValues(), r.getFormulas());
    },
    async writeRange(range, values, sheet) {
      const { rows, columns } = shapeOf(values);
      const ws = sheetOf(sheet);
      const anchor = ws.getRange(range);
      if (anchor.getRow() + rows > ws.getMaxRows()) throw new Error("The values run past the last row of the sheet");
      if (anchor.getColumn() + columns > ws.getMaxColumns()) throw new Error("The values run past the last column of the sheet");
      const target = ws.getRange(anchor.getRow(), anchor.getColumn(), rows, columns);
      // Formulas are calculated by an engine that answers a moment later: wait for it, so that whoever
      // reads right after this write (the agent's next tool call) sees results instead of empty cells.
      const hasFormula = values.some((row) => row.some((c) => typeof c === "string" && c.startsWith("=")));
      const calculated = hasFormula ? nextCalculation(univerAPI) : Promise.resolve();
      target.setValues(toCellWrites(values).map((row) => row.map((c) => c ?? { v: null })));
      await calculated;
      const written = target.getA1Notation();
      // The agent must know when its change exists only on screen (the file has things the editor can't keep).
      return lossy.length > 0
        ? { written, saved: false, note: `Not saved to the file: it has ${lossy.join(", ")}, which the editor can't keep yet. The change is on screen only; the user can save a copy.` }
        : { written, saved: true };
    },
  };
}

/** One spreadsheet in the workspace: edit it by hand, and an agent can read/write the same open workbook through its controller. Saves itself back to the .xlsx. */
export default function SheetEditor({ path, active }: Props) {
  const { language } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const univerRef = useRef<Univer | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [lossy, setLossy] = useState<string[]>([]);
  const [copy, setCopy] = useState<{ path: string } | { error: string } | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let univer: Univer | null = null;
    let unregister: (() => void) | null = null;
    let commandWatcher: { dispose: () => void } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let saved = "";
    let dirty = false;
    // Features the file has that saving would drop: such a file is never auto-saved (see the banner below).
    let lossyRef: string[] = [];

    const save = async () => {
      if (lossyRef.length > 0) return;
      const wb = univer?.univerAPI.getActiveWorkbook();
      if (!wb) return;
      const snapshot = wb.save() as unknown as WorkbookSnapshot;
      const signature = contentSignature(snapshot);
      if (signature === saved) {
        dirty = false;
        setSaveState("saved");
        return;
      }
      setSaveState("saving");
      try {
        await window.yggdrasil.office.sheetSave(path, snapshot);
        saved = signature;
        dirty = false;
        if (!cancelled) setSaveState("saved");
      } catch (err) {
        if (!cancelled) {
          setSaveState("error");
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    void (async () => {
      try {
        const loaded = await window.yggdrasil.office.sheetLoad(path);
        const snapshot = loaded.snapshot as WorkbookSnapshot;
        if (cancelled) return;
        lossyRef = loaded.lossy;
        setLossy(loaded.lossy);
        const es = language === "es";
        univer = createUniver({
          locale: es ? LocaleType.ES_ES : LocaleType.EN_US,
          locales: { [es ? LocaleType.ES_ES : LocaleType.EN_US]: mergeLocales(es ? esES : enUS) },
          darkMode: isDarkBackground(),
          presets: [UniverSheetsCorePreset({ container: host })],
        });
        univerRef.current = univer;
        univer.univerAPI.createWorkbook(snapshot as never);
        // What was loaded is the baseline: the editor recomputing layout on open must not count as an edit.
        const opened = univer.univerAPI.getActiveWorkbook()!.save() as unknown as WorkbookSnapshot;
        saved = contentSignature(opened);
        // Saving patches the original file with the difference from this snapshot, so it must be the editor's own view.
        await window.yggdrasil.office.sheetBaseline(path, opened);
        commandWatcher = univer.univerAPI.addEvent(univer.univerAPI.Event.CommandExecuted, (command) => {
          if (command.type !== MUTATION) return;
          dirty = true;
          setSaveState("unsaved");
          clearTimeout(timer);
          timer = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
        });
        unregister = registerSheetController(path, controllerFor(univer.univerAPI, lossyRef));
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        const failure = err instanceof Error ? err : new Error(String(err));
        failSheetOpen(path, failure);
        setStatus("error");
        setError(failure.message);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unregister?.();
      commandWatcher?.dispose();
      // Closing the tab right after an edit must not lose it.
      if (dirty) void save();
      univer?.univer.dispose();
    };
  }, [path, language]);

  const saveCopy = async () => {
    try {
      const wb = univerRef.current?.univerAPI.getActiveWorkbook();
      if (!wb) return;
      const copyPath = await window.yggdrasil.office.sheetSaveCopy(path, wb.save());
      setCopy({ path: copyPath });
    } catch (err) {
      setCopy({ error: err instanceof Error ? err.message : String(err) });
    }
  };

  // A hidden tab has no size; when it is shown again the grid must measure itself.
  useEffect(() => {
    if (active && status === "ready") window.dispatchEvent(new Event("resize"));
  }, [active, status]);

  return (
    <div className="sheet-editor">
      {lossy.length > 0 && (
        <div className="sheet-lossy" role="alert">
          <span>{t("workspace.lossyBanner", { features: lossyNames(lossy, language) })}</span>
          <button type="button" onClick={() => void saveCopy()}>
            {t("workspace.saveCopy")}
          </button>
          {copy && "path" in copy && (
            <>
              <span className="muted">{t("workspace.copySaved", { path: copy.path })}</span>
              <button type="button" onClick={() => openWorkspaceTab("sheet", copy.path)}>
                {t("workspace.openCopy")}
              </button>
            </>
          )}
          {copy && "error" in copy && <span className="error">{copy.error}</span>}
        </div>
      )}
      {status === "error" && <p className="error sheet-error">{error}</p>}
      {status === "loading" && <p className="muted sheet-loading">…</p>}
      <div className="sheet-host" ref={hostRef} />
      {status === "ready" && (
        <span className={`sheet-save sheet-save-${lossy.length > 0 ? "error" : saveState}`}>
          {lossy.length > 0 ? "⚠" : saveState === "saved" ? "✓" : saveState === "saving" ? "…" : saveState === "unsaved" ? "●" : "!"}
        </span>
      )}
    </div>
  );
}
