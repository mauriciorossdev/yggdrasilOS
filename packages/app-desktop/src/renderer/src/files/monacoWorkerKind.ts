export type MonacoWorkerKind = "typescript" | "json" | "css" | "html" | "editor";

const KIND_BY_LABEL: Record<string, MonacoWorkerKind> = {
  typescript: "typescript",
  javascript: "typescript",
  json: "json",
  css: "css",
  scss: "css",
  less: "css",
  html: "html",
  handlebars: "html",
  razor: "html",
};

/**
 * Which worker a Monaco worker label needs. MonacoEnvironment.getWorker receives every worker
 * request, so handing a language's request to the generic worker makes its language features fail.
 */
export function monacoWorkerKind(label: string): MonacoWorkerKind {
  return KIND_BY_LABEL[label] ?? "editor";
}
