import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { deckToPptx, docxToModel, inspectDocxLossy, inspectPptxLossy, pptxToDeck, type DeckModel, inspectLossyFeatures, modelToDocx, newSnapshot, patchXlsx, snapshotToXlsx, xlsxToSnapshot, type DocModel, type WorkbookSnapshot } from "@yggdrasil/tool-office";

/**
 * Disk side of the in-app spreadsheet editor. Callers pass an absolute path that has already been
 * resolved inside the project (index.ts's resolveInProject); this module adds what is specific to
 * spreadsheets: only .xlsx, a size cap, and atomic writes so a crash mid-save can't leave a half file.
 */

export const MAX_SHEET_BYTES = 50 * 1024 * 1024;

/**
 * What each open file looked like when it was last opened or saved: saving patches the original with the
 * difference between this and the editor's current snapshot (see tool-office's patch.ts), so whatever the
 * editor doesn't model survives. The editor replaces the entry right after it opens the workbook with its
 * own normalized snapshot, so the comparison is editor-against-editor.
 */
const baselines = new Map<string, WorkbookSnapshot>();

/**
 * Loads and saves of one file run one at a time, in the order they were asked for. The editors save on a
 * debounce and on close without waiting for the previous save, and a re-mounted editor loads right after the
 * old one's last save: unserialized, two writes could collide and a load could read the file (and set the
 * baseline) before an earlier save landed.
 */
const queues = new Map<string, Promise<unknown>>();

function exclusive<T>(absPath: string, job: () => Promise<T>): Promise<T> {
  const run = (queues.get(absPath) ?? Promise.resolve()).then(job, job);
  const tail = run.catch(() => undefined);
  queues.set(absPath, tail);
  void tail.then(() => {
    if (queues.get(absPath) === tail) queues.delete(absPath);
  });
  return run;
}

let tmpCounter = 0;

/** Writes through a temp file next to the target so a crash can't leave a half file; a failed write leaves no temp behind. */
async function writeAtomic(absPath: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(absPath), { recursive: true });
  const tmp = `${absPath}.${process.pid}.${++tmpCounter}.saving`;
  try {
    await writeFile(tmp, bytes);
    await rename(tmp, absPath);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

export function setSheetBaseline(absPath: string, snapshot: WorkbookSnapshot): void {
  baselines.set(absPath, snapshot);
}

function assertXlsx(path: string): void {
  if (extname(path).toLowerCase() !== ".xlsx") throw new Error("Solo se pueden abrir hojas de cálculo .xlsx");
}

export type LoadedSheet = {
  snapshot: WorkbookSnapshot;
  /** What the file has that the editor can't keep yet (borders, charts...): saving over it would drop these. */
  lossy: string[];
};

export async function loadSheetSnapshot(absPath: string, name: string): Promise<LoadedSheet> {
  assertXlsx(absPath);
  return exclusive(absPath, () => readSheet(absPath, name));
}

async function readSheet(absPath: string, name: string): Promise<LoadedSheet> {
  const info = await stat(absPath);
  if (!info.isFile()) throw new Error("No es un archivo");
  if (info.size > MAX_SHEET_BYTES) throw new Error(`La hoja pesa demasiado (máx. ${MAX_SHEET_BYTES / 1024 / 1024} MB)`);
  const data = await readFile(absPath);
  const snapshot = await xlsxToSnapshot(data, name);
  // A copy: the caller owns (and may edit) the snapshot it gets back, the baseline must not move with it.
  baselines.set(absPath, structuredClone(snapshot));
  return { snapshot, lossy: await inspectLossyFeatures(data) };
}

/** Where a copy of `absPath` goes: "name (copia).xlsx", then "name (copia 2).xlsx"... never an existing file. */
export async function copyPathFor(absPath: string): Promise<string> {
  const ext = extname(absPath);
  const stem = basename(absPath, ext);
  for (let n = 1; ; n++) {
    const candidate = join(dirname(absPath), `${stem} (copia${n === 1 ? "" : ` ${n}`})${ext}`);
    if (!(await stat(candidate).then(() => true, () => false))) return candidate;
  }
}

export async function saveSheetSnapshot(absPath: string, snapshot: WorkbookSnapshot): Promise<void> {
  assertXlsx(absPath);
  return exclusive(absPath, () => writeSheet(absPath, snapshot));
}

async function writeSheet(absPath: string, snapshot: WorkbookSnapshot): Promise<void> {
  const existing = await readFile(absPath).catch(() => null);
  // An existing file is patched, never rebuilt: a rebuild would drop what the editor can't represent.
  const bytes = existing
    ? await patchXlsx(existing, baselines.get(absPath) ?? (await xlsxToSnapshot(existing)), snapshot)
    : await snapshotToXlsx(snapshot);
  if (bytes.byteLength > MAX_SHEET_BYTES) throw new Error("La hoja resultante pesa demasiado para guardarla");
  await writeAtomic(absPath, bytes);
  baselines.set(absPath, structuredClone(snapshot));
}

/** Creates a new workbook file (never overwrites): optional rows, strings starting with "=" become formulas. */
export async function createSheetFile(absPath: string, rows: Array<Array<string | number | boolean | null>> = []): Promise<void> {
  assertXlsx(absPath);
  const exists = await stat(absPath).then(() => true, () => false);
  if (exists) throw new Error("Ese archivo ya existe");
  await saveSheetSnapshot(absPath, newSnapshot("Workbook", rows));
}


// --- Word documents (.docx) ---------------------------------------------------------------------------
// Unlike a spreadsheet there is no "patch the original" here: the document is rebuilt from the editor's
// model on every save, so a file with features the model can't keep (headers, comments, tracked changes...)
// is never auto-saved — the renderer shows a banner and offers a copy.

function assertDocx(path: string): void {
  if (extname(path).toLowerCase() !== ".docx") throw new Error("Solo se pueden abrir documentos de Word .docx");
}

export type LoadedDoc = { model: DocModel; lossy: string[] };

export async function loadDoc(absPath: string): Promise<LoadedDoc> {
  assertDocx(absPath);
  const info = await stat(absPath);
  if (!info.isFile()) throw new Error("No es un archivo");
  if (info.size > MAX_SHEET_BYTES) throw new Error(`El documento pesa demasiado (máx. ${MAX_SHEET_BYTES / 1024 / 1024} MB)`);
  const data = await readFile(absPath);
  return { model: await docxToModel(data), lossy: await inspectDocxLossy(data) };
}

export async function saveDoc(absPath: string, model: DocModel): Promise<void> {
  assertDocx(absPath);
  return exclusive(absPath, () => writeDoc(absPath, model));
}

async function writeDoc(absPath: string, model: DocModel): Promise<void> {
  const bytes = await modelToDocx(model);
  if (bytes.byteLength > MAX_SHEET_BYTES) throw new Error("El documento resultante pesa demasiado para guardarlo");
  await writeAtomic(absPath, bytes);
}

/** Creates a new document (never overwrites). */
export async function createDocFile(absPath: string, model: DocModel): Promise<void> {
  assertDocx(absPath);
  if (await stat(absPath).then(() => true, () => false)) throw new Error("Ese archivo ya existe");
  await saveDoc(absPath, model);
}


// --- PowerPoint (.pptx) -------------------------------------------------------------------------------
// Rebuilt from the editor's deck model on every save. Only decks this app wrote are auto-saved: any other
// file reports "design and layout from another app" among its lossy features (tool-office's inspect.ts).

function assertPptx(path: string): void {
  if (extname(path).toLowerCase() !== ".pptx") throw new Error("Solo se pueden abrir presentaciones de PowerPoint .pptx");
}

export type LoadedDeck = { deck: DeckModel; lossy: string[] };

export async function loadDeck(absPath: string): Promise<LoadedDeck> {
  assertPptx(absPath);
  const info = await stat(absPath);
  if (!info.isFile()) throw new Error("No es un archivo");
  if (info.size > MAX_SHEET_BYTES) throw new Error(`La presentación pesa demasiado (máx. ${MAX_SHEET_BYTES / 1024 / 1024} MB)`);
  const data = await readFile(absPath);
  return { deck: (await pptxToDeck(data)).deck, lossy: await inspectPptxLossy(data) };
}

export async function saveDeck(absPath: string, deck: DeckModel): Promise<void> {
  assertPptx(absPath);
  return exclusive(absPath, () => writeDeck(absPath, deck));
}

async function writeDeck(absPath: string, deck: DeckModel): Promise<void> {
  const bytes = await deckToPptx(deck);
  if (bytes.byteLength > MAX_SHEET_BYTES) throw new Error("La presentación resultante pesa demasiado para guardarla");
  await writeAtomic(absPath, bytes);
}

/** Creates a new presentation (never overwrites). */
export async function createDeckFile(absPath: string, deck: DeckModel): Promise<void> {
  assertPptx(absPath);
  if (await stat(absPath).then(() => true, () => false)) throw new Error("Ese archivo ya existe");
  await saveDeck(absPath, deck);
}
