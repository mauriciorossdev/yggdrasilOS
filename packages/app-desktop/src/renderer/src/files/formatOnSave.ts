const FORMAT_TIMEOUT_MS = 2000;

/** The parts of an editor that formatting needs. */
export type Formattable = {
  getValue: () => string;
  /** Undefined when no formatter handles this language. */
  format?: () => Promise<void>;
};

/**
 * Formats and returns the text to write. A save must never be lost to a formatter, so a hang or
 * failure just saves the text as it is. `content` is what the caller is about to write: if the
 * editor shows something else, its text isn't this save's to format.
 */
export async function formatForSave(target: Formattable, content: string, timeoutMs = FORMAT_TIMEOUT_MS): Promise<string> {
  if (!target.format || target.getValue() !== content) return content;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("format timed out")), timeoutMs);
    });
    await Promise.race([target.format(), timeout]);
    return target.getValue();
  } catch {
    return content;
  } finally {
    clearTimeout(timer);
  }
}
